import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

describe('ActivityController (e2e)', () => {
  let app: INestApplication;
  let activityService: { record: jest.Mock; findByCommunity: jest.Mock; findByMember: jest.Mock; getActivityCount: jest.Mock };

  beforeAll(async () => {
    activityService = {
      record: jest.fn(),
      findByCommunity: jest.fn(),
      findByMember: jest.fn(),
      getActivityCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivityController],
      providers: [{ provide: ActivityService, useValue: activityService }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/communities/:communityId/activity', () => {
    it('should record activity', () => {
      const record = { id: 'act-1', activityType: 'clicked', interestCategory: 'streetwear' };
      activityService.record.mockResolvedValue(record);

      return request(app.getHttpServer())
        .post('/api/communities/550e8400-e29b-41d4-a716-446655440000/activity')
        .send({
          memberId: '550e8400-e29b-41d4-a716-446655440001',
          activityType: 'clicked',
          interestCategory: 'streetwear',
          occurredAt: '2026-09-23T12:00:00Z',
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.activityType).toBe('clicked');
        });
    });

    it('should reject missing fields', () => {
      return request(app.getHttpServer())
        .post('/api/communities/comm-1/activity')
        .send({ memberId: 'user-1' })
        .expect(400);
    });
  });

  describe('GET /api/communities/:communityId/activity', () => {
    it('should return activity records', () => {
      activityService.findByCommunity.mockResolvedValue([{ id: '1' }]);

      return request(app.getHttpServer())
        .get('/api/communities/comm-1/activity')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(1);
        });
    });
  });

  describe('GET /api/communities/:communityId/activity/count', () => {
    it('should return count', () => {
      activityService.getActivityCount.mockResolvedValue(500);

      return request(app.getHttpServer())
        .get('/api/communities/comm-1/activity/count')
        .expect(200)
        .expect((res: any) => {
          expect(Number(res.text)).toBe(500);
        });
    });
  });

  describe('GET /api/communities/:communityId/activity/member/:memberId', () => {
    it('should return member activity', () => {
      activityService.findByMember.mockResolvedValue([{ id: '1', memberId: 'user-1' }]);

      return request(app.getHttpServer())
        .get('/api/communities/comm-1/activity/member/user-1')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(1);
        });
    });
  });
});
