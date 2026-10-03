import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request = require('supertest');
import { ObjectLiteral, Repository } from 'typeorm';
import { GovernanceController } from './governance.controller';
import { GovernanceService } from './governance.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AccessRequest } from '../access-requests/entities/access-request.entity';
import { GovernanceDecision } from './entities/governance-decision.entity';
import { Community } from '../communities/entities/community.entity';
import { Membership } from '../memberships/entities/membership.entity';
import type { JwtPayload } from '../auth/auth.service';

const REQUEST = 'req-1';
const COMMUNITY = 'comm-1';

/**
 * Real uuids, because the bodies are validated as such.
 *
 * These used to be readable placeholders ("operator-user-1"), which quietly made
 * the "valid request" cases fail the same `@IsUUID` check that two other tests in
 * this file assert should reject. Beyond the four failures, it meant those two
 * rejection tests were passing for the wrong reason: they sent an unlisted field
 * *and* a malformed uuid, so the 400 proved nothing about `forbidNonWhitelisted`.
 * Legible uuids keep both halves of each test testing what it claims.
 */
const OPERATOR = '11111111-1111-4111-8111-111111111111';
const ATTACKER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';

type MockRepo<T extends ObjectLiteral = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const mockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
});

/**
 * Regression tests for the governance breach.
 *
 * POST /governance/approve and POST /governance/permissions are the only two
 * routes in the system that create authority, and neither checked who was
 * calling: the guard established the caller's identity and `principal.sub` was
 * then used only as the audit actor. Any authenticated account could post an
 * approval naming the operator and 60 fabricated uuids, clear the threshold, and
 * issue itself an enforceable, on-chain-anchored permission to another
 * community's data.
 *
 * These tests assert the operator check, that the body is validated, and that
 * the principal is threaded through to the service.
 */
describe('GovernanceController (e2e)', () => {
  let app: INestApplication;
  let service: {
    evaluate: jest.Mock;
    createPermissionFromDecision: jest.Mock;
    findByRequest: jest.Mock;
  };

  const buildApp = async (principalId: string | null) => {
    service = {
      evaluate: jest.fn().mockResolvedValue({
        id: 'dec-1',
        accessRequestId: REQUEST,
        decision: 'APPROVED',
        approvedBy: [OPERATOR],
        approvalCount: 1,
        threshold: 1,
        decidedAt: new Date('2026-01-01T00:00:00Z'),
        blockchainTx: null,
      }),
      createPermissionFromDecision: jest
        .fn()
        .mockResolvedValue({ id: 'perm-1', policyHash: 'hash-1' }),
      findByRequest: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GovernanceController],
      providers: [
        { provide: GovernanceService, useValue: service },
        { provide: getRepositoryToken(AccessRequest), useValue: mockRepo() },
        { provide: getRepositoryToken(GovernanceDecision), useValue: mockRepo() },
        { provide: getRepositoryToken(Community), useValue: mockRepo() },
        { provide: getRepositoryToken(Membership), useValue: mockRepo() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(
        principalId === null
          ? { canActivate: () => false }
          : {
              canActivate: (context: any) => {
                context
                  .switchToHttp()
                  .getRequest().principal = { sub: principalId } as JwtPayload;
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

    it('refuses to record a decision', () => {
      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/approve`)
        .send({ approvedBy: [OPERATOR] })
        .expect(403);
    });

    it('refuses to issue a permission', () => {
      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/permissions`)
        .send({ principalId: AGENT })
        .expect(403);
    });
  });

  describe('POST /api/access-requests/:id/governance/approve', () => {
    beforeEach(async () => {
      await buildApp(OPERATOR);
    });

    it('records the decision for the operator', () => {
      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/approve`)
        .send({ approvedBy: [OPERATOR] })
        .expect(201)
        .then(() => {
          expect(service.evaluate).toHaveBeenCalledWith(
            REQUEST,
            [OPERATOR],
            OPERATOR,
          );
        });
    });

    it('refuses a body-supplied actor before the service is consulted', async () => {
      // The old handler read `@Body('approvedBy')` and took the principal only
      // for auditing, so there was nowhere in the body to claim an actor — and
      // now `actorId` is not a field the endpoint has at all. The impersonation
      // attempt is stopped at the pipe, which is stronger than passing the actor
      // and having the service ignore it: the service is never asked to decide
      // anything about a request that tried to name its own auditor.
      await request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/approve`)
        .send({ approvedBy: [OPERATOR], actorId: ATTACKER })
        .expect(400);

      expect(service.evaluate).not.toHaveBeenCalled();
    });

    it('rejects an unlisted body field', () => {
      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/approve`)
        .send({ approvedBy: [OPERATOR], threshold: 1 })
        .expect(400);
    });

    it('rejects a non-uuid approver', () => {
      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/approve`)
        .send({ approvedBy: ['not-a-uuid'] })
        .expect(400);
    });

    it('rejects a missing approvedBy', () => {
      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/approve`)
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/access-requests/:id/governance/permissions', () => {
    beforeEach(async () => {
      await buildApp(OPERATOR);
    });

    it('issues for the grantee, acting as the operator', () => {
      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/permissions`)
        .send({ principalId: AGENT })
        .expect(201)
        .then(() => {
          expect(service.createPermissionFromDecision).toHaveBeenCalledWith(
            REQUEST,
            AGENT,
            OPERATOR,
          );
        });
    });

    it('rejects an unlisted body field', () => {
      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/permissions`)
        .send({ principalId: AGENT, communityId: COMMUNITY })
        .expect(400);
    });

    it('rejects a non-uuid principalId', () => {
      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/permissions`)
        .send({ principalId: 'self' })
        .expect(400);
    });

    it('surfaces the operator refusal', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      service.createPermissionFromDecision.mockRejectedValue(
        new ForbiddenException('not the operator'),
      );

      return request(app.getHttpServer())
        .post(`/api/access-requests/${REQUEST}/governance/permissions`)
        .send({ principalId: AGENT })
        .expect(403);
    });
  });

  describe('GET /api/access-requests/:id/governance', () => {
    it('passes the caller sub so the service can gate the read', async () => {
      await buildApp(OPERATOR);

      await request(app.getHttpServer())
        .get(`/api/access-requests/${REQUEST}/governance`)
        .expect(200);

      expect(service.findByRequest).toHaveBeenCalledWith(REQUEST, OPERATOR);
    });
  });
});
