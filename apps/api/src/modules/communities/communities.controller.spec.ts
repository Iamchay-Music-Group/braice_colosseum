import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';
import { MembershipsService } from '../memberships/memberships.service';

describe('CommunitiesController (e2e)', () => {
  let app: INestApplication;
  let communitiesService: { create: jest.Mock; findAll: jest.Mock; findById: jest.Mock };
  let membershipsService: { findByCommunity: jest.Mock; getMemberCount: jest.Mock };

  beforeAll(async () => {
    communitiesService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
    };
    membershipsService = {
      findByCommunity: jest.fn(),
      getMemberCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommunitiesController],
      providers: [
        { provide: CommunitiesService, useValue: communitiesService },
        { provide: MembershipsService, useValue: membershipsService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/communities', () => {
    it('should create a community', () => {
      const community = { id: 'comm-1', name: 'Afrobeat Creators', operatorId: 'op-1' };
      communitiesService.create.mockResolvedValue(community);

      return request(app.getHttpServer())
        .post('/api/communities')
        .send({
          name: 'Afrobeat Creators',
          operatorId: '550e8400-e29b-41d4-a716-446655440000',
          governanceConfig: { approvalMode: 'CREATOR_AND_THRESHOLD', thresholdPercentage: 60 },
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.name).toBe('Afrobeat Creators');
        });
    });

    it('should reject missing required fields', () => {
      return request(app.getHttpServer())
        .post('/api/communities')
        .send({ name: 'Test' })
        .expect(400);
    });
  });

  describe('GET /api/communities', () => {
    it('should return all communities', () => {
      communitiesService.findAll.mockResolvedValue([{ id: '1' }]);

      return request(app.getHttpServer())
        .get('/api/communities')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(1);
        });
    });
  });

  describe('GET /api/communities/:id', () => {
    it('should return a community', () => {
      communitiesService.findById.mockResolvedValue({ id: 'comm-1', name: 'Test' });

      return request(app.getHttpServer())
        .get('/api/communities/comm-1')
        .expect(200);
    });
  });

  describe('GET /api/communities/:id/member-count', () => {
    it('should return member count', () => {
      membershipsService.getMemberCount.mockResolvedValue(100);

      return request(app.getHttpServer())
        .get('/api/communities/comm-1/member-count')
        .expect(200)
        .expect((res: any) => {
          expect(Number(res.text)).toBe(100);
        });
    });
  });
});
