import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatasetAccessQueryDto } from './dto/dataset-access-query.dto';
import { DatasetsController } from './datasets.controller';
import { DatasetsService } from './datasets.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { MembershipsService } from '../memberships/memberships.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import type { CommunityDataset } from './entities/community-dataset.entity';

const COMMUNITY = 'community-uuid';
const DATASET = 'dataset-uuid';
const OPERATOR = { sub: 'operator-id' } as JwtPayload;
const MEMBER = { sub: 'member-id' } as JwtPayload;
const PARTNER = { sub: 'partner-id' } as JwtPayload;

const DATASET_ROW: CommunityDataset = {
  id: DATASET,
  communityId: COMMUNITY,
  datasetType: 'interests',
  version: 3,
  data: { streetwear: 27, sneakers: 17 },
  sourceCount: 1000,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as CommunityDataset;

describe('DatasetsController', () => {
  let controller: DatasetsController;
  let datasets: {
    findCommunity: jest.Mock;
    findCommunityIdOf: jest.Mock;
    findByCommunity: jest.Mock;
    findById: jest.Mock;
    requireById: jest.Mock;
    generate: jest.Mock;
  };
  let authorization: { loadAuthorizedDataset: jest.Mock };
  let memberships: { isActiveMember: jest.Mock };

  beforeEach(async () => {
    datasets = {
      findCommunity: jest.fn().mockResolvedValue({ id: COMMUNITY, operatorId: OPERATOR.sub }),
      findCommunityIdOf: jest.fn().mockResolvedValue(COMMUNITY),
      findByCommunity: jest.fn().mockResolvedValue([DATASET_ROW]),
      findById: jest.fn().mockResolvedValue(DATASET_ROW),
      requireById: jest.fn().mockResolvedValue(DATASET_ROW),
      generate: jest.fn().mockResolvedValue(DATASET_ROW),
    };
    authorization = {
      loadAuthorizedDataset: jest.fn().mockResolvedValue(DATASET_ROW),
    };
    memberships = { isActiveMember: jest.fn().mockResolvedValue(false) };

    const moduleRef = await Test.createTestingModule({
      controllers: [DatasetsController],
      providers: [
        { provide: DatasetsService, useValue: datasets },
        { provide: AuthorizationService, useValue: authorization },
        { provide: MembershipsService, useValue: memberships },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(DatasetsController);
  });

  describe('POST /communities/:communityId/datasets/generate', () => {
    it('refuses a caller who is not the operator', async () => {
      await expect(
        controller.generate(COMMUNITY, 'interests', MEMBER),
      ).rejects.toThrow(ForbiddenException);

      expect(datasets.generate).not.toHaveBeenCalled();
    });

    it('does not aggregate for a non-operator', async () => {
      await expect(
        controller.generate(COMMUNITY, undefined, MEMBER),
      ).rejects.toThrow(ForbiddenException);

      // The important half: no individual record is read on a refused call.
      expect(datasets.generate).not.toHaveBeenCalled();
    });

    it('lets the operator aggregate', async () => {
      await controller.generate(COMMUNITY, 'interests', OPERATOR);

      expect(datasets.generate).toHaveBeenCalledWith(COMMUNITY, 'interests');
    });

    it('defaults the dataset type rather than passing undefined through', async () => {
      await controller.generate(COMMUNITY, undefined, OPERATOR);

      expect(datasets.generate).toHaveBeenCalledWith(COMMUNITY, 'interests');
    });

    it('reports an unknown community as 404, not as a permission failure', async () => {
      datasets.findCommunity.mockResolvedValue(null);

      await expect(
        controller.generate('nope', 'interests', OPERATOR),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('GET /communities/:communityId/datasets', () => {
    it('does not return the aggregate to a member', async () => {
      memberships.isActiveMember.mockResolvedValue(true);

      const [summary] = await controller.findByCommunity(COMMUNITY, MEMBER);

      // The whole point. A member with no permission could read the governed
      // aggregate by listing it instead of fetching it.
      expect(summary).not.toHaveProperty('data');
      expect(summary).toEqual({
        id: DATASET,
        datasetType: 'interests',
        version: 3,
        sourceCount: 1000,
        createdAt: DATASET_ROW.createdAt,
      });
    });

    it('does not return the aggregate to the operator either', async () => {
      const [summary] = await controller.findByCommunity(COMMUNITY, OPERATOR);

      // One rule, no special cases: listing says what exists, reading it is a
      // separate governed act. The operator can still read their own data
      // through GET /datasets/:id.
      expect(summary).not.toHaveProperty('data');
    });

    it('never forwards the data column', async () => {
      memberships.isActiveMember.mockResolvedValue(true);

      const result = await controller.findByCommunity(COMMUNITY, MEMBER);

      for (const row of result) {
        expect(Object.keys(row)).not.toContain('data');
        expect(JSON.stringify(row)).not.toContain('streetwear');
      }
    });

    it('refuses a caller who is neither member nor operator', async () => {
      await expect(
        controller.findByCommunity(COMMUNITY, PARTNER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not consult the engine, because no contents are served', async () => {
      await controller.findByCommunity(COMMUNITY, OPERATOR);

      expect(authorization.loadAuthorizedDataset).not.toHaveBeenCalled();
    });
  });

  describe('GET /datasets/:id', () => {
    const query = { purpose: 'campaign_planning', operation: 'ANALYZE' } as const;

    it('routes a non-operator through the authorizing loader', async () => {
      memberships.isActiveMember.mockResolvedValue(true);

      const result = await controller.findById(DATASET, query, MEMBER);

      expect(authorization.loadAuthorizedDataset).toHaveBeenCalledWith(
        MEMBER.sub,
        { resourceId: DATASET, purpose: 'campaign_planning', operation: 'ANALYZE' },
      );
      expect(result).toEqual(DATASET_ROW);
    });

    it('lets the operator read their own data without a permission', async () => {
      const result = await controller.findById(DATASET, query, OPERATOR);

      expect(result).toEqual(DATASET_ROW);
      expect(authorization.loadAuthorizedDataset).not.toHaveBeenCalled();
    });

    it('does not read the dataset row before the permission check', async () => {
      await controller.findById(DATASET, query, MEMBER);

      // findById materialises the whole row. The controller must not call it
      // before the engine has decided; the ownership lookup reads one column.
      expect(datasets.findById).not.toHaveBeenCalled();
      expect(datasets.findCommunityIdOf).toHaveBeenCalledWith(DATASET);
    });

    it('passes the declared purpose and operation through unchanged', async () => {
      await controller.findById(
        DATASET,
        { purpose: 'market_research', operation: 'EXPORT' } as const,
        MEMBER,
      );

      expect(
        authorization.loadAuthorizedDataset.mock.calls[0][1],
      ).toMatchObject({ purpose: 'market_research', operation: 'EXPORT' });
    });

    it('surfaces a denial from the loader rather than re-deciding', async () => {
      authorization.loadAuthorizedDataset.mockRejectedValue(
        new NotFoundException('Dataset not found'),
      );

      await expect(
        controller.findById(DATASET, query, MEMBER),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s a dataset id that does not exist', async () => {
      datasets.findCommunityIdOf.mockResolvedValue(null);

      await expect(
        controller.findById('nope', query, OPERATOR),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('query validation', () => {
    // The controller casts query.operation to the engine's Operation enum.
    // Nothing checked the string first, so a caller could send any value and it
    // would arrive as a non-Operation the engine had never seen. DTO validation
    // is what makes the cast honest.
    const errorsFor = async (plain: Record<string, unknown>) => {
      const instance = plainToInstance(DatasetAccessQueryDto, plain);
      const errors = await validate(instance);
      return errors.map((e) => e.property);
    };

    it('rejects a missing operation', async () => {
      expect(await errorsFor({ purpose: 'campaign_planning' })).toContain(
        'operation',
      );
    });

    it('rejects an operation outside the engine enum', async () => {
      expect(
        await errorsFor({
          purpose: 'campaign_planning',
          operation: 'DROP TABLE',
        }),
      ).toContain('operation');
    });

    it('rejects an empty purpose', async () => {
      expect(await errorsFor({ purpose: '', operation: 'READ' })).toContain(
        'purpose',
      );
    });

    it('accepts the three operations the engine defines', async () => {
      for (const operation of ['READ', 'ANALYZE', 'EXPORT']) {
        expect(
          await errorsFor({ purpose: 'campaign_planning', operation }),
        ).toEqual([]);
      }
    });
  });
});
