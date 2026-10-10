import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';
import { MembershipsService } from '../memberships/memberships.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

const COMMUNITY = '550e8400-e29b-41d4-a716-446655440000';
const OPERATOR = '550e8400-e29b-41d4-a716-446655440001';
const MEMBER = '550e8400-e29b-41d4-a716-446655440002';
const STRANGER = '550e8400-e29b-41d4-a716-446655440003';

describe('CommunitiesController (e2e)', () => {
  let app: INestApplication;
  let communitiesService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    findByIdOrNull: jest.Mock;
  };
  let membershipsService: {
    findByCommunity: jest.Mock;
    getMemberCount: jest.Mock;
    assertCommunityExists: jest.Mock;
    canViewRoster: jest.Mock;
    isActiveMember: jest.Mock;
  };

  const buildApp = async (principalId: string | null) => {
    communitiesService = {
      create: jest.fn().mockResolvedValue({
        id: COMMUNITY,
        name: 'Afrobeat Creators',
        operatorId: OPERATOR,
      }),
      findAll: jest.fn().mockResolvedValue([
        {
          id: COMMUNITY,
          name: 'Afrobeat Creators',
          description: null,
          governanceConfig: { approvalMode: 'CREATOR_AND_THRESHOLD' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
          operator: { id: OPERATOR, email: 'operator@example.com' },
        },
      ]),
      findById: jest.fn().mockResolvedValue({
        id: COMMUNITY,
        name: 'Afrobeat Creators',
        description: 'A community',
        governanceConfig: { approvalMode: 'CREATOR_AND_THRESHOLD' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        operator: { id: OPERATOR, email: 'operator@example.com' },
        memberships: [{ id: 'mem-1', userId: MEMBER }],
      }),
      findByIdOrNull: jest
        .fn()
        .mockResolvedValue({ id: COMMUNITY, operatorId: OPERATOR }),
    };

    membershipsService = {
      // Carries a `user` relation, because that is what the real service
      // returns and what used to be handed straight to the caller.
      findByCommunity: jest.fn().mockResolvedValue([
        {
          id: 'mem-1',
          userId: MEMBER,
          role: 'MEMBER',
          status: 'ACTIVE',
          joinedAt: new Date('2026-01-01T00:00:00Z'),
          user: {
            id: MEMBER,
            email: 'afrobeat@demo.braice.local',
            walletAddress: '7xYz',
            userType: 'MEMBER',
          },
        },
      ]),
      getMemberCount: jest.fn().mockResolvedValue(100),
      assertCommunityExists: jest
        .fn()
        .mockResolvedValue({ id: COMMUNITY, operatorId: OPERATOR }),
      canViewRoster: jest.fn().mockResolvedValue(true),
      isActiveMember: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommunitiesController],
      providers: [
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

  describe('POST /api/communities', () => {
    beforeEach(async () => {
      await buildApp(OPERATOR);
    });

    it('creates a community operated by the caller', () => {
      return request(app.getHttpServer())
        .post('/api/communities')
        .send({
          name: 'Afrobeat Creators',
          governanceConfig: {
            approvalMode: 'CREATOR_AND_THRESHOLD',
            thresholdPercentage: 60,
          },
        })
        .expect(201)
        .then(() => {
          expect(communitiesService.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Afrobeat Creators' }),
            OPERATOR,
          );
        });
    });

    it('rejects a body-supplied operatorId', () => {
      // The operator used to be read from the body, so anyone could create a
      // community with someone else's id and then act as its operator.
      return request(app.getHttpServer())
        .post('/api/communities')
        .send({
          name: 'Impostor',
          operatorId: STRANGER,
          governanceConfig: { approvalMode: 'CREATOR_AND_THRESHOLD' },
        })
        .expect(400)
        .then(() => {
          expect(communitiesService.create).not.toHaveBeenCalled();
        });
    });

    it('rejects missing required fields', () => {
      return request(app.getHttpServer())
        .post('/api/communities')
        .send({ name: 'Test' })
        .expect(400);
    });

    /**
     * The nested config used to be checked only for being an object.
     *
     * `@IsObject` alone stops at the outer level, so `approvalMode` and
     * `thresholdPercentage` were stored exactly as sent. The mode is the
     * dangerous one: `applyRules` falls through to CREATOR_AND_THRESHOLD for any
     * unrecognised value, so a community that asked for CREATOR_ONLY and typed it
     * slightly wrong would have run the strictest mode instead and seen no
     * difference. Each case below sends only the one field that is wrong, so a
     * rejection cannot be credited to a sibling field.
     */
    it('rejects an unrecognised approvalMode', () => {
      return request(app.getHttpServer())
        .post('/api/communities')
        .send({
          name: 'Typo',
          governanceConfig: {
            approvalMode: 'CREATOR_ONLY_TYPO',
            thresholdPercentage: 60,
          },
        })
        .expect(400)
        .then(() => {
          expect(communitiesService.create).not.toHaveBeenCalled();
        });
    });

    it('rejects a threshold outside 1..100', () => {
      return request(app.getHttpServer())
        .post('/api/communities')
        .send({
          name: 'Everyone',
          governanceConfig: {
            approvalMode: 'THRESHOLD_ONLY',
            thresholdPercentage: 0,
          },
        })
        .expect(400)
        .then(() => {
          expect(communitiesService.create).not.toHaveBeenCalled();
        });
    });

    it('rejects a non-integer threshold', () => {
      return request(app.getHttpServer())
        .post('/api/communities')
        .send({
          name: 'Sixtyish',
          governanceConfig: {
            approvalMode: 'THRESHOLD_ONLY',
            thresholdPercentage: '60',
          },
        })
        .expect(400)
        .then(() => {
          expect(communitiesService.create).not.toHaveBeenCalled();
        });
    });

    it('rejects a governanceConfig missing its threshold', () => {
      return request(app.getHttpServer())
        .post('/api/communities')
        .send({
          name: 'Half-specified',
          governanceConfig: { approvalMode: 'THRESHOLD_ONLY' },
        })
        .expect(400)
        .then(() => {
          expect(communitiesService.create).not.toHaveBeenCalled();
        });
    });

    it('refuses an unauthenticated create', async () => {
      await buildApp(null);

      return request(app.getHttpServer())
        .post('/api/communities')
        .send({
          name: 'Anon',
          governanceConfig: { approvalMode: 'CREATOR_AND_THRESHOLD' },
        })
        .expect(403);
    });
  });

  describe('GET /api/communities', () => {
    beforeEach(async () => {
      await buildApp(MEMBER);
    });

    it('returns the list', () => {
      return request(app.getHttpServer())
        .get('/api/communities')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(1);
        });
    });

    it('omits the operator account', () => {
      return request(app.getHttpServer())
        .get('/api/communities')
        .expect(200)
        .expect((res: any) => {
          expect(res.body[0].operator).toBeUndefined();
          expect(res.body[0].memberships).toBeUndefined();
        });
    });

    it('passes a name search through to the service', () => {
      return request(app.getHttpServer())
        .get('/api/communities?search=afro')
        .expect(200)
        .then(() => {
          expect(communitiesService.findAll).toHaveBeenCalledWith('afro');
        });
    });

    it('lists everything when no search is given', () => {
      return request(app.getHttpServer())
        .get('/api/communities')
        .expect(200)
        .then(() => {
          expect(communitiesService.findAll).toHaveBeenCalledWith(undefined);
        });
    });

    it('rejects an unexpected query parameter', () => {
      // `forbidNonWhitelisted` is on globally, so any parameter outside the
      // query DTO is a 400 rather than being silently ignored.
      return request(app.getHttpServer())
        .get('/api/communities?limit=5')
        .expect(400);
    });
  });

  describe('GET /api/communities/:id', () => {
    beforeEach(async () => {
      await buildApp(MEMBER);
    });

    it('returns the community', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.name).toBe('Afrobeat Creators');
        });
    });

    it('omits memberships and the operator account', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.memberships).toBeUndefined();
          expect(res.body.operator).toBeUndefined();
        });
    });
  });

  describe('GET /api/communities/:id/members', () => {
    beforeEach(async () => {
      await buildApp(MEMBER);
    });

    it('returns the roster to a member', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/members`)
        .expect(200);
    });

    it('omits the joined user record', () => {
      // The service loads the `user` relation, so the raw rows carry every
      // member's email, wallet address and account type. The twin route under
      // Memberships already projected these columns; this one did not, which is
      // how a roster read became a directory read.
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/members`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body[0].user).toBeUndefined();
          expect(JSON.stringify(res.body)).not.toContain('afrobeat@demo');
        });
    });

    it('keeps the fields a roster actually needs', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/members`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body[0]).toEqual({
            id: 'mem-1',
            userId: MEMBER,
            role: 'MEMBER',
            status: 'ACTIVE',
            joinedAt: '2026-01-01T00:00:00.000Z',
          });
        });
    });

    it('refuses a stranger', async () => {
      await buildApp(STRANGER);
      membershipsService.canViewRoster.mockResolvedValue(false);

      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/members`)
        .expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await buildApp(null);

      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/members`)
        .expect(403);
    });
  });

  describe('GET /api/communities/:id/member-count', () => {
    beforeEach(async () => {
      await buildApp(MEMBER);
    });

    it('returns the count', () => {
      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/member-count`)
        .expect(200)
        .expect((res: any) => {
          expect(Number(res.text)).toBe(100);
        });
    });

    it('returns the count to a stranger, since a count names nobody', async () => {
      await buildApp(STRANGER);

      return request(app.getHttpServer())
        .get(`/api/communities/${COMMUNITY}/member-count`)
        .expect(200);
    });
  });
});
