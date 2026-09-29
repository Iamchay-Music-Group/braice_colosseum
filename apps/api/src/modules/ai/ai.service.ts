import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiClient,
  AiCompletion,
  AiUnavailableError,
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
import { loadAiConfig, AiConfig, isAiConfigured } from '../../config/ai.config';

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
  private readonly client: AiClient;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    private readonly gateway: AiGateway,
    private readonly auditService: AuditService,
  ) {
    this.config = loadAiConfig((key) => configService.get<string>(key));
    this.client = new AiClient({
      provider: this.config.provider,
      apiKey: this.config.apiKey,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
  }

  /** Whether a real model is reachable. Surfaced on /api/health. */
  isEnabled(): boolean {
    return isAiConfigured(this.config) && this.client.isEnabled();
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
        sourceCount: insight.sourceCount,
      },
    });

    return {
      answer: completion.text,
      answerSource: responseSource,
      denied: false,
      resourceId: insight.datasetId,
      aggregationLevel: AggregationLevel.COMMUNITY,
    };
  }

  /**
   * Ask the model, and fall back without pretending.
   *
   * Three ways to end up here without a model: not configured, provider not
   * implemented, or the API call failed. All three produce a
   * `deterministic` answer computed from the authorized aggregate, and all
   * three are reported as `deterministic` so the caller can say which it was.
   */
  private async compose(
    question: string,
    insight: CommunityInsight,
  ): Promise<AiCompletion> {
    if (this.isEnabled()) {
      try {
        return await this.client.generate(
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
        `No model configured (${this.client.disabledReason()}). ` +
          `Answering deterministically from dataset ${insight.datasetId}.`,
      );
    }

    return {
      text: this.deterministicAnswer(question, insight),
      source: 'unavailable',
      model: null,
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
