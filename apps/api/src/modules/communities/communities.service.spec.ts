import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository, ObjectLiteral } from 'typeorm';
import { CommunitiesService } from './communities.service';
import { Community } from './entities/community.entity';
import { CreateCommunityDto } from './dto/create-community.dto';

type MockRepo<T extends ObjectLiteral = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const mockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

describe('CommunitiesService', () => {
  let service: CommunitiesService;
  let repo: MockRepo<Community>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitiesService,
        { provide: getRepositoryToken(Community), useValue: mockRepo() },
      ],
    }).compile();

    service = module.get(CommunitiesService);
    repo = module.get(getRepositoryToken(Community));
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
      const saved = { id: 'comm-1', name: 'Afrobeat Creators', operatorId: 'operator-uuid', governanceConfig: dto.governanceConfig };

      repo.create!.mockReturnValue(saved);
      repo.save!.mockResolvedValue(saved);

      const result = await service.create(dto, 'operator-uuid');

      expect(result).toEqual(saved);
      expect(repo.create).toHaveBeenCalledWith({
        name: 'Afrobeat Creators',
        description: null,
        operatorId: 'operator-uuid',
        governanceConfig: dto.governanceConfig,
      });
    });

    it('should include description when provided', async () => {
      const dto: CreateCommunityDto = {
        name: 'Test',
        description: 'A test community',
        governanceConfig: { approvalMode: 'CREATOR_ONLY', thresholdPercentage: 0 },
      };

      repo.create!.mockReturnValue({});
      repo.save!.mockResolvedValue({});

      await service.create(dto, 'op-1');

      expect(repo.create).toHaveBeenCalledWith(
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
