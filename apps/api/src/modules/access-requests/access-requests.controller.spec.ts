import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request = require('supertest');
import { ObjectLiteral, Repository } from 'typeorm';
import { AccessRequestsController } from './access-requests.controller';
import { AccessRequestsService } from './access-requests.service';
import { MembershipsService } from '../memberships/memberships.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AccessRequest } from './entities/access-request.entity';
import { AuditEvent } from '../audit/entities/audit-event.entity';
import { Community } from '../communities/entities/community.entity';
import { Membership } from '../memberships/entities/membership.entity';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Real uuids throughout, because the body is validated as such — see the note
 * in governance.controller.spec.ts for why readable placeholders made the same
 * class of test pass for the wrong reason.
 */
const MEMBER = '11111111-1111-4111-8111-111111111111';
const OUTSIDER = '22222222-2222-4222-8222-222222222222';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const DATASET = '44444444-4444-4444-8444-444444444444';

const VALID_BODY = {
  communityId: COMMUNITY,
  datasetId: DATASET,
  purpose: 'campaign_planning',
  operation: 'ANALYZE',
  requestedDurationSeconds: 2592000,
};

type MockRepo<T extends ObjectLiteral = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const mockRepo = (): MockRepo => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

/**
 * Two things are asserted here, and both were gaps rather than bugs in the
 * sense of a wrong answer coming out of working code.
 *
 * The body was an inline object literal on the controller, which the global
 * ValidationPipe cannot inspect — with no class to reflect over, `whitelist` and
 * `forbidNonWhitelisted` have nothing to apply. Every field went through
 * unchecked, including the operation and the duration, both of which end up in
 * an enforceable policy.
 *
 * And membership was not checked, while Swagger already promised a 403 for it.
 * A request writes an ACCESS_REQUESTED row into that community's audit trail and
 * puts a pending proposal in front of its operator, so an outsider filing one is
 * a way to write into a community's record and to spend its operator's time.
 * The request still grants nothing — but "grants nothing" is an argument about
 * the decision, not about the audit trail and the operator's attention.
 */
describe('AccessRequestsController (e2e)', () => {
  let app: INestApplication;
  let service: { create: jest.Mock; findById: jest.Mock; findByCommunity: jest.Mock };
  let memberships: { isActiveMember: jest.Mock; isCommunityOperator: jest.Mock };

  const buildApp = async (principalId: string | null) => {
    service = {
      create: jest.fn().mockImplementation((dto: object) => ({
        id: 'req-1',
        ...dto,
        status: 'PENDING',
      })),
      findById: jest.fn().mockResolvedValue({ id: 'req-1' }),
      findByCommunity: jest.fn().mockResolvedValue([]),
    };

    // Membership is the default so the validation cases are not confounded by a
    // 403; the membership cases set it explicitly.
    memberships = {
      isActiveMember: jest.fn().mockResolvedValue(true),
      isCommunityOperator: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccessRequestsController],
      providers: [
        { provide: AccessRequestsService, useValue: service },
        { provide: MembershipsService, useValue: memberships },
        { provide: getRepositoryToken(AccessRequest), useValue: mockRepo() },
        { provide: getRepositoryToken(AuditEvent), useValue: mockRepo() },
        { provide: getRepositoryToken(Community), useValue: mockRepo() },
        { provide: getRepositoryToken(Membership), useValue: mockRepo() },
        { provide: getRepositoryToken(CommunityDataset), useValue: mockRepo() },
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

  describe('POST /api/access-requests', () => {
    it('files the request for an active member', async () => {
      await buildApp(MEMBER);

      await request(app.getHttpServer())
        .post('/api/access-requests')
        .send(VALID_BODY)
        .expect(201);

      expect(memberships.isActiveMember).toHaveBeenCalledWith(
        MEMBER,
        COMMUNITY,
      );
      expect(service.create).toHaveBeenCalledWith({
        ...VALID_BODY,
        requesterId: MEMBER,
      });
    });

    it('refuses a caller who is not an active member of the community', async () => {
      await buildApp(OUTSIDER);
      memberships.isActiveMember.mockResolvedValue(false);

      await request(app.getHttpServer())
        .post('/api/access-requests')
        .send(VALID_BODY)
        .expect(403);

      // The service must never be reached: a refusal here is a decision, and
      // letting the request through to be recorded and only then refused would
      // put the audit row and the operator's queue first.
      expect(service.create).not.toHaveBeenCalled();
    });

    it('refuses a body-supplied requester rather than ignoring it', async () => {
      await buildApp(OUTSIDER);
      memberships.isActiveMember.mockResolvedValue(false);

      // Naming someone else who *is* a member is the impersonation attempt. It
      // dies at the pipe, not at the membership check, which is the stronger
      // outcome: the service is never asked about a request that tried to
      // choose its own author.
      await request(app.getHttpServer())
        .post('/api/access-requests')
        .send({ ...VALID_BODY, requesterId: MEMBER })
        .expect(400);

      expect(service.create).not.toHaveBeenCalled();
      expect(memberships.isActiveMember).not.toHaveBeenCalled();
    });

    it('rejects an unknown operation', async () => {
      await buildApp(MEMBER);

      await request(app.getHttpServer())
        .post('/api/access-requests')
        .send({ ...VALID_BODY, operation: 'DELETE_EVERYTHING' })
        .expect(400);

      expect(service.create).not.toHaveBeenCalled();
    });

    it('rejects a non-integer duration', async () => {
      await buildApp(MEMBER);

      await request(app.getHttpServer())
        .post('/api/access-requests')
        .send({ ...VALID_BODY, requestedDurationSeconds: 'forever' })
        .expect(400);

      expect(service.create).not.toHaveBeenCalled();
    });

    it('rejects a duration beyond a year', async () => {
      await buildApp(MEMBER);

      // The requested lifetime becomes the window a permission is issued for,
      // so an unbounded request would be a request for a grant no community is
      // likely to review.
      await request(app.getHttpServer())
        .post('/api/access-requests')
        .send({ ...VALID_BODY, requestedDurationSeconds: 10 * 365 * 24 * 3600 })
        .expect(400);

      expect(service.create).not.toHaveBeenCalled();
    });

    it('rejects a missing datasetId', async () => {
      await buildApp(MEMBER);

      const { datasetId: _omitted, ...withoutDataset } = VALID_BODY;

      await request(app.getHttpServer())
        .post('/api/access-requests')
        .send(withoutDataset)
        .expect(400);

      expect(service.create).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated request', async () => {
      await buildApp(null);

      await request(app.getHttpServer())
        .post('/api/access-requests')
        .send(VALID_BODY)
        .expect(403);

      expect(service.create).not.toHaveBeenCalled();
    });
  });
});