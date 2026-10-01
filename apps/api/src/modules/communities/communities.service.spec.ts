import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository, ObjectLiteral } from 'typeorm';
import { CommunitiesService } from './communities.service';
import { Community } from './entities/community.entity';
import { Membership } from '../memberships/entities/membership.entity';
import { CreateCommunityDto } from './dto/create-community.dto';

type MockRepo<T extends ObjectLiteral = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const mockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

/**
 * create() runs inside a transaction and reaches the community through
 * `repo.manager`, so the Community mock has to expose an EntityManager-shaped
 * surface. Everything the transaction touches is recorded here for assertions.
 */
function mockManager() {
  const manager = {
    create: jest.fn((_entity: unknown, data: unknown) => data),
    save: jest.fn(async (entity: unknown) => entity),
  };
  const transaction = jest.fn(
    async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
  );
  return { manager: { transaction }, managerSpies: manager, transaction };
}

describe('CommunitiesService', () => {
  let service: CommunitiesService;
  // `manager` is overridden: create() goes through repo.manager.transaction, so
  // it needs an EntityManager shape rather than the flat jest.Mock MockRepo gives.
  let repo: Omit<MockRepo<Community>, 'manager'> & {
    manager: { transaction: jest.Mock };
  };
  let tx: ReturnType<typeof mockManager>;

  beforeEach(async () => {
    tx = mockManager();
    repo = { ...mockRepo(), manager: { transaction: tx.transaction } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitiesService,
        { provide: getRepositoryToken(Community), useValue: repo },
      ],
    }).compile();

    service = module.get(CommunitiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a community', async () => {
      const dto: CreateCommunityDto = {
        name: 'Afrobeat Creators',
        governanceConfig: { approvalMode: 'CREATOR_AND_THRESHOLD', thresholdPercentage: 60 },
      };
      const saved = { id: 'comm-1', name: 'Afrobeat Creators', description: null, operatorId: 'operator-uuid', governanceConfig: dto.governanceConfig };

      tx.managerSpies.create.mockImplementation((_e: unknown, data: unknown) => ({ ...(data as object), id: 'comm-1' }));

      const result = await service.create(dto, 'operator-uuid');

      expect(result).toEqual(saved);
      expect(tx.managerSpies.create).toHaveBeenCalledWith(Community, {
        name: 'Afrobeat Creators',
        description: null,
        operatorId: 'operator-uuid',
        governanceConfig: dto.governanceConfig,
      });
    });

    it('enrols the operator as an ACTIVE OPERATOR member', async () => {
      // The bug this guards: creating a community left its operator off the
      // roster, so the creator saw a Join button on their own community and the
      // member count read 0.
      const dto: CreateCommunityDto = {
        name: 'Afrobeat Creators',
        governanceConfig: { approvalMode: 'CREATOR_ONLY', thresholdPercentage: 0 },
      };

      tx.managerSpies.create.mockImplementation((_e: unknown, data: unknown) => ({ ...(data as object), id: 'comm-9' }));

      await service.create(dto, 'operator-uuid');

      expect(tx.managerSpies.create).toHaveBeenCalledWith(Membership, {
        communityId: 'comm-9',
        userId: 'operator-uuid',
        role: 'OPERATOR',
        status: 'ACTIVE',
      });
      expect(tx.managerSpies.save).toHaveBeenCalledTimes(2);
    });

    it('enrols the operator inside the same transaction as the community', async () => {
      // A community that exists without its operator enrolled is the broken
      // state, so it must never be observable even momentarily.
      const dto: CreateCommunityDto = {
        name: 'Afrobeat Creators',
        governanceConfig: { approvalMode: 'CREATOR_ONLY', thresholdPercentage: 0 },
      };

      await service.create(dto, 'operator-uuid');

      expect(tx.transaction).toHaveBeenCalledTimes(1);
    });

    it('does not persist a community when enrolling the operator fails', async () => {
      const dto: CreateCommunityDto = {
        name: 'Afrobeat Creators',
        governanceConfig: { approvalMode: 'CREATOR_ONLY', thresholdPercentage: 0 },
      };

      tx.managerSpies.save
        .mockResolvedValueOnce({ id: 'comm-1' } as never)
        .mockRejectedValueOnce(new Error('enrol failed') as never);

      await expect(service.create(dto, 'operator-uuid')).rejects.toThrow('enrol failed');
    });

    it('should include description when provided', async () => {
      const dto: CreateCommunityDto = {
        name: 'Test',
        description: 'A test community',
        governanceConfig: { approvalMode: 'CREATOR_ONLY', thresholdPercentage: 0 },
      };

      await service.create(dto, 'op-1');

      expect(tx.managerSpies.create).toHaveBeenCalledWith(
        Community,
        expect.objectContaining({ description: 'A test community' }),
      );
    });
  });

  describe('findById', () => {
    it('should return community with relations', async () => {
      const community = { id: 'comm-1', name: 'Test', operator: {}, memberships: [] };
      repo.findOne!.mockResolvedValue(community);

      const result = await service.findById('comm-1');

      expect(result).toEqual(community);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'comm-1' },
        relations: ['operator', 'memberships'],
      });
    });

    it('should throw NotFoundException for missing community', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return all communities with operator', async () => {
      const communities = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];
      repo.find!.mockResolvedValue(communities);

      const result = await service.findAll();

      expect(result).toEqual(communities);
      expect(repo.find).toHaveBeenCalledWith({
        relations: ['operator'],
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findByOperator', () => {
    it('should return communities for a given operator', async () => {
      const communities = [{ id: '1', operatorId: 'op-1' }];
      repo.find!.mockResolvedValue(communities);

      const result = await service.findByOperator('op-1');

      expect(result).toEqual(communities);
      expect(repo.find).toHaveBeenCalledWith({
        where: { operatorId: 'op-1' },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
