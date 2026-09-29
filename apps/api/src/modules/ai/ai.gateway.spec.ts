import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  AggregationLevel,
  AuthorizationDecision,
  DenialReason,
  Operation,
} from '@braice/permission-engine';
import { AiGateway } from './ai.gateway';
import { AuthorizationService } from '../authorization/authorization.service';
import { DatasetsService } from '../datasets/datasets.service';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';

const PRINCIPAL = 'brand-user-id';
const COMMUNITY = 'community-uuid';
const PURPOSE = 'campaign_planning';

const DATASET = {
  id: 'dataset-uuid',
  communityId: COMMUNITY,
  datasetType: 'interests',
  version: 3,
  data: { streetwear: 42, music: 31 },
  sourceCount: 1000,
} as unknown as CommunityDataset;

function deny(reason: DenialReason) {
  return {
    allowed: false,
    reason,
    permissionId: 'permission-1',
  } as AuthorizationDecision;
}

describe('AiGateway', () => {
  let gateway: AiGateway;
  let authorization: {
    authorize: jest.Mock;
    loadAuthorizedDataset: jest.Mock;
  };
  let datasets: { findByCommunity: jest.Mock };

  beforeEach(async () => {
    authorization = {
      authorize: jest.fn(),
      loadAuthorizedDataset: jest.fn(),
    };
    datasets = { findByCommunity: jest.fn().mockResolvedValue([DATASET]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiGateway,
        { provide: AuthorizationService, useValue: authorization },
        { provide: DatasetsService, useValue: datasets },
      ],
    }).compile();

    gateway = moduleRef.get(AiGateway);
  });

  describe('communityInsight', () => {
    it('returns aggregate data and never a member identifier', async () => {
      authorization.loadAuthorizedDataset.mockResolvedValue(DATASET);

      const result = await gateway.communityInsight.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
      });

      expect(result).toEqual({
        communityId: COMMUNITY,
        datasetId: DATASET.id,
        datasetType: 'interests',
        version: 3,
        data: { streetwear: 42, music: 31 },
        sourceCount: 1000,
        aggregationLevel: AggregationLevel.COMMUNITY,
      });
    });

    it('always reports COMMUNITY aggregation', async () => {
      authorization.loadAuthorizedDataset.mockResolvedValue(DATASET);

      const result = (await gateway.communityInsight.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
      })) as { aggregationLevel: AggregationLevel };

      expect(result.aggregationLevel).toBe(AggregationLevel.COMMUNITY);
    });

    it('reads only through the authorize-then-read helper', async () => {
      // Data is obtainable from exactly one call, and that call performs its
      // own authorization internally. There is no path where a repository is
      // consulted directly, so "forgot to check first" is not a mistake this
      // method is capable of making.
      authorization.loadAuthorizedDataset.mockResolvedValue(DATASET);

      await gateway.communityInsight.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
      });

      expect(authorization.loadAuthorizedDataset).toHaveBeenCalledTimes(1);
    });

    it('forwards the requested granularity to the authorization check', async () => {
      // Without this, an INDIVIDUAL request would be judged as if it were a
      // COMMUNITY one and allowed against a community-level grant.
      authorization.loadAuthorizedDataset.mockRejectedValue(
        new NotFoundException('Access denied: INDIVIDUAL_DATA_RESTRICTED'),
      );
      authorization.authorize.mockResolvedValue(
        deny(DenialReason.INDIVIDUAL_DATA_RESTRICTED),
      );

      await gateway.communityInsight.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
        granularity: AggregationLevel.INDIVIDUAL,
      });

      expect(authorization.loadAuthorizedDataset).toHaveBeenCalledWith(
        PRINCIPAL,
        expect.objectContaining({ resourceId: DATASET.id }),
        AggregationLevel.INDIVIDUAL,
      );
    });

    it('does not re-decide on the allow path', async () => {
      // A denial is recovered by re-deciding to get the reason. On success
      // that would mean a second audit row for one question, so it must not
      // happen.
      authorization.loadAuthorizedDataset.mockResolvedValue(DATASET);

      await gateway.communityInsight.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
      });

      expect(authorization.authorize).not.toHaveBeenCalled();
    });

    it('recovers the denial reason instead of leaking NotFoundException', async () => {
      authorization.loadAuthorizedDataset.mockRejectedValue(
        new NotFoundException('Access denied: PURPOSE_MISMATCH'),
      );
      authorization.authorize.mockResolvedValue(
        deny(DenialReason.PURPOSE_MISMATCH),
      );

      const result = (await gateway.communityInsight.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
      })) as { denied: boolean; reason: DenialReason };

      expect(result.denied).toBe(true);
      expect(result.reason).toBe(DenialReason.PURPOSE_MISMATCH);
    });

    it('re-throws errors that are not denial masking', async () => {
      authorization.loadAuthorizedDataset.mockRejectedValue(
        new Error('database is down'),
      );

      await expect(
        gateway.communityInsight.execute({
          principalId: PRINCIPAL,
          communityId: COMMUNITY,
          purpose: PURPOSE,
          operation: Operation.ANALYZE,
        }),
      ).rejects.toThrow('database is down');
    });

    it('refuses when the community has no dataset', async () => {
      datasets.findByCommunity.mockResolvedValue([]);

      await expect(
        gateway.communityInsight.execute({
          principalId: PRINCIPAL,
          communityId: COMMUNITY,
          purpose: PURPOSE,
          operation: Operation.ANALYZE,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a missing principalId rather than auditing nobody', async () => {
      await expect(
        gateway.communityInsight.execute({
          communityId: COMMUNITY,
          purpose: PURPOSE,
          operation: Operation.ANALYZE,
        }),
      ).rejects.toThrow(/principalId/);
    });

    it('rejects an unknown operation', async () => {
      await expect(
        gateway.communityInsight.execute({
          principalId: PRINCIPAL,
          communityId: COMMUNITY,
          purpose: PURPOSE,
          operation: 'DELETE_EVERYTHING',
        }),
      ).rejects.toThrow(/operation/);
    });
  });

  describe('individualMemberLookup', () => {
    it('is denied for a caller with a valid community permission', async () => {
      authorization.authorize.mockResolvedValue(
        deny(DenialReason.INDIVIDUAL_DATA_RESTRICTED),
      );

      const result = await gateway.individualMemberLookup.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
      });

      expect(result.denied).toBe(true);
      expect(result.requestedAggregationLevel).toBe(
        AggregationLevel.INDIVIDUAL,
      );
    });

    it('reports NO_PERMISSION rather than blaming the data boundary', async () => {
      authorization.authorize.mockResolvedValue(deny(DenialReason.NO_PERMISSION));

      const result = await gateway.individualMemberLookup.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
      });

      expect(result.reason).toBe(DenialReason.NO_PERMISSION);
    });

    it('asks the engine at INDIVIDUAL granularity', async () => {
      authorization.authorize.mockResolvedValue(
        deny(DenialReason.INDIVIDUAL_DATA_RESTRICTED),
      );

      await gateway.individualMemberLookup.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
      });

      expect(authorization.authorize).toHaveBeenCalledWith(
        PRINCIPAL,
        expect.objectContaining({ resourceId: DATASET.id }),
        AggregationLevel.INDIVIDUAL,
      );
    });

    it('never reads the dataset, only decides', async () => {
      authorization.authorize.mockResolvedValue(
        deny(DenialReason.INDIVIDUAL_DATA_RESTRICTED),
      );

      await gateway.individualMemberLookup.execute({
        principalId: PRINCIPAL,
        communityId: COMMUNITY,
        purpose: PURPOSE,
        operation: Operation.ANALYZE,
      });

      expect(authorization.loadAuthorizedDataset).not.toHaveBeenCalled();
    });
  });

  describe('requiresIndividualData', () => {
    it.each([
      'which members are most engaged?',
      'Who are the top contributors?',
      'what are their usernames?',
    ])('flags an individual question: %s', (question) => {
      expect(gateway.requiresIndividualData(question)).toBe(true);
    });

    it.each([
      'What are the strongest emerging interests?',
      'how is interest distributed?',
      'summarise the top three categories',
    ])('does not flag an aggregate question: %s', (question) => {
      expect(gateway.requiresIndividualData(question)).toBe(false);
    });
  });

  describe('tools', () => {
    it('exposes exactly two tools, one of which only refuses', () => {
      const names = gateway.tools().map((t) => t.name);

      expect(names).toEqual([
        'get_community_insight',
        'get_individual_members',
      ]);
    });
  });
});
