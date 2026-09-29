import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Repository, ObjectLiteral } from 'typeorm';
import { MembershipsService } from './memberships.service';
import { Membership } from './entities/membership.entity';
import { Community } from '../communities/entities/community.entity';

type MockRepo<T extends ObjectLiteral = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const mockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
});

describe('MembershipsService', () => {
  let service: MembershipsService;
  let repo: MockRepo<Membership>;
  let communityRepo: MockRepo<Community>;

  beforeEach(async () => {
    // The service resolves community ownership for its operator checks, so
    // both repositories are required to construct it.
    communityRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: getRepositoryToken(Membership), useValue: mockRepo() },
        { provide: getRepositoryToken(Community), useValue: communityRepo },
      ],
    }).compile();

    service = module.get(MembershipsService);
    repo = module.get(getRepositoryToken(Membership));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('join', () => {
    it('should create a membership', async () => {
      const membership = { id: 'mem-1', communityId: 'comm-1', userId: 'user-1', role: 'MEMBER', status: 'ACTIVE' };

      repo.findOne!.mockResolvedValue(null);
      repo.create!.mockReturnValue(membership);
      repo.save!.mockResolvedValue(membership);

      const result = await service.join('comm-1', 'user-1');

      expect(result).toEqual(membership);
      expect(repo.create).toHaveBeenCalledWith({
        communityId: 'comm-1',
        userId: 'user-1',
        role: 'MEMBER',
        status: 'ACTIVE',
      });
    });

    it('should throw ConflictException on duplicate membership', async () => {
      repo.findOne!.mockResolvedValue({ id: 'existing' });

      await expect(service.join('comm-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('leave', () => {
    it('should remove a membership', async () => {
      const membership = { id: 'mem-1' };
      repo.findOne!.mockResolvedValue(membership);
      repo.remove!.mockResolvedValue(membership);

      await service.leave('comm-1', 'user-1');

      expect(repo.remove).toHaveBeenCalledWith(membership);
    });

    it('should throw NotFoundException for missing membership', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.leave('comm-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByCommunity', () => {
    it('should return members with user relation', async () => {
      const members = [{ id: '1', communityId: 'comm-1', user: {} }];
      repo.find!.mockResolvedValue(members);

      const result = await service.findByCommunity('comm-1');

      expect(result).toEqual(members);
      expect(repo.find).toHaveBeenCalledWith({
        where: { communityId: 'comm-1' },
        relations: ['user'],
        order: { joinedAt: 'ASC' },
      });
    });
  });

  describe('findByUser', () => {
    it('should return memberships for a user', async () => {
      const memberships = [{ id: '1', userId: 'user-1', community: {} }];
      repo.find!.mockResolvedValue(memberships);

      const result = await service.findByUser('user-1');

      expect(result).toEqual(memberships);
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        relations: ['community'],
        order: { joinedAt: 'DESC' },
      });
    });
  });

  describe('getMemberCount', () => {
    it('should return count of active members', async () => {
      repo.count!.mockResolvedValue(42);

      const result = await service.getMemberCount('comm-1');

      expect(result).toBe(42);
      expect(repo.count).toHaveBeenCalledWith({
        where: { communityId: 'comm-1', status: 'ACTIVE' },
      });
    });
  });
});
