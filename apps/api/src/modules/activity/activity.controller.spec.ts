import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { CommunitiesService } from '../communities/communities.service';
import { MembershipsService } from '../memberships/memberships.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

const COMMUNITY = '550e8400-e29b-41d4-a716-446655440000';
const MEMBER = '550e8400-e29b-41d4-a716-446655440001';
const OPERATOR = '550e8400-e29b-41d4-a716-446655440002';
const STRANGER = '550e8400-e29b-41d4-a716-446655440003';

const activityRow = {
  id: 'act-1',
  communityId: COMMUNITY,
  memberId: MEMBER,
  activityType: 'clicked',
  interestCategory: 'streetwear',
  metadata: null,
  occurredAt: new Date('2026-09-23T12:00:00Z'),
};

/**
 * Regression tests for the most serious hole in the codebase: the previous
 * controller exposed GET /activity, GET /activity/count and
 * GET /activity/member/:memberId with no authentication, returning raw
 * individual records for any community id.
 *
 * The two routes that returned rows are asserted to be GONE (404), not merely
 * guarded. A route that can be granted access to the individual table is a
 * capability nobody should be able to write, so the answer is that it does not
 * exist.
 */
describe('ActivityController (e2e)', () => {
  let app: INestApplication;
  let activityService: {
    record: jest.Mock;
    findByCommunity: jest.Mock;
    findByMember: jest.Mock;
    getActivityCount: jest.Mock;
  };
  let communitiesService: { findByIdOrNull: jest.Mock };
  let membershipsService: {
    findActiveMembership: jest.Mock;
    isActiveMember: jest.Mock;
  };

  const buildApp = async (principalId: string | null) => {
    activityService = {
      record: jest.fn().mockResolvedValue(activityRow),
      findByCommunity: jest.fn().mockResolvedValue([activityRow]),
      findByMember: jest.fn().mockResolvedValue([activityRow]),
      getActivityCount: jest.fn().mockResolvedValue(500),
    };
    communitiesService = {
      findByIdOrNull: jest
        .fn()
        .mockResolvedValue({ id: COMMUNITY, operatorId: OPERATOR }),
    };
    membershipsService = {
      findActiveMembership: jest.fn().mockResolvedValue({ id: 'mem-1' }),
      isActiveMember: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivityController],
      providers: [
        { provide: ActivityService, useValue: activityService },
        { provide: CommunitiesService, useValue: communitiesService },
        { provide: MembershipsService, useValue: membershipsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(
        principalId === null
          ? { canActivate: () => false }
          : {
              canActivate: (context: any) => {
                context.switchToHttp().getRequest().principal = {
                  sub: principalId,
                } as JwtPayload;
                return true;
              },
            },
      )
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  };

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('routes that returned individual records are gone', () => {
    beforeEach(async () => {
      await buildApp(OPERATOR);
    });

    it('has no route listing community activity', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity`)
        .expect(404);
    });

    it('has no route listing one member activity', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity/member/${MEMBER}`)
        .expect(404);
    });

    it('never calls the service behind the removed routes', async () => {
      await request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity/member/${MEMBER}`)
        .expect(404);

      expect(activityService.findByCommunity).not.toHaveBeenCalled();
      expect(activityService.findByMember).not.toHaveBeenCalled();
    });

    it('does not leak a record even to the operator', () => {
      // The operator legitimately runs the aggregation. Seeing the rows is not
      // part of that, and the count route is what the dashboard needs.
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity/member/${MEMBER}`)
        .expect(404);
    });
  });

  describe('unauthenticated access', () => {
    beforeEach(async () => {
      await buildApp(null);
    });

    it('refuses to record activity', () => {
      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/activity`)
        .send({
          memberId: MEMBER,
          activityType: 'clicked',
          interestCategory: 'streetwear',
          occurredAt: '2026-09-23T12:00:00Z',
        })
        .expect(403);
    });

    it('refuses to read the count', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity/count`)
        .expect(403);
    });
  });

  describe('POST /api/communities/:communityId/activity', () => {
    beforeEach(async () => {
      await buildApp(OPERATOR);
    });

    it('records activity for the operator', () => {
      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/activity`)
        .send({
          memberId: MEMBER,
          activityType: 'clicked',
          interestCategory: 'streetwear',
          occurredAt: '2026-09-23T12:00:00Z',
        })
        .expect(201);
    });

    it('returns only the id, not the stored row', () => {
      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/activity`)
        .send({
          memberId: MEMBER,
          activityType: 'clicked',
          interestCategory: 'streetwear',
          occurredAt: '2026-09-23T12:00:00Z',
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toEqual({ id: 'act-1' });
        });
    });

    it('refuses a caller who does not operate the community', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      communitiesService.findByIdOrNull.mockResolvedValue({
        id: COMMUNITY,
        operatorId: 'someone-else',
      });

      await buildApp(STRANGER);

      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/activity`)
        .send({
          memberId: MEMBER,
          activityType: 'clicked',
          interestCategory: 'streetwear',
          occurredAt: '2026-09-23T12:00:00Z',
        })
        .expect(403);
    });

    it('does not record when the caller is not the operator', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      await buildApp(STRANGER);
      communitiesService.findByIdOrNull.mockResolvedValue({
        id: COMMUNITY,
        operatorId: 'someone-else',
      });

      await request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/activity`)
        .send({
          memberId: MEMBER,
          activityType: 'clicked',
          interestCategory: 'streetwear',
          occurredAt: '2026-09-23T12:00:00Z',
        })
        .expect(403);

      expect(activityService.record).not.toHaveBeenCalled();
    });

    it('rejects a memberId with no active membership', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      membershipsService.findActiveMembership.mockResolvedValue(null);

      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/activity`)
        .send({
          memberId: STRANGER,
          activityType: 'clicked',
          interestCategory: 'streetwear',
          occurredAt: '2026-09-23T12:00:00Z',
        })
        .expect(404);
    });

    it('validates the body', () => {
      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/activity`)
        .send({ memberId: MEMBER })
        .expect(400);
    });
  });

  describe('GET /api/communities/:communityId/activity/count', () => {
    beforeEach(async () => {
      await buildApp(MEMBER);
    });

    it('returns a count for a member', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity/count`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toEqual({ count: 500 });
        });
    });

    it('returns a count for the operator', async () => {
      await buildApp(OPERATOR);

      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity/count`)
        .expect(200);
    });

    it('refuses a non-member', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      await buildApp(STRANGER);
      membershipsService.isActiveMember.mockResolvedValue(false);

      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity/count`)
        .expect(403);
    });

    it('never returns a record, only a number', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/activity/count`)
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(false);
          expect(res.body.memberId).toBeUndefined();
        });
    });
  });
});
