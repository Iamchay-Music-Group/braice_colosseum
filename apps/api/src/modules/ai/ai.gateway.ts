import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AggregationLevel,
  AuthorizationDecision,
  DenialReason,
  Operation,
} from '@braice/permission-engine';
import { AuthorizationService } from '../authorization/authorization.service';
import { DatasetsService } from '../datasets/datasets.service';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';
import type { AiTool } from '@braice/ai-client';

/**
 * The AI's entire capability surface.
 *
 * There are two tools. One returns community-level aggregates after an
 * authorization check. The other returns a refusal.
 *
 * That is the whole design. A tool that could enumerate members, read an
 * individual activity record, or query the individual-level table does not
 * exist here, and cannot be added without the same permission check that
 * guards the aggregate. The AI cannot reach individual data because it has no
 * instrument for doing so — not because a prompt tells it not to.
 */

export interface CommunityInsight {
  communityId: string;
  datasetId: string;
  datasetType: string;
  version: number;
  /** Category -> percentage of source records. Integers. No member keys. */
  data: Record<string, number>;
  sourceCount: number;
  aggregationLevel: AggregationLevel;
}

export interface ToolDenial {
  denied: true;
  reason: DenialReason;
  permissionId?: string;
  /** Echoed so the caller can explain which scope was asked for. */
  requestedAggregationLevel: AggregationLevel;
}

export interface ToolParams {
  principalId: string;
  communityId: string;
  purpose: string;
  operation: Operation;
}

/**
 * Narrow untyped tool parameters, or refuse.
 *
 * `AiTool.execute` receives `Record<string, unknown>`. Casting it to a typed
 * shape would silence the compiler without checking anything, so a missing
 * `principalId` would arrive as undefined and be interpolated into an
 * audit row as "undefined" — an audit trail that records nobody.
 *
 * This runs the check instead. `principalId` in particular is the field whose
 * absence must never be tolerated: every decision downstream is attributed to
 * it.
 */
function requireString(
  params: Record<string, unknown>,
  key: keyof ToolParams,
): string {
  const value = params[key];

  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException(
      `Tool parameter "${key}" is required and must be a non-empty string.`,
    );
  }

  return value;
}

function requireOperation(params: Record<string, unknown>): Operation {
  const value = params.operation;

  if (!Object.values(Operation).includes(value as Operation)) {
    throw new BadRequestException(
      `Tool parameter "operation" must be one of: ` +
        `${Object.values(Operation).join(', ')}.`,
    );
  }

  return value as Operation;
}

function readParams(params: Record<string, unknown>): ToolParams {
  return {
    principalId: requireString(params, 'principalId'),
    communityId: requireString(params, 'communityId'),
    purpose: requireString(params, 'purpose'),
    operation: requireOperation(params),
  };
}

/** Granularity is optional, but must be a real level when present. */
function readGranularity(
  params: Record<string, unknown>,
): AggregationLevel | undefined {
  const value = params.granularity;

  if (value === undefined || value === null) return undefined;

  if (!Object.values(AggregationLevel).includes(value as AggregationLevel)) {
    throw new BadRequestException(
      `Tool parameter "granularity" must be one of: ` +
        `${Object.values(AggregationLevel).join(', ')}.`,
    );
  }

  return value as AggregationLevel;
}

/**
 * Does this question reach for member-level rows?
 *
 * Deliberately small and inspectable. A model's guess about intent would make
 * the boundary non-deterministic, and the boundary has to hold the same way
 * every time. A caller can always ask for less and be served; this only
 * decides when to refuse, so a false negative costs an unhelpful answer while
 * a false positive costs an accurate refusal. The direction is the safe one.
 */
const INDIVIDUAL_INTENT =
  /\b(individuals?|members?|people|who|whose|usernames?|emails?|names?)\b/i;

