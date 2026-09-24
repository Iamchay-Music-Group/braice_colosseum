import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

describe('MembershipsController (e2e)', () => {
  let app: INestApplication;
  let membershipsService: { join: jest.Mock; leave: jest.Mock; findByCommunity: jest.Mock };

  beforeAll(async () => {
    membershipsService = {
      join: jest.fn(),
      leave: jest.fn(),
      findByCommunity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MembershipsController],
      providers: [{ provide: MembershipsService, useValue: membershipsService }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/communities/:communityId/members', () => {
    it('should create a membership', () => {
      const membership = { id: 'mem-1', communityId: 'comm-1', userId: 'user-1', role: 'MEMBER', status: 'ACTIVE' };
      membershipsService.join.mockResolvedValue(membership);

      return request(app.getHttpServer())
        .post('/api/communities/comm-1/members')
        .send({ userId: 'user-1' })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.role).toBe('MEMBER');
        });
    });
  });

  describe('DELETE /api/communities/:communityId/members/:userId', () => {
    it('should remove a membership', () => {
      membershipsService.leave.mockResolvedValue(undefined);

      return request(app.getHttpServer())
        .delete('/api/communities/comm-1/members/user-1')
        .expect(200);
    });
  });

  describe('GET /api/communities/:communityId/members', () => {
    it('should return members', () => {
      membershipsService.findByCommunity.mockResolvedValue([
        { id: '1', userId: 'user-1' },
      ]);

      return request(app.getHttpServer())
        .get('/api/communities/comm-1/members')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(1);
        });
    });
  });
});
