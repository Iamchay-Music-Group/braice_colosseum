import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DecisionOutcome } from '@braice/blockchain-client';
import { AccessRequest, AccessRequestStatus } from '../access-requests/entities/access-request.entity';
import { Community } from '../communities/entities/community.entity';
import { Membership } from '../memberships/entities/membership.entity';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PermissionsService } from '../permissions/permissions.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { CreateUserType } from '../users/dto/create-user.dto';
import { AuditEventType } from '../audit/entities/audit-event.entity';
import {
  ApprovalMode,
  DecisionType,
  GovernanceDecision,
} from './entities/governance-decision.entity';
import { GovernanceService } from './governance.service';

/**
 * The operator gate is the security boundary of this module, and it lives
 * entirely inside the service. The controller spec mocks the service wholesale,
 * so it can only ever assert "the service was called" — deleting the operator
 * check below would leave that suite green. These tests exercise the real
 * methods against mocked repositories so the refusals themselves are asserted.
 */

const REQUEST = '11111111-1111-4111-8111-111111111111';
const COMMUNITY = '22222222-2222-4222-8222-222222222222';
const OPERATOR = '33333333-3333-4333-8333-333333333333';
const REQUESTER = '44444444-4444-4444-8444-444444444444';
const AGENT = '55555555-5555-4555-8555-555555555555';
const MEMBER_A = '66666666-6666-4666-8666-666666666666';
const MEMBER_B = '77777777-7777-4777-8777-777777777777';
const OUTSIDER = '88888888-8888-4888-8888-888888888888';
const FABRICATED = '99999999-9999-4999-8999-999999999999';

type Repo = {
  findOne: jest.Mock;
  save: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  createQueryBuilder: jest.Mock;
};

