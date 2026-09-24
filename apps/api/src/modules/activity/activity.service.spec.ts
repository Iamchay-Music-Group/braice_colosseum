import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, ObjectLiteral } from 'typeorm';
import { ActivityService } from './activity.service';
import { ActivityRecord } from './entities/activity-record.entity';
import { CreateActivityDto } from './dto/create-activity.dto';

type MockRepo<T extends ObjectLiteral = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const mockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  count: jest.fn(),
});

describe('ActivityService', () => {
  let service: ActivityService;
  let repo: MockRepo<ActivityRecord>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityService,
        { provide: getRepositoryToken(ActivityRecord), useValue: mockRepo() },
      ],
    }).compile();

    service = module.get(ActivityService);
    repo = module.get(getRepositoryToken(ActivityRecord));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('record', () => {
    it('should create an activity record', async () => {
      const dto: CreateActivityDto = {
        memberId: 'user-1',
        activityType: 'clicked',
        interestCategory: 'streetwear',
        occurredAt: '2026-09-23T12:00:00Z',
      };
      const saved = {
        id: 'act-1',
        communityId: 'comm-1',
        memberId: 'user-1',
        activityType: 'clicked',
        interestCategory: 'streetwear',
        metadata: null,
        occurredAt: new Date('2026-09-23T12:00:00Z'),
      };

      repo.create!.mockReturnValue(saved);
      repo.save!.mockResolvedValue(saved);

      const result = await service.record('comm-1', dto);

      expect(result).toEqual(saved);
      expect(repo.create).toHaveBeenCalledWith({
        communityId: 'comm-1',
        memberId: 'user-1',
        activityType: 'clicked',
        interestCategory: 'streetwear',
        metadata: null,
        occurredAt: new Date('2026-09-23T12:00:00Z'),
      });
    });

    it('should include metadata when provided', async () => {
      const dto: CreateActivityDto = {
        memberId: 'user-1',
        activityType: 'purchased',
        interestCategory: 'sneakers',
        metadata: { price: 120, currency: 'USD' },
        occurredAt: '2026-09-23T12:00:00Z',
      };

      repo.create!.mockReturnValue({});
      repo.save!.mockResolvedValue({});

      await service.record('comm-1', dto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { price: 120, currency: 'USD' } }),
      );
    });
  });

  describe('findByCommunity', () => {
    it('should return activity records ordered by occurredAt DESC', async () => {
      const records = [
        { id: '2', occurredAt: new Date('2026-09-24') },
        { id: '1', occurredAt: new Date('2026-09-23') },
      ];
      repo.find!.mockResolvedValue(records);

      const result = await service.findByCommunity('comm-1');

      expect(result).toEqual(records);
      expect(repo.find).toHaveBeenCalledWith({
        where: { communityId: 'comm-1' },
        order: { occurredAt: 'DESC' },
      });
    });
  });

  describe('findByMember', () => {
    it('should return activity for a specific member in a community', async () => {
      const records = [{ id: '1', memberId: 'user-1', communityId: 'comm-1' }];
      repo.find!.mockResolvedValue(records);

      const result = await service.findByMember('user-1', 'comm-1');

      expect(result).toEqual(records);
      expect(repo.find).toHaveBeenCalledWith({
        where: { memberId: 'user-1', communityId: 'comm-1' },
        order: { occurredAt: 'DESC' },
      });
    });
  });

  describe('getActivityCount', () => {
    it('should return count of activities', async () => {
      repo.count!.mockResolvedValue(1000);

      const result = await service.getActivityCount('comm-1');

      expect(result).toBe(1000);
      expect(repo.count).toHaveBeenCalledWith({ where: { communityId: 'comm-1' } });
    });
  });
});
