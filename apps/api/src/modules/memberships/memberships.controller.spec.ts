import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

const COMMUNITY = 'comm-1';
const CALLER = 'caller-user-1';
const OPERATOR = 'operator-user-1';
const OTHER = 'stranger-9';

const membership = {
  id: 'mem-1',
  communityId: COMMUNITY,
  userId: CALLER,
  role: 'MEMBER',
  status: 'ACTIVE',
  joinedAt: new Date('2026-01-01T00:00:00Z'),
};

const community = { id: COMMUNITY, operatorId: OPERATOR };

/**
 * These are the regression tests for the membership breach: POST /members
 * accepted any userId from the body and DELETE /members/:userId accepted any
 * id, both with no authentication at all. Every test below asserts the new
 * behaviour, and the 401 cases assert the old hole is closed.
 */
describe('MembershipsController (e2e)', () => {
  let app: INestApplication;
  let membershipsService: {
    join: jest.Mock;
    leave: jest.Mock;
    findByCommunity: jest.Mock;
    assertCommunityExists: jest.Mock;
    assertCommunityOperator: jest.Mock;
    isCommunityOperator: jest.Mock;
    isActiveMember: jest.Mock;
    canViewRoster: jest.Mock;
    canModerate: jest.Mock;
    findActiveMembership: jest.Mock;
    assignRole: jest.Mock;
  };

  const buildApp = async (principalId: string | null) => {
    membershipsService = {
      join: jest.fn().mockResolvedValue(membership),
      leave: jest.fn().mockResolvedValue(undefined),
      findByCommunity: jest.fn().mockResolvedValue([membership]),
      assertCommunityExists: jest.fn().mockResolvedValue(community),
      assertCommunityOperator: jest.fn().mockResolvedValue(community),
      isCommunityOperator: jest.fn().mockResolvedValue(false),
      isActiveMember: jest.fn().mockResolvedValue(true),
      canViewRoster: jest.fn().mockResolvedValue(true),
      canModerate: jest.fn().mockResolvedValue(false),
      findActiveMembership: jest
        .fn()
        .mockResolvedValue({ id: 'mem-2', userId: OTHER, role: 'MEMBER' }),
      assignRole: jest.fn().mockResolvedValue({
        id: 'mem-2',
        communityId: COMMUNITY,
        userId: OTHER,
        role: 'MODERATOR',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MembershipsController],
      providers: [
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

  describe('unauthenticated access', () => {
    beforeEach(async () => {
      await buildApp(null);
    });

    it('refuses to join a community', () => {
      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/members`)
        .expect(403);
    });

    it('refuses to leave a community', () => {
      return request(app.getHttpServer())
        .delete(`/api/communities/${COMMUNITY}/members/me`)
        .expect(403);
    });

    it('refuses to remove another member', () => {
      return request(app.getHttpServer())
        .delete(`/api/communities/${COMMUNITY}/members/${OTHER}`)
        .expect(403);
    });

    it('refuses to list the roster', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/members`)
        .expect(403);
    });
  });

  describe('POST /api/communities/:communityId/members', () => {
    beforeEach(async () => {
      await buildApp(CALLER);
    });

    it('joins the authenticated caller', () => {
      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/members`)
        .expect(201)
        .expect((res: any) => {
          expect(res.body.userId).toBe(CALLER);
        });
    });

    it('ignores a userId supplied in the body', () => {
      // The handler declares no @Body DTO, so there is nothing for the
      // validation pipe to inspect and the field is simply never read. The
      // caller still joins as themselves.
      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/members`)
        .send({ userId: OTHER })
        .expect(201);
    });

    it('never asks the service to add the attacker-named user', async () => {
      await request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/members`)
        .send({ userId: OTHER });

      expect(membershipsService.join).toHaveBeenCalledWith(COMMUNITY, CALLER);
      expect(membershipsService.join).not.toHaveBeenCalledWith(
        COMMUNITY,
        OTHER,
      );
    });

    it('checks the community exists first', () => {
      return request(app.getHttpServer())
        .post(`/api/communities/${COMMUNITY}/members`)
        .expect(201)
        .then(() => {
          expect(membershipsService.assertCommunityExists).toHaveBeenCalledWith(
            COMMUNITY,
          );
        });
    });
  });

  describe('DELETE /api/communities/:communityId/members/me', () => {
    beforeEach(async () => {
      await buildApp(CALLER);
    });

    it('removes the authenticated caller', () => {
      return request(app.getHttpServer())
        .delete(`/api/communities/${COMMUNITY}/members/me`)
        .expect(200)
        .then(() => {
          expect(membershipsService.leave).toHaveBeenCalledWith(
            COMMUNITY,
            CALLER,
          );
        });
    });
  });

  describe('DELETE /api/communities/:communityId/members/:userId', () => {
    beforeEach(async () => {
      await buildApp(OPERATOR);
    });

    it('lets the operator remove a member', () => {
      membershipsService.isCommunityOperator.mockResolvedValue(true);

      return request(app.getHttpServer())
        .delete(`/api/communities/${COMMUNITY}/members/${OTHER}`)
        .expect(200)
        .then(() => {
          expect(membershipsService.leave).toHaveBeenCalledWith(
            COMMUNITY,
            OTHER,
          );
        });
    });

    it('surfaces the operator check failure', async () => {
      membershipsService.canModerate.mockResolvedValue(false);
      membershipsService.isCommunityOperator.mockResolvedValue(false);

      return request(app.getHttpServer())
        .delete(`/api/communities/${COMMUNITY}/members/${OTHER}`)
        .expect(403);
    });

    // Removing the operator would leave the community with nobody able to
    // approve, issue, or remove the next member.
    it('never removes the operator', async () => {
      membershipsService.assertCommunityExists.mockResolvedValue({
        ...community,
        operatorId: OTHER,
      });

      await request(app.getHttpServer())
        .delete(`/api/communities/${COMMUNITY}/members/${OTHER}`)
        .expect(403);

      expect(membershipsService.leave).not.toHaveBeenCalled();
    });

    describe('moderator boundaries', () => {
      beforeEach(async () => {
        await buildApp(OPERATOR);
        membershipsService.isCommunityOperator.mockResolvedValue(false);
        membershipsService.canModerate.mockResolvedValue(true);
      });

      it('lets a moderator remove an ordinary member', () => {
        return request(app.getHttpServer())
          .delete(`/api/communities/${COMMUNITY}/members/${OTHER}`)
          .expect(200)
          .then(() => {
            expect(membershipsService.leave).toHaveBeenCalledWith(
              COMMUNITY,
              OTHER,
            );
          });
      });

      it('refuses a moderator removing another moderator', async () => {
        membershipsService.findActiveMembership.mockResolvedValue({
          id: 'mem-3',
          userId: OTHER,
          role: 'MODERATOR',
        });

        await request(app.getHttpServer())
          .delete(`/api/communities/${COMMUNITY}/members/${OTHER}`)
          .expect(403);

        expect(membershipsService.leave).not.toHaveBeenCalled();
      });

      it('refuses a moderator using this route on themselves', async () => {
        membershipsService.canModerate.mockResolvedValue(true);

        await request(app.getHttpServer())
          .delete(`/api/communities/${COMMUNITY}/members/${OPERATOR}`)
          .expect(403);

        expect(membershipsService.leave).not.toHaveBeenCalled();
      });

      it('refuses an ordinary member entirely', async () => {
        membershipsService.canModerate.mockResolvedValue(false);

        await request(app.getHttpServer())
          .delete(`/api/communities/${COMMUNITY}/members/${OTHER}`)
          .expect(403);

        expect(membershipsService.leave).not.toHaveBeenCalled();
      });

      it('lets the operator remove a moderator', async () => {
        membershipsService.isCommunityOperator.mockResolvedValue(true);
        membershipsService.findActiveMembership.mockResolvedValue({
          id: 'mem-3',
          userId: OTHER,
          role: 'MODERATOR',
        });

        await request(app.getHttpServer())
          .delete(`/api/communities/${COMMUNITY}/members/${OTHER}`)
          .expect(200);
      });
    });
  });

  describe('PATCH /api/communities/:communityId/members/:userId', () => {
    beforeEach(async () => {
      await buildApp(OPERATOR);
    });

    it('assigns the role from the body using the caller from the token', async () => {
      await request(app.getHttpServer())
        .patch(`/api/communities/${COMMUNITY}/members/${OTHER}`)
        .send({ role: 'MODERATOR' })
        .expect(200)
        .expect((res: any) => {
          expect(res.body.role).toBe('MODERATOR');
        });

      expect(membershipsService.assignRole).toHaveBeenCalledWith(
        COMMUNITY,
        OTHER,
        'MODERATOR',
        OPERATOR,
      );
    });

    it('rejects a role outside the enum', async () => {
      await request(app.getHttpServer())
        .patch(`/api/communities/${COMMUNITY}/members/${OTHER}`)
        .send({ role: 'SUPREME' })
        .expect(400);

      expect(membershipsService.assignRole).not.toHaveBeenCalled();
    });

    it('rejects a missing role', async () => {
      await request(app.getHttpServer())
        .patch(`/api/communities/${COMMUNITY}/members/${OTHER}`)
        .send({})
        .expect(400);

      expect(membershipsService.assignRole).not.toHaveBeenCalled();
    });

    // A body that also names the caller must not be able to reassign them.
    it('ignores a userId supplied in the body', async () => {
      await request(app.getHttpServer())
        .patch(`/api/communities/${COMMUNITY}/members/${OTHER}`)
        .send({ role: 'MEMBER', userId: 'someone-else' })
        .expect(400);

      expect(membershipsService.assignRole).not.toHaveBeenCalled();
    });

    it('requires authentication', () => {
      return buildApp(null)
        .then(() =>
          request(app.getHttpServer())
            .patch(`/api/communities/${COMMUNITY}/members/${OTHER}`)
            .send({ role: 'MODERATOR' })
            .expect(403),
        );
    });
  });

  describe('GET /api/communities/:communityId/members', () => {
    beforeEach(async () => {
      await buildApp(CALLER);
    });

    it('returns a projected roster', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/members`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body[0]).toEqual({
            id: 'mem-1',
            userId: CALLER,
            role: 'MEMBER',
            joinedAt: expect.any(String),
          });
        });
    });

    it('exposes no status field beyond the projection', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/members`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body[0].status).toBeUndefined();
          expect(res.body[0].community).toBeUndefined();
          expect(res.body[0].user).toBeUndefined();
        });
    });

    it('refuses a non-member', async () => {
      membershipsService.canViewRoster.mockResolvedValue(false);

      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/members`)
        .expect(403);
    });
  });
});
