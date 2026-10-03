import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProviderChain,
  AiCompletion,
  AiUnavailableError,
  type ImplementedAiProvider,
} from '@braice/ai-client';
import {
  AggregationLevel,
  DenialReason,
  Operation,
} from '@braice/permission-engine';
import { AiGateway, CommunityInsight, ToolDenial } from './ai.gateway';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/entities/audit-event.entity';
import { AiQueryDto } from './dto/ai-query.dto';
import { AiResponseDto } from './dto/ai-response.dto';
import {
  buildClientConfig,
  describeInactiveChain,
  loadAiConfig,
  validateAiConfig,
  type AiConfig,
} from '../../config/ai.config';

type ToolOutcome = CommunityInsight | ToolDenial;

/**
 * Orchestrates an answer without ever holding a data-access path of its own.
 *
 * The order is the security property: the tool decides, then the model is
 * handed whatever survived. There is no branch in this file that passes
 * community data to the model before the tool has returned it, and the model
 * is never consulted about whether access is allowed.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly config: AiConfig;
  private readonly chain: AiProviderChain;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    private readonly gateway: AiGateway,
    private readonly auditService: AuditService,
  ) {
    this.config = loadAiConfig((key) => configService.get<string>(key));
    validateAiConfig(this.config);

    // Every named provider is handed to the chain, not just the active one. The
    // chain is what does the failing over, so handing it only the active entry
    // would leave it nothing to fail over to.
    this.chain = new AiProviderChain(
      this.config.chain.map((entry) => buildClientConfig(entry, this.config)),
      { cooldownMs: this.config.failoverCooldownSeconds * 1000 },
    );

    this.logChainAtBoot();
  }

  /**
   * Report what the chain will do, so an operator learns from the log rather
   * than by noticing that answers changed character mid-demo.
   */
  private logChainAtBoot(): void {
    if (!this.isEnabled()) {
      this.logger.log(
        `No model configured: ${describeInactiveChain(this.config)}. ` +
          'Answering deterministically.',
      );
      return;
    }

    const names = this.config.chain
      .filter((entry) => entry.provider === this.activeProvider())
      .map((entry) => `${entry.provider} (${entry.model})`)
      .join(', ');

    this.logger.log(
      `AI chain [${this.config.chain
        .map((entry) => entry.provider)
        .join(' -> ')}] starting on ${names}.`,
    );
  }

  /**
   * Which provider is answering now, for the audit trail and health endpoint.
   *
   * Read live from the chain rather than from the boot-time resolution, because
   * those are allowed to disagree: after a failure the chain moves on, and an
   * endpoint still advertising the dead provider would be describing a decision
   * the service is no longer making.
   */
  activeProvider(): ImplementedAiProvider | null {
    return this.chain.activeProvider();
  }

  /** The model that will answer, or null when no provider is configured. */
  activeModel(): string | null {
    return this.chain.activeModel();
  }

  /** Whether a real model is reachable. Surfaced on /api/health. */
  isEnabled(): boolean {
    return this.chain.isEnabled();
  }

  /**
   * Providers currently skipped after a failure, for /api/health.
   *
   * Reported because a silent failover is the one kind of degradation an operator
   * cannot infer from the outside: answers keep arriving and keep looking fine,
   * they are just coming from a different provider than the deployment is named
   * after.
   */
  failedOverProviders(): ImplementedAiProvider[] {
    return this.chain.openBreakers();
  }

  async query(principalId: string, dto: AiQueryDto): Promise<AiResponseDto> {
    const wantsIndividual = this.gateway.requiresIndividualData(dto.question);

    const outcome = wantsIndividual
      ? ((await this.gateway.individualMemberLookup.execute({
          principalId,
          communityId: dto.communityId,
          purpose: dto.purpose,
          operation: Operation.ANALYZE,
        })) as ToolDenial)
      : ((await this.gateway.communityInsight.execute({
          principalId,
          communityId: dto.communityId,
          purpose: dto.purpose,
          operation: Operation.ANALYZE,
        })) as ToolOutcome);

    if ('denied' in outcome) {
      return this.refuse(principalId, dto, outcome);
    }

    return this.answer(principalId, dto, outcome);
  }

  /**
   * A refusal is a successful response, not an error.
   *
   * Returning 200 with denied:true keeps "the policy said no" distinguishable
   * from "the request failed", and lets the caller render the reason the
   * engine produced instead of a generic error.
   */
  private async refuse(
    principalId: string,
    dto: AiQueryDto,
    denial: ToolDenial,
  ): Promise<AiResponseDto> {
    await this.auditService.record({
      communityId: dto.communityId,
      actorId: principalId,
      eventType: AuditEventType.AI_ACCESS_DENIED,
      permissionId: denial.permissionId ?? null,
      metadata: {
        question: dto.question,
        purpose: dto.purpose,
        reason: denial.reason,
        requestedAggregationLevel: denial.requestedAggregationLevel,
      },
    });

    return {
      answer: this.denialNarrative(denial),
      answerSource: 'deterministic',
      denied: true,
      denialReason: denial.reason,
      ...(denial.permissionId ? { permissionId: denial.permissionId } : {}),
      aggregationLevel: denial.requestedAggregationLevel,
    };
  }

  private async answer(
    principalId: string,
    dto: AiQueryDto,
    insight: CommunityInsight,
  ): Promise<AiResponseDto> {
    await this.auditService.record({
      communityId: dto.communityId,
      actorId: principalId,
      eventType: AuditEventType.AI_ACCESS_GRANTED,
      resourceId: insight.datasetId,
      metadata: {
        question: dto.question,
        purpose: dto.purpose,
        aggregationLevel: AggregationLevel.COMMUNITY,
        datasetVersion: insight.version,
      },
    });

    const completion = await this.compose(dto.question, insight);
    const responseSource =
      completion.source === 'llm' ? ('llm' as const) : ('deterministic' as const);

    await this.auditService.record({
      communityId: dto.communityId,
      actorId: principalId,
      eventType: AuditEventType.AI_ANALYSIS_COMPLETED,
      resourceId: insight.datasetId,
        metadata: {
        question: dto.question,
        // The same word the caller receives. The transport's 'unavailable'
        // describes why there was no model; the audit trail records what the
        // answer actually was, so an auditor comparing the log against the
        // response is not left reconciling two vocabularies.
        answerSource: responseSource,
        // Kept alongside, because "there was no model" is the first question
        // anyone asks of a deterministic answer and the log should answer it
        // without a second query.
        modelAvailable: completion.source === 'llm',
        // Which provider and model wrote this specific answer. The chain means
        // "the AI said" is no longer enough to identify the model, so without
        // these two fields an auditor cannot tell a gpt-4 answer from a
        // gpt-oss-20b one, or tell at all whether an open-weight model was in
        // play for this community's data. Null on a deterministic answer,
        // where no model was involved.
        answerProvider: completion.provider,
        answerModel: completion.model,
        // Any provider in failover cooldown at the moment this answer was
        // produced. Empty on a healthy chain, and populated precisely when an
        // answer came from somewhere other than the provider the deployment is
        // named after — which is the single most important thing to be able to
        // reconstruct later, and impossible to infer from the answer itself.
        providersInFailover: this.failedOverProviders(),
        sourceCount: insight.sourceCount,
      },
    });

    return {
      answer: completion.text,
      answerSource: responseSource,
      denied: false,
      resourceId: insight.datasetId,
      aggregationLevel: AggregationLevel.COMMUNITY,
      // Only present when a model actually wrote the text. A caller reading a
      // deterministic answer sees no model field at all rather than one naming
      // a model that never ran.
      ...(completion.source === 'llm' &&
      completion.provider !== null &&
      completion.model !== null
        ? {
            answerProvider: completion.provider,
            answerModel: completion.model,
          }
        : {}),
    };
  }

  /**
   * Ask the chain, and fall back without pretending.
   *
   * Four ways to end up here without a model: no provider in the chain has what
   * it needs, every provider is in failover cooldown, every provider failed, or
   * the request itself was rejected. All four produce a `deterministic` answer
   * computed from the authorized aggregate, and all four are reported as
   * `deterministic` so the caller can say which it was.
   *
   * The chain decides how many providers to try and for how long to skip a
   * failed one; this method does not second-guess it. What matters here is that
   * a degraded answer is never dressed up as a model answer, and that whoever
   * receives it can tell a failover happened.
   */
  private async compose(
    question: string,
    insight: CommunityInsight,
  ): Promise<AiCompletion> {
    if (this.isEnabled()) {
      try {
        return await this.chain.generate(
          this.systemPrompt(),
          this.renderContext(question, insight),
        );
      } catch (error) {
        const reason =
          error instanceof AiUnavailableError
            ? error.message
            : `LLM call failed: ${(error as Error).message}`;

        this.logger.warn(
          `${reason}. Falling back to a deterministic answer computed from ` +
            `dataset ${insight.datasetId} v${insight.version}.`,
        );
      }
    } else {
      this.logger.log(
        `No model configured (${describeInactiveChain(this.config)}). ` +
          `Answering deterministically from dataset ${insight.datasetId}.`,
      );
    }

    // Provider and model are null, not the configured ones. A deterministic
    // answer was not written by any model, and logging the model that *would*
    // have been called is precisely the kind of near-truth the audit trail must
    // not contain.
    return {
      text: this.deterministicAnswer(question, insight),
      source: 'unavailable',
      model: null,
      provider: null,
    };
  }

  private systemPrompt(): string {
    return [
      'You are the BRAICE analysis agent.',
      'You have been given community-level aggregated interest data that a',
      'community has explicitly authorized for this purpose.',
      '',
      'Rules you must follow:',
      '- Answer only from the data provided. It is the complete context.',
      '- These are percentages of aggregated records, not member counts. Never',
      '  state or imply how many specific members are involved; the data does',
      '  not contain member identities and you have no way to know them.',
      '- If asked about individual people, say plainly that the permission',
      '  covers community-level aggregates only.',
      '- Be concise. Two or three sentences unless asked for more.',
    ].join('\n');
  }

  private renderContext(question: string, insight: CommunityInsight): string {
    const rows = Object.entries(insight.data)
      .sort((a, b) => b[1] - a[1])
      .map(([category, pct]) => `- ${category}: ${pct}%`)
      .join('\n');

    return [
      `Community: ${insight.communityId}`,
      `Dataset: ${insight.datasetId} (${insight.datasetType} v${insight.version})`,
      `Aggregated from ${insight.sourceCount} individual activity records.`,
      'Interest distribution:',
      rows || '- (no categories)',
      '',
      `Question: ${question}`,
    ].join('\n');
  }

  /**
   * Compose an answer from the aggregate arithmetic.
   *
   * Not a language model and does not pretend to be one. It reports the
   * strongest categories and restates the aggregation boundary, which is
   * enough to answer the questions this system is actually asked.
   */
  private deterministicAnswer(
    question: string,
    insight: CommunityInsight,
  ): string {
    const ranked = Object.entries(insight.data).sort((a, b) => b[1] - a[1]);

    if (ranked.length === 0) {
      return (
        'No interest data has been aggregated for this community yet. ' +
        'The dataset contains no categories.'
      );
    }

    const [topCategory, topPercent] = ranked[0];
    const [secondCategory, secondPercent] = ranked[1] ?? [null, null];

    const parts: string[] = [
      `${topCategory} is the strongest interest at ${topPercent}% of ${insight.sourceCount} aggregated activity records.`,
    ];

    if (secondCategory && secondPercent !== null) {
      const gap = topPercent - secondPercent;
      parts.push(
        gap >= 5
          ? `It leads ${secondCategory} (${secondPercent}%) by ${gap} points.`
          : `${secondCategory} follows closely at ${secondPercent}%.`,
      );
    }

    const total = ranked.reduce((sum, [, pct]) => sum + pct, 0);
    if (total > 0 && ranked.length >= 3) {
      parts.push(
        `Across ${ranked.length} categories the remaining interests are ` +
          `${ranked
            .slice(2)
            .map(([c, p]) => `${c} ${p}%`)
            .join(', ')}.`,
      );
    }

    parts.push(
      'These are community-level aggregates. They describe the shape of the ' +
        'community, not any individual member, and the dataset contains no ' +
        'member identities.',
    );

    return parts.join(' ');
  }

  /**
   * Explain a denial in the caller's terms.
   *
   * States the actual policy reason rather than a generic refusal, because the
   * reason is the useful part: PERMISSION_REVOKED and NO_PERMISSION call for
   * very different responses from whoever is debugging.
   */
  private denialNarrative(denial: ToolDenial): string {
    const scope =
      denial.requestedAggregationLevel === AggregationLevel.INDIVIDUAL
        ? 'individual member records'
        : 'the requested resource';

    switch (denial.reason) {
      case DenialReason.INDIVIDUAL_DATA_RESTRICTED:
        return (
          'ACCESS DENIED. The current permission authorizes analysis of ' +
          'community-level aggregated data only. Individual-level records are ' +
          'outside the authorized resource scope, so this request cannot be ' +
          'answered from the data BRAICE will release.'
        );

      case DenialReason.PERMISSION_REVOKED:
        return (
          'ACCESS DENIED. The community revoked this permission. Revocation ' +
          'takes effect immediately and is enforced on every subsequent ' +
          'request.'
        );

      case DenialReason.PERMISSION_EXPIRED:
        return (
          'ACCESS DENIED. This permission has passed its expiry and is no ' +
          'longer valid.'
        );

      case DenialReason.PURPOSE_MISMATCH:
        return (
          'ACCESS DENIED. The stated purpose does not match the purpose the ' +
          'community approved. A permission is bound to the purpose it was ' +
          'granted for and cannot be reused for another.'
        );

      case DenialReason.OPERATION_NOT_ALLOWED:
        return (
          'ACCESS DENIED. The permission does not authorize this operation. ' +
          `Attempted: ${Operation.ANALYZE}.`
        );

      case DenialReason.NO_PERMISSION:
        return (
          'ACCESS DENIED. No permission exists for ' +
          `${scope} under this principal. A community must approve an access ` +
          'request and meet its threshold before any analysis is possible.'
        );

      default:
        return `ACCESS DENIED. The permission engine refused access to ${scope}.`;
    }
  }
}
