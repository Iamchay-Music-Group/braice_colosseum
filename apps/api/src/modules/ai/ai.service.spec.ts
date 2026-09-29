import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AggregationLevel, DenialReason, Operation } from '@braice/permission-engine';
import { AiService } from './ai.service';
import { AiGateway } from './ai.gateway';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/entities/audit-event.entity';
import { AiQueryDto } from './dto/ai-query.dto';

const PRINCIPAL = 'brand-user-id';
const COMMUNITY = 'community-uuid';

const QUERY: AiQueryDto = {
  communityId: COMMUNITY,
  question: 'What are the strongest emerging interests?',
  purpose: 'campaign_planning',
};

const INSIGHT = {
  communityId: COMMUNITY,
  datasetId: 'dataset-uuid',
  datasetType: 'interests',
  version: 3,
  data: { streetwear: 42, music: 31, art: 12 },
  sourceCount: 1000,
  aggregationLevel: AggregationLevel.COMMUNITY,
};

describe('AiService', () => {
  let service: AiService;
  let gateway: {
    communityInsight: { execute: jest.Mock };
    individualMemberLookup: { execute: jest.Mock };
    requiresIndividualData: jest.Mock;
  };
  let audit: { record: jest.Mock };

  /**
   * No AI_API_KEY. The model is therefore unreachable and the service must
   * answer deterministically — which is the deployment this repo actually has.
   */
  function build(env: Record<string, string> = {}) {
    gateway = {
      communityInsight: { execute: jest.fn() },
      individualMemberLookup: { execute: jest.fn() },
      requiresIndividualData: jest.fn().mockReturnValue(false),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const configService = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;

    const moduleRef = Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: configService },
        { provide: AiGateway, useValue: gateway },
        { provide: AuditService, useValue: audit },
      ],
    });

    return moduleRef.compile();
  }

  beforeEach(async () => {
    const moduleRef = await build();
    service = moduleRef.get(AiService);
  });

  describe('with no model configured', () => {
    it('reports itself disabled', () => {
      expect(service.isEnabled()).toBe(false);
    });

    it('labels a deterministic answer as deterministic', async () => {
      // The single most important assertion in this file. A caller that
      // cannot tell a model answer from a computed one will present one as the
      // other, which is the dishonesty this system exists to prevent.
      gateway.communityInsight.execute.mockResolvedValue(INSIGHT);

      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.answerSource).toBe('deterministic');
    });

    it('still answers when no model is reachable', async () => {
      gateway.communityInsight.execute.mockResolvedValue(INSIGHT);

      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.answer).toContain('streetwear');
      expect(result.denied).toBe(false);
    });

    it('never labels a denied response as a model answer', async () => {
      gateway.communityInsight.execute.mockResolvedValue({
        denied: true,
        reason: DenialReason.NO_PERMISSION,
        requestedAggregationLevel: AggregationLevel.COMMUNITY,
      });

      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.answerSource).toBe('deterministic');
      expect(result.denied).toBe(true);
    });
  });

  describe('deterministic composition', () => {
    beforeEach(() => {
      gateway.communityInsight.execute.mockResolvedValue(INSIGHT);
    });

    it('names the strongest category and its percentage', async () => {
      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.answer).toContain('streetwear');
      expect(result.answer).toContain('42%');
    });

    it('reports the aggregation boundary in the answer text', async () => {
      // The answer text is what gets rendered. If it omits the boundary, the
      // UI presents an aggregate as though it described people.
      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.answer).toMatch(/aggregate/i);
      expect(result.answer).toMatch(/no member identities|not any individual/i);
    });

    it('does not invent a count of individual members', async () => {
      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.answer).not.toMatch(/\d+\s+members?/i);
    });

    it('handles a dataset with no categories', async () => {
      gateway.communityInsight.execute.mockResolvedValue({
        ...INSIGHT,
        data: {},
      });

      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.answer).toMatch(/no interest data|not been aggregated/i);
    });

    it('does not claim a runner-up when there is only one category', async () => {
      gateway.communityInsight.execute.mockResolvedValue({
        ...INSIGHT,
        data: { streetwear: 100 },
      });

      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.answer).toMatch(/streetwear/);
      expect(result.answer).not.toMatch(/leads .* by \d+ points/);
    });
  });

  describe('individual-data questions', () => {
    beforeEach(() => {
      gateway.requiresIndividualData.mockReturnValue(true);
      gateway.individualMemberLookup.execute.mockResolvedValue({
        denied: true,
        reason: DenialReason.INDIVIDUAL_DATA_RESTRICTED,
        permissionId: 'permission-1',
        requestedAggregationLevel: AggregationLevel.INDIVIDUAL,
      });
    });

    it('routes to the refusal tool, not the data tool', async () => {
      await service.query(PRINCIPAL, {
        ...QUERY,
        question: 'Who are the most engaged members?',
      });

      expect(gateway.individualMemberLookup.execute).toHaveBeenCalled();
      expect(gateway.communityInsight.execute).not.toHaveBeenCalled();
    });

    it('passes the caller purpose through unchanged', async () => {
      // The purpose is compared verbatim against the grant. Transforming it
      // here would make PURPOSE_MISMATCH unreachable.
      await service.query(PRINCIPAL, {
        ...QUERY,
        question: 'Who are the most engaged members?',
      });

      expect(gateway.individualMemberLookup.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: QUERY.purpose,
          principalId: PRINCIPAL,
        }),
      );
    });

    it('returns denied with the engine reason', async () => {
      const result = await service.query(PRINCIPAL, {
        ...QUERY,
        question: 'Who are the most engaged members?',
      });

      expect(result.denied).toBe(true);
      expect(result.denialReason).toBe(DenialReason.INDIVIDUAL_DATA_RESTRICTED);
    });

    it('returns 200-equivalent content rather than throwing', async () => {
      const result = await service.query(PRINCIPAL, {
        ...QUERY,
        question: 'Who are the most engaged members?',
      });

      expect(result.answer).toMatch(/ACCESS DENIED/i);
    });

    it('explains the boundary in the refusal text', async () => {
      const result = await service.query(PRINCIPAL, {
        ...QUERY,
        question: 'Who are the most engaged members?',
      });

      expect(result.answer).toMatch(/community-level aggregated data only/i);
    });

    it('explains revocation differently from a data boundary', async () => {
      gateway.individualMemberLookup.execute.mockResolvedValue({
        denied: true,
        reason: DenialReason.PERMISSION_REVOKED,
        permissionId: 'permission-1',
        requestedAggregationLevel: AggregationLevel.INDIVIDUAL,
      });

      const result = await service.query(PRINCIPAL, {
        ...QUERY,
        question: 'Who are the most engaged members?',
      });

      expect(result.answer).toMatch(/revoked/i);
    });

    it('points a caller with no permission at approval, not at the data boundary', async () => {
      gateway.individualMemberLookup.execute.mockResolvedValue({
        denied: true,
        reason: DenialReason.NO_PERMISSION,
        requestedAggregationLevel: AggregationLevel.INDIVIDUAL,
      });

      const result = await service.query(PRINCIPAL, {
        ...QUERY,
        question: 'Who are the most engaged members?',
      });

      expect(result.answer).toMatch(/approve an access request/i);
    });
  });

  describe('audit trail', () => {
    it('records a granted AI access event', async () => {
      gateway.communityInsight.execute.mockResolvedValue(INSIGHT);

      await service.query(PRINCIPAL, QUERY);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AI_ACCESS_GRANTED }),
      );
    });

    it('records a denied AI access event', async () => {
      gateway.communityInsight.execute.mockResolvedValue({
        denied: true,
        reason: DenialReason.PURPOSE_MISMATCH,
        requestedAggregationLevel: AggregationLevel.COMMUNITY,
      });

      await service.query(PRINCIPAL, QUERY);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.AI_ACCESS_DENIED }),
      );
    });

    it('records the reason on a denial so a pattern of attempts is visible', async () => {
      gateway.communityInsight.execute.mockResolvedValue({
        denied: true,
        reason: DenialReason.PURPOSE_MISMATCH,
        requestedAggregationLevel: AggregationLevel.COMMUNITY,
      });

      await service.query(PRINCIPAL, QUERY);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: DenialReason.PURPOSE_MISMATCH,
          }),
        }),
      );
    });

    it('records which model or fallback produced the answer', async () => {
      gateway.communityInsight.execute.mockResolvedValue(INSIGHT);

      await service.query(PRINCIPAL, QUERY);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.AI_ANALYSIS_COMPLETED,
          // The audit word must match the word the caller received, or an
          // auditor reconciles two vocabularies for the same event.
          metadata: expect.objectContaining({
            answerSource: 'deterministic',
            modelAvailable: false,
          }),
        }),
      );
    });

    it('records the community on every event', async () => {
      gateway.communityInsight.execute.mockResolvedValue(INSIGHT);

      await service.query(PRINCIPAL, QUERY);

      for (const call of audit.record.mock.calls) {
        expect(call[0]).toEqual(
          expect.objectContaining({ communityId: COMMUNITY, actorId: PRINCIPAL }),
        );
      }
    });
  });

  describe('response shape', () => {
    beforeEach(() => {
      gateway.communityInsight.execute.mockResolvedValue(INSIGHT);
    });

    it('reports COMMUNITY aggregation regardless of the question', async () => {
      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.aggregationLevel).toBe(AggregationLevel.COMMUNITY);
    });

    it('returns the dataset that answered the question', async () => {
      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.resourceId).toBe('dataset-uuid');
    });

    it('omits a permissionId when the tool did not report one', async () => {
      const result = await service.query(PRINCIPAL, QUERY);

      expect(result.permissionId).toBeUndefined();
    });
  });
});