describe('GovernanceService', () => {
  let service: GovernanceService;
  let requestRepo: Repo;
  let decisionRepo: Repo;
  let communityRepo: Repo;
  let membershipRepo: Repo;
  let blockchainService: { recordGovernanceDecision: jest.Mock };
  let permissionsService: { createFromDecision: jest.Mock };
  let auditService: { record: jest.Mock };
  let usersService: { findById: jest.Mock; setUserType: jest.Mock };
  let queryBuilder: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
  };

  const makeRequest = (over: Partial<AccessRequest> = {}): AccessRequest =>
    ({
      id: REQUEST,
      communityId: COMMUNITY,
      requesterId: REQUESTER,
      datasetId: 'dataset-1',
      purpose: 'AGGREGATE_ANALYSIS',
      operation: 'READ',
      status: AccessRequestStatus.PENDING,
      requestedDurationSeconds: 3600,
      ...over,
    }) as AccessRequest;

  const makeCommunity = (over: Partial<Community> = {}): Community =>
    ({
      id: COMMUNITY,
      operatorId: OPERATOR,
      governanceConfig: {},
      ...over,
    }) as Community;

  /** Default happy path: operator-owned community, one active member. */
  const seedHappyPath = (over: { totalMembers?: number } = {}) => {
    requestRepo.findOne.mockResolvedValue(makeRequest());
    communityRepo.findOne.mockResolvedValue(makeCommunity());
    queryBuilder.getCount.mockResolvedValue(over.totalMembers ?? 1);
    membershipRepo.find.mockResolvedValue([
      { userId: OPERATOR },
      { userId: MEMBER_A },
      { userId: MEMBER_B },
    ]);
    // TypeORM's create is a plain factory, so the pass-through keeps every
    // field the service built. Without it save receives undefined and the
    // returned decision loses approvedBy/decidedAt.
    decisionRepo.create.mockImplementation((d) => d);
  };

  beforeEach(async () => {
    requestRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    decisionRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    communityRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    membershipRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
    };
    membershipRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    blockchainService = { recordGovernanceDecision: jest.fn().mockResolvedValue('tx-1') };
    permissionsService = {
      createFromDecision: jest
        .fn()
        .mockResolvedValue({ id: 'perm-1', policyHash: 'hash-1', blockchainReference: 'tx-perm' }),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    usersService = {
      findById: jest.fn().mockResolvedValue({ id: REQUESTER, userType: 'MEMBER' }),
      setUserType: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GovernanceService,
        { provide: getRepositoryToken(AccessRequest), useValue: requestRepo },
        { provide: getRepositoryToken(GovernanceDecision), useValue: decisionRepo },
        { provide: getRepositoryToken(Community), useValue: communityRepo },
        { provide: getRepositoryToken(Membership), useValue: membershipRepo },
        { provide: BlockchainService, useValue: blockchainService },
        { provide: PermissionsService, useValue: permissionsService },
        { provide: AuditService, useValue: auditService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = moduleRef.get(GovernanceService);
  });

  describe('operator gate on authority-creating routes', () => {
    it('refuses a governance decision from anyone but the community operator', async () => {
      seedHappyPath();

      await expect(
        service.evaluate(REQUEST, [OPERATOR], OUTSIDER),
      ).rejects.toThrow(ForbiddenException);

      expect(decisionRepo.save).not.toHaveBeenCalled();
      expect(blockchainService.recordGovernanceDecision).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('refuses permission issuance from anyone but the community operator', async () => {
      seedHappyPath();

      await expect(
        service.createPermissionFromDecision(REQUEST, AGENT, OUTSIDER),
      ).rejects.toThrow(ForbiddenException);

      expect(permissionsService.createFromDecision).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('resolves the community from the request row, trusting nothing else', async () => {
      seedHappyPath();
      requestRepo.findOne.mockResolvedValue(
        makeRequest({ status: AccessRequestStatus.APPROVED }),
      );
      // The attacker operates a community of their own, but this request
      // belongs to a community they do not operate.
      communityRepo.findOne.mockResolvedValue(
        makeCommunity({ operatorId: OPERATOR }),
      );

      await expect(
        service.createPermissionFromDecision(REQUEST, AGENT, OUTSIDER),
      ).rejects.toThrow(ForbiddenException);
      expect(permissionsService.createFromDecision).not.toHaveBeenCalled();

      // The gate must follow request.communityId, not any caller input.
      expect(communityRepo.findOne).toHaveBeenCalledWith({
        where: { id: COMMUNITY },
      });
    });

    it('reports a missing request as 404 rather than 403', async () => {
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.evaluate(REQUEST, [OPERATOR], OPERATOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(communityRepo.findOne).not.toHaveBeenCalled();
    });

    it('reports a missing community as 404', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest());
      communityRepo.findOne.mockResolvedValue(null);

      await expect(service.evaluate(REQUEST, [OPERATOR], OPERATOR)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('approver resolution', () => {
    it('rejects fabricated ids that are not active members', async () => {
      seedHappyPath();

      await expect(
        service.evaluate(REQUEST, [OPERATOR, FABRICATED], OPERATOR),
      ).rejects.toThrow(BadRequestException);

      expect(decisionRepo.save).not.toHaveBeenCalled();
      expect(blockchainService.recordGovernanceDecision).not.toHaveBeenCalled();
    });

    it('rejects a list of entirely fabricated ids', async () => {
      seedHappyPath();

      await expect(
        service.evaluate(REQUEST, [FABRICATED], OPERATOR),
      ).rejects.toThrow(BadRequestException);
      expect(decisionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an empty approver list', async () => {
      seedHappyPath();

      await expect(service.evaluate(REQUEST, [], OPERATOR)).rejects.toThrow(
        BadRequestException,
      );
      expect(decisionRepo.save).not.toHaveBeenCalled();
    });

    it('accepts the operator even when they hold no active membership row', async () => {
      seedHappyPath({ totalMembers: 2 });
      membershipRepo.find.mockResolvedValue([{ userId: MEMBER_A }]);

      decisionRepo.create.mockImplementation((d) => d);
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));

      await service.evaluate(REQUEST, [OPERATOR, MEMBER_A], OPERATOR);

      expect(decisionRepo.save).toHaveBeenCalled();
    });

    it('deduplicates a member who votes twice', async () => {
      seedHappyPath({ totalMembers: 2 });
      decisionRepo.create.mockImplementation((d) => d);
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));

      const saved = await service.evaluate(
        REQUEST,
        [OPERATOR, MEMBER_A, MEMBER_A],
        OPERATOR,
      );

      expect(saved.approvedBy).toEqual([OPERATOR, MEMBER_A]);
      expect(saved.approvalCount).toBe(2);
    });
  });

  describe('threshold arithmetic', () => {
    it('rounds up, never down', () => {
      expect(service.computeThreshold(5, 60)).toBe(3);
      expect(service.computeThreshold(4, 60)).toBe(3);
      expect(service.computeThreshold(1, 60)).toBe(1);
      expect(service.computeThreshold(10, 50)).toBe(5);
    });

    it('derives the threshold from live membership, ignoring what the client claims', async () => {
      seedHappyPath({ totalMembers: 5 });
      membershipRepo.find.mockResolvedValue([{ userId: OPERATOR }]);
      decisionRepo.create.mockImplementation((d) => d);
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));

      // ceil(5 * 0.6) = 3; a single approval must not clear it.
      await service.evaluate(REQUEST, [OPERATOR], OPERATOR);

      const [created] = decisionRepo.create.mock.calls[0];
      expect(created.threshold).toBe(3);
      expect(created.approvalCount).toBe(1);
    });
  });

  describe('approval modes', () => {
    const runWith = async (
      approvalMode: ApprovalMode,
      approvedBy: string[],
      totalMembers: number,
    ) => {
      // seedHappyPath first: it re-mocks communityRepo, so the governance
      // config has to be applied after it or it is overwritten.
      seedHappyPath({ totalMembers });
      communityRepo.findOne.mockResolvedValue(
        makeCommunity({
          governanceConfig: { approvalMode, thresholdPercentage: 60 },
        }),
      );
      queryBuilder.getCount.mockResolvedValue(totalMembers);
      decisionRepo.create.mockImplementation((d) => d);
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));
      return service.evaluate(REQUEST, approvedBy, OPERATOR);
    };

    it('CREATOR_AND_THRESHOLD rejects a bare creator below the threshold', async () => {
      const decision = await runWith(
        ApprovalMode.CREATOR_AND_THRESHOLD,
        [OPERATOR],
        5,
      );
      expect(decision.decision).toBe(DecisionType.REJECTED);
    });

    it('CREATOR_AND_THRESHOLD approves once the creator and threshold are both in', async () => {
      const decision = await runWith(
        ApprovalMode.CREATOR_AND_THRESHOLD,
        [OPERATOR, MEMBER_A, MEMBER_B],
        5,
      );
      expect(decision.decision).toBe(DecisionType.APPROVED);
      expect(decision.threshold).toBe(3);
    });

    it('THRESHOLD_ONLY approves without the creator', async () => {
      // ceil(3 * 0.6) = 2; two distinct members and no operator.
      const decision = await runWith(
        ApprovalMode.THRESHOLD_ONLY,
        [MEMBER_A, MEMBER_B, MEMBER_A],
        3,
      );
      expect(decision.decision).toBe(DecisionType.APPROVED);
      expect(decision.approvedBy).toEqual([MEMBER_A, MEMBER_B]);
      expect(decision.approvedBy).not.toContain(OPERATOR);
    });

    it('CREATOR_ONLY approves the creator alone', async () => {
      const decision = await runWith(ApprovalMode.CREATOR_ONLY, [OPERATOR], 5);
      expect(decision.decision).toBe(DecisionType.APPROVED);
    });

    it('CREATOR_ONLY rejects a member-only approval', async () => {
      const decision = await runWith(ApprovalMode.CREATOR_ONLY, [MEMBER_A], 5);
      expect(decision.decision).toBe(DecisionType.REJECTED);
    });
  });

  describe('on-chain anchoring', () => {
    beforeEach(() => {
      decisionRepo.create.mockImplementation((d) => d);
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));
    });

    it('commits the tally and threshold, sorted, never the ids in the clear', async () => {
      seedHappyPath({ totalMembers: 3 });

      await service.evaluate(REQUEST, [MEMBER_B, OPERATOR, MEMBER_A], OPERATOR);

      const [payload] = blockchainService.recordGovernanceDecision.mock.calls[0];
      expect(payload.outcome).toBe(DecisionOutcome.Approved);
      expect(payload.decisionPayload.approvedBy).toEqual(
        [OPERATOR, MEMBER_A, MEMBER_B].sort(),
      );
      expect(payload.decisionPayload.approvalCount).toBe(3);
      expect(payload.decisionPayload.threshold).toBe(2);
      expect(typeof payload.decisionPayload).toBe('object');
    });

    it('persists a still-null tx without failing when the chain is unavailable', async () => {
      seedHappyPath();
      blockchainService.recordGovernanceDecision.mockResolvedValue(null);

      const decision = await service.evaluate(REQUEST, [OPERATOR], OPERATOR);

      expect(decision.blockchainTx).toBeNull();
    });

    it('rejects the on-chain outcome when the decision is a rejection', async () => {
      seedHappyPath({ totalMembers: 5 });

      await service.evaluate(REQUEST, [OPERATOR], OPERATOR);

      const [payload] = blockchainService.recordGovernanceDecision.mock.calls[0];
      expect(payload.outcome).toBe(DecisionOutcome.Rejected);
    });
  });

  describe('request status and audit', () => {
    beforeEach(() => {
      decisionRepo.create.mockImplementation((d) => d);
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));
    });

    it('marks the request APPROVED and audits the approval', async () => {
      seedHappyPath({ totalMembers: 2 });

      await service.evaluate(REQUEST, [OPERATOR, MEMBER_A], OPERATOR);

      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: REQUEST, status: AccessRequestStatus.APPROVED }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: OPERATOR,
          eventType: AuditEventType.GOVERNANCE_APPROVED,
          metadata: expect.objectContaining({ approvalCount: 2, threshold: 2 }),
        }),
      );
    });

    it('marks the request REJECTED and audits the rejection', async () => {
      seedHappyPath({ totalMembers: 5 });

      await service.evaluate(REQUEST, [OPERATOR], OPERATOR);

      expect(requestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AccessRequestStatus.REJECTED }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: AuditEventType.GOVERNANCE_REJECTED }),
      );
    });
  });

  describe('permission issuance', () => {
    it('grants to the grantee while auditing the operator as the actor', async () => {
      seedHappyPath();
      requestRepo.findOne.mockResolvedValue(
        makeRequest({ status: AccessRequestStatus.APPROVED }),
      );

      await service.createPermissionFromDecision(REQUEST, AGENT, OPERATOR);

      expect(permissionsService.createFromDecision).toHaveBeenCalledWith(
        expect.objectContaining({ principalId: AGENT, resourceId: 'dataset-1' }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: OPERATOR,
          eventType: AuditEventType.PERMISSION_CREATED,
          metadata: expect.objectContaining({ granteeId: AGENT }),
        }),
      );
    });

    it('grants nothing to the requesting brand merely because it was approved', async () => {
      seedHappyPath({ totalMembers: 2 });
      decisionRepo.create.mockImplementation((d) => d);
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));

      await service.evaluate(REQUEST, [OPERATOR, MEMBER_A], OPERATOR);

      expect(decisionRepo.save).toHaveBeenCalled();
      expect(permissionsService.createFromDecision).not.toHaveBeenCalled();
    });

    it('refuses to issue from a request that was never approved', async () => {
      seedHappyPath();
      requestRepo.findOne.mockResolvedValue(
        makeRequest({ status: AccessRequestStatus.REJECTED }),
      );

      await expect(
        service.createPermissionFromDecision(REQUEST, AGENT, OPERATOR),
      ).rejects.toThrow(BadRequestException);
      expect(permissionsService.createFromDecision).not.toHaveBeenCalled();
    });
  });

  describe('decision history', () => {
    it('lets the community operator read the trail', async () => {
      seedHappyPath();
      decisionRepo.find.mockResolvedValue([]);

      await expect(service.findByRequest(REQUEST, OPERATOR)).resolves.toEqual([]);
    });

    it('lets the requester read the outcome of their own request', async () => {
      // Regression: the operator gate used to run first, making the requester
      // arm unreachable and denying a brand the result of its own request.
      seedHappyPath();
      decisionRepo.find.mockResolvedValue([]);

      await expect(service.findByRequest(REQUEST, REQUESTER)).resolves.toEqual([]);
    });

    it('refuses an unrelated member', async () => {
      seedHappyPath();

      await expect(service.findByRequest(REQUEST, MEMBER_A)).rejects.toThrow(
        ForbiddenException,
      );
      expect(decisionRepo.find).not.toHaveBeenCalled();
    });

    it('refuses an operator of a different community', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest());
      communityRepo.findOne.mockResolvedValue(makeCommunity({ operatorId: OPERATOR }));

      await expect(service.findByRequest(REQUEST, OUTSIDER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(decisionRepo.find).not.toHaveBeenCalled();
    });
  });
  describe('governance-driven account roles', () => {
    it('promotes an approved MEMBER requester to BRAND', async () => {
      seedHappyPath();
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));

      await service.evaluate(REQUEST, [OPERATOR], OPERATOR);

      expect(usersService.setUserType).toHaveBeenCalledWith(
        REQUESTER,
        CreateUserType.BRAND,
      );
    });

    it('records the promotion in the audit trail', async () => {
      seedHappyPath();
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));

      await service.evaluate(REQUEST, [OPERATOR], OPERATOR);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.ROLE_ASSIGNED,
          metadata: expect.objectContaining({
            scope: 'account',
            userId: REQUESTER,
            from: CreateUserType.MEMBER,
            to: CreateUserType.BRAND,
          }),
        }),
      );
    });

    // A creator filing a request against their own community is the operator
    // approving their own access, not a member asking to become a brand. The
    // promotion is MEMBER -> BRAND precisely so it cannot overwrite that.
    it('never downgrades a requester that already holds a role', async () => {
      seedHappyPath();
      usersService.findById.mockResolvedValue({
        id: REQUESTER,
        userType: CreateUserType.CREATOR,
      });
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));

      await service.evaluate(REQUEST, [OPERATOR], OPERATOR);

      expect(usersService.setUserType).not.toHaveBeenCalled();
    });

    it('leaves the account alone when the request is rejected', async () => {
      requestRepo.findOne.mockResolvedValue(makeRequest());
      communityRepo.findOne.mockResolvedValue(makeCommunity());
      queryBuilder.getCount.mockResolvedValue(10);
      membershipRepo.find.mockResolvedValue([
        { userId: OPERATOR },
        { userId: MEMBER_A },
        { userId: MEMBER_B },
      ]);
      decisionRepo.create.mockImplementation((d) => d);
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));

      const decision = await service.evaluate(REQUEST, [MEMBER_A], OPERATOR);

      expect(decision.decision).toBe(DecisionType.REJECTED);
      expect(usersService.setUserType).not.toHaveBeenCalled();
    });

    // The decision is already saved, anchored and in the trail by this point. A
    // profile update failing must not surface as a 500 on an approved request,
    // because the natural client response is a retry and a retry records a
    // second decision.
    it('keeps the approval when the promotion itself fails', async () => {
      seedHappyPath();
      usersService.setUserType.mockRejectedValue(new Error('database is down'));
      decisionRepo.save.mockImplementation(async (d) => ({ id: 'dec-1', ...d }));

      const decision = await service.evaluate(REQUEST, [OPERATOR], OPERATOR);

      expect(decision.decision).toBe(DecisionType.APPROVED);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.ROLE_ASSIGNED,
          metadata: expect.objectContaining({ applied: false }),
        }),
      );
    });
  });
});