@Injectable()
export class AiGateway {
  private readonly logger = new Logger(AiGateway.name);

  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly datasetsService: DatasetsService,
  ) {}

  /**
   * The one tool that returns data.
   *
   * Authorize, then read. The check happens inside
   * loadAuthorizedDataset rather than being assumed here, so the ordering
   * cannot be skipped by future edits to this method.
   */
  readonly communityInsight: AiTool<CommunityInsight | ToolDenial> = {
    name: 'get_community_insight',
    description:
      'Return community-level aggregated interest percentages. Contains no ' +
      'member identifiers and cannot be used to reach them.',
    execute: async (raw) => {
      const params = readParams(raw);
      const granularity = readGranularity(raw);
      const { principalId, communityId, purpose, operation } = params;

      const dataset = await this.resolveLatestDataset(communityId);

      try {
        const loaded = await this.authorizationService.loadAuthorizedDataset(
          principalId,
          { resourceId: dataset.id, purpose, operation },
          granularity,
        );

        return {
          communityId: loaded.communityId,
          datasetId: loaded.id,
          datasetType: loaded.datasetType,
          version: loaded.version,
          data: (loaded.data ?? {}) as Record<string, number>,
          sourceCount: loaded.sourceCount,
          aggregationLevel: AggregationLevel.COMMUNITY,
        };
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;

        // loadAuthorizedDataset throws NotFoundException on denial, to avoid
        // confirming that a resource exists. Correct for a network endpoint,
        // wrong here: a denial is an expected outcome on an internal
        // boundary and the reason must survive to the caller. Re-decide to
        // recover the reason — this writes a second audit row, which is
        // accurate rather than noisy, since the first call was a real
        // decision that was really made.
        const decision = await this.authorizationService.authorize(
          principalId,
          { resourceId: dataset.id, purpose, operation },
          granularity,
        );
        return this.toDenial(decision, granularity ?? AggregationLevel.COMMUNITY);
      }
    },
  };

  /**
   * The second tool: a refusal, with a reason.
   *
   * It consults the engine rather than hardcoding a denial, so the audit trail
   * records a genuine policy evaluation. A caller with no permission at all
   * gets NO_PERMISSION, which is more accurate than "not allowed to see
   * individuals" and should not be obscured by it.
   */
  readonly individualMemberLookup: AiTool<ToolDenial> = {
    name: 'get_individual_members',
    description:
      'Look up which individual members match a criterion. Always denied: ' +
      'no BRAICE permission authorizes individual-level access.',
    execute: async (raw) => {
      const { principalId, communityId, purpose, operation } = readParams(raw);

      const dataset = await this.resolveLatestDataset(communityId);
      const decision = await this.authorizationService.authorize(
        principalId,
        { resourceId: dataset.id, purpose, operation },
        AggregationLevel.INDIVIDUAL,
      );

      if (decision.allowed) {
        // Unreachable while buildDefaultConditions() hard-codes
        // allowIndividualData:false. Logged as an error rather than handled
        // quietly, so relaxing that default can never quietly open a path
        // that nobody reviewed.
        this.logger.error(
          `INDIVIDUAL_DATA_RESTRICTED did not fire for principal ${principalId} ` +
            `on dataset ${dataset.id}: a permission appears to authorize ` +
            `individual data.`,
        );
      }

      return this.toDenial(decision, AggregationLevel.INDIVIDUAL);
    },
  };

  /** Every tool the AI may call. */
  tools(): AiTool[] {
    return [
      this.communityInsight as AiTool,
      this.individualMemberLookup as AiTool,
    ];
  }

  /** Classify whether a question is reaching for member-level detail. */
  requiresIndividualData(question: string): boolean {
    return INDIVIDUAL_INTENT.test(question);
  }

  private toDenial(
    decision: AuthorizationDecision,
    requestedAggregationLevel: AggregationLevel,
  ): ToolDenial {
    return {
      denied: true,
      reason: decision.reason ?? DenialReason.NO_PERMISSION,
      ...(decision.permissionId ? { permissionId: decision.permissionId } : {}),
      requestedAggregationLevel,
    };
  }

  private async resolveLatestDataset(
    communityId: string,
  ): Promise<CommunityDataset> {
    const datasets = await this.datasetsService.findByCommunity(communityId);
    const latest = datasets[0];

    if (!latest) {
      throw new NotFoundException(
        `Community ${communityId} has no dataset. Generate one before querying.`,
      );
    }

    return latest;
  }
}
