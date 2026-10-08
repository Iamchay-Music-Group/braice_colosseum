import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AccessRequest,
  AccessRequestStatus,
} from '../access-requests/entities/access-request.entity';
import {
  ApprovalMode,
  DecisionType,
  GovernanceDecision,
  GovernanceConfig,
} from './entities/governance-decision.entity';
import { Community } from '../communities/entities/community.entity';
import { DecisionOutcome } from '@braice/blockchain-client';
import { Membership } from '../memberships/entities/membership.entity';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PermissionsService } from '../permissions/permissions.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/entities/audit-event.entity';
import { UsersService } from '../users/users.service';
import { CreateUserType } from '../users/dto/create-user.dto';

export interface GovernanceEvaluation {
  decision: DecisionType;
  reason: string;
  approvalCount: number;
  threshold: number;
  creatorApproved: boolean;
}

const DEFAULT_GOVERNANCE: GovernanceConfig = {
  approvalMode: ApprovalMode.CREATOR_AND_THRESHOLD,
  thresholdPercentage: 60,
};

/**
 * Evaluates community governance and turns a decision into an enforceable
 * permission.
 *
 * The threshold is derived from live membership, never from a count supplied
 * by the caller, so a client cannot lower the bar by under-reporting members.
 */
@Injectable()
export class GovernanceService {
  private readonly logger = new Logger(GovernanceService.name);

  constructor(
    @InjectRepository(AccessRequest)
    private readonly requestRepo: Repository<AccessRequest>,
    @InjectRepository(GovernanceDecision)
    private readonly decisionRepo: Repository<GovernanceDecision>,
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(Membership)
    private readonly membershipRepo: Repository<Membership>,
    private readonly blockchainService: BlockchainService,
    private readonly permissionsService: PermissionsService,
    private readonly auditService: AuditService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Load a request and its community, refusing anyone who does not operate it.
   *
   * Both authority-creating entry points start here. They used to take only a
   * request id and an operator-only body, with `principal.sub` used for nothing
   * but the audit actor — so any authenticated account could record an approval
   * against a community it had no claim on and then mint an enforceable,
   * on-chain-anchored permission from it. The gate belongs on the resolved
   * request rather than on a client-supplied communityId, because the request
   * is what names the community.
   */
  private async loadRequestWithCommunity(
    requestId: string,
  ): Promise<{ request: AccessRequest; community: Community }> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException(`Access request ${requestId} not found`);
    }

    const community = await this.communityRepo.findOne({
      where: { id: request.communityId },
    });
    if (!community) {
      throw new NotFoundException(
        `Community ${request.communityId} not found`,
      );
    }

    return { request, community };
  }

  private async assertOperatorForRequest(
    requestId: string,
    principalId: string,
  ): Promise<{ request: AccessRequest; community: Community }> {
    const { request, community } = await this.loadRequestWithCommunity(requestId);

    if (community.operatorId !== principalId) {
      throw new ForbiddenException(
        'Only the community operator may record a governance decision or issue a permission from it',
      );
    }

    return { request, community };
  }

  /**
   * Reduce a client-supplied approver list to the ids that are genuinely active
   * members of this community.
   *
   * The tally is the whole point of the route, so it cannot be assembled from
   * whatever arrived in the body. A list of fabricated uuids would otherwise
   * clear any threshold instantly, and the ids are written into the decision and
   * hashed onto the chain — so a decision anchored to members who do not exist
   * is a permanent, publicly checkable falsehood rather than a wrong number.
   *
   * The operator's own id is accepted even though they are not on the roster:
   * `CREATOR_AND_THRESHOLD` cannot pass without it, and `operatorId` is the
   * authority for who they are.
   */
  private async resolveApprovers(
    approvedBy: string[],
    community: Community,
  ): Promise<string[]> {
    const claimed = [...new Set(approvedBy)];

    if (claimed.length === 0) {
      throw new BadRequestException('approvedBy must contain at least one user id');
    }

    const memberships = await this.membershipRepo.find({
      where: {
        communityId: community.id,
        userId: In(claimed),
        status: 'ACTIVE',
      },
      select: ['userId'],
    });

    const activeMembers = new Set(memberships.map((m) => m.userId));
    activeMembers.add(community.operatorId);

    const valid = claimed.filter((id) => activeMembers.has(id));
    const rejected = claimed.filter((id) => !activeMembers.has(id));

    if (rejected.length > 0) {
      throw new BadRequestException(
        `${rejected.length} of the supplied approvers are not active members of this community`,
      );
    }

    return valid;
  }

  /**
   * Ceiling division: the number of approvals needed to clear a percentage.
   *
   * ceil, not round or floor — a 60% threshold of 5 members is 3 approvals,
   * and rounding down would let a minority through.
   */
  computeThreshold(totalMembers: number, percentage: number): number {
    return Math.ceil((totalMembers * percentage) / 100);
  }

  async evaluate(
    requestId: string,
    approvedBy: string[],
    principalId: string,
  ): Promise<GovernanceDecision> {
    const { request, community } = await this.assertOperatorForRequest(
      requestId,
      principalId,
    );

    const config: GovernanceConfig = {
      ...DEFAULT_GOVERNANCE,
      ...(community.governanceConfig as Partial<GovernanceConfig>),
    };

    const totalMembers = await this.membershipRepo
      .createQueryBuilder('m')
      .where('m.community_id = :communityId', { communityId: community.id })
      .andWhere("m.status = 'ACTIVE'")
      .getCount();

    // Dedupe, then keep only ids that are genuinely active members here. Both
    // halves matter: the first stops one member voting twice, the second stops
    // a list of ids that were never members from being counted at all.
    const uniqueApprovers = await this.resolveApprovers(approvedBy, community);

    const creatorApproved = uniqueApprovers.includes(community.operatorId);
    const threshold = this.computeThreshold(
      totalMembers,
      config.thresholdPercentage,
    );
    const approvalCount = uniqueApprovers.length;

    const evaluation = this.applyRules(
      config.approvalMode,
      creatorApproved,
      approvalCount,
      threshold,
    );

    const decision = this.decisionRepo.create({
      accessRequestId: requestId,
      decision: evaluation.decision,
      approvedBy: uniqueApprovers,
      approvalCount,
      threshold,
      decidedAt: new Date(),
      blockchainTx: null,
    });

    const saved = await this.decisionRepo.save(decision);

    const tx = await this.blockchainService.recordGovernanceDecision({
      communityId: request.communityId,
      decisionId: saved.id,
      outcome:
        evaluation.decision === DecisionType.APPROVED
          ? DecisionOutcome.Approved
          : DecisionOutcome.Rejected,
      // The payload is hashed, never sent in the clear. It covers what the
      // community actually decided on — the tally, the threshold it was
      // measured against, and the distinct approvers — so the anchor commits to
      // the substance of the decision and not merely to its id.
      decisionPayload: {
        accessRequestId: saved.accessRequestId,
        decision: saved.decision,
        approvedBy: [...saved.approvedBy].sort(),
        approvalCount: saved.approvalCount,
        threshold: saved.threshold,
        decidedAt: saved.decidedAt.toISOString(),
      },
    });
    if (tx) {
      saved.blockchainTx = tx;
      await this.decisionRepo.save(saved);
    }

    request.status =
      evaluation.decision === DecisionType.APPROVED
        ? AccessRequestStatus.APPROVED
        : AccessRequestStatus.REJECTED;
    await this.requestRepo.save(request);

    await this.auditService.record({
      communityId: request.communityId,
      actorId: principalId,
      eventType:
        evaluation.decision === DecisionType.APPROVED
          ? AuditEventType.GOVERNANCE_APPROVED
          : AuditEventType.GOVERNANCE_REJECTED,
      resourceId: request.datasetId,
      metadata: {
        requestId,
        reason: evaluation.reason,
        approvalCount,
        threshold,
        totalMembers,
      },
      blockchainTx: tx,
    });

    this.logger.log(
      `Governance ${evaluation.decision} for request ${requestId}: ` +
        `${approvalCount}/${totalMembers} approvals, threshold ${threshold} (${evaluation.reason})`,
    );

    // An approval is also the moment the system learns what kind of account the
    // requester is: a community that granted access to a member's request has
    // recognised them as a data consumer. Deliberately after the anchor and the
    // decision write — the decision is the part that must not be undone.
    if (evaluation.decision === DecisionType.APPROVED) {
      await this.promoteRequesterToPartner(request, principalId);
    }

    return saved;
  }

  /**
   * Promote an approved requester from MEMBER to PARTNER.
   *
   * Account roles are not self-declared — `POST /auth/register` always creates a
   * MEMBER — so without this the enum had nothing that could ever write
   * CREATOR/PARTNER/APPLICATION and `UsersService.setUserType` had no callers at
   * all. Governance is the thing that knows, so it is the thing that decides.
   *
   * Only ever MEMBER to PARTNER, and never a downgrade: a CREATOR who files an
   * access request against their own community stays a CREATOR, and an
   * APPLICATION stays one. A partner asking a second question is still a partner.
   *
   * Fail-soft by design. The decision is already saved, anchored, and in the
   * audit trail; a profile update failing must not turn an approved request into
   * a 500 and invite a retry that records a second decision. The failure is
   * logged and written to the trail instead.
   */
  private async promoteRequesterToPartner(
    request: AccessRequest,
    actorId: string,
  ): Promise<void> {
    try {
      const requester = await this.usersService.findById(request.requesterId);

      if (requester.userType !== CreateUserType.MEMBER) {
        return;
      }

      await this.usersService.setUserType(
        requester.id,
        CreateUserType.PARTNER,
      );

      await this.auditService.record({
        communityId: request.communityId,
        actorId,
        eventType: AuditEventType.ROLE_ASSIGNED,
        resourceId: request.datasetId,
        metadata: {
          scope: 'account',
          userId: requester.id,
          from: CreateUserType.MEMBER,
          to: CreateUserType.PARTNER,
          reason: 'Access request approved by community governance',
          requestId: request.id,
        },
      });

      this.logger.log(
        `Promoted ${requester.id} to PARTNER: governance approved request ${request.id}`,
      );
    } catch (err) {
      this.logger.error(
        `Approved request ${request.id} but could not promote ` +
          `${request.requesterId} to PARTNER: ${(err as Error).message}`,
      );

      await this.auditService.record({
        communityId: request.communityId,
        actorId,
        eventType: AuditEventType.ROLE_ASSIGNED,
        resourceId: request.datasetId,
        metadata: {
          scope: 'account',
          userId: request.requesterId,
          to: CreateUserType.PARTNER,
          applied: false,
          reason: 'Promotion failed after approval; the decision stands',
          requestId: request.id,
        },
      });
    }
  }

  /**
   * Apply the community's configured approval rules.
   *
   * Every mode requires the threshold to be met except CREATOR_ONLY, where
   * the creator's approval is the whole decision. THRESHOLD_ONLY deliberately
   * does not require creator approval.
   */
  private applyRules(
    mode: ApprovalMode,
    creatorApproved: boolean,
    approvalCount: number,
    threshold: number,
  ): GovernanceEvaluation {
    const base = { approvalCount, threshold, creatorApproved };

    switch (mode) {
      case ApprovalMode.CREATOR_ONLY:
        return creatorApproved
          ? { ...base, decision: DecisionType.APPROVED, reason: 'CREATOR_APPROVED' }
          : { ...base, decision: DecisionType.REJECTED, reason: 'CREATOR_APPROVAL_REQUIRED' };

      case ApprovalMode.THRESHOLD_ONLY:
        return approvalCount >= threshold
          ? { ...base, decision: DecisionType.APPROVED, reason: 'THRESHOLD_MET' }
          : { ...base, decision: DecisionType.REJECTED, reason: 'THRESHOLD_NOT_MET' };

      case ApprovalMode.CREATOR_AND_THRESHOLD:
      default:
        return creatorApproved && approvalCount >= threshold
          ? { ...base, decision: DecisionType.APPROVED, reason: 'CREATOR_AND_THRESHOLD_MET' }
          : { ...base, decision: DecisionType.REJECTED, reason: 'THRESHOLD_NOT_MET' };
    }
  }

  /**
   * Issue the permission that a governance approval authorises.
   *
   * The principal is the AI agent that will exercise the permission, which is
   * distinct from the partner that requested access. That separation is the
   * point: a partner's request does not hand the partner itself any data access.
   *
   * `actorId` is the operator recording the issue, which is not the same as the
   * grantee. They were previously the same value, so every PERMISSION_CREATED
   * event in the trail named the beneficiary as the actor who granted it — a
   * grant reading as self-issued.
   */
  async createPermissionFromDecision(
    requestId: string,
    granteeId: string,
    actorId: string,
  ): Promise<{ id: string; policyHash: string | null }> {
    const { request } = await this.assertOperatorForRequest(requestId, actorId);

    if (request.status !== AccessRequestStatus.APPROVED) {
      throw new BadRequestException(
        `Access request ${requestId} is ${request.status}; only APPROVED requests can produce a permission`,
      );
    }

    const permission = await this.permissionsService.createFromDecision({
      accessRequestId: requestId,
      principalId: granteeId,
      resourceId: request.datasetId,
      purpose: request.purpose,
      operation: request.operation as never,
      durationSeconds: request.requestedDurationSeconds,
    });

    await this.auditService.record({
      communityId: request.communityId,
      actorId,
      eventType: AuditEventType.PERMISSION_CREATED,
      resourceId: request.datasetId,
      permissionId: permission.id,
      metadata: {
        requestId,
        policyHash: permission.policyHash,
        granteeId,
      },
      blockchainTx: permission.blockchainReference,
    });

    return permission;
  }

  /**
   * Decision history for a request.
   *
   * Operator or requester, matching who may read the request itself. The
   * decision names every member who approved, so it is not world-readable: it
   * used to be, and any authenticated account could enumerate the voting record
   * of any request it could name.
   */
  async findByRequest(
    requestId: string,
    principalId: string,
  ): Promise<GovernanceDecision[]> {
    // Deliberately not assertOperatorForRequest: reading the trail is not an
    // authority-creating action, and a requester is normally not the operator.
    // Gating on the operator first made the `requesterId` arm below dead code
    // and denied the requester the outcome of their own request.
    const { request, community } = await this.loadRequestWithCommunity(requestId);

    if (request.requesterId !== principalId && community.operatorId !== principalId) {
      throw new ForbiddenException(
        'Only the requester or the community operator may read this decision history',
      );
    }

    return this.decisionRepo.find({
      where: { accessRequestId: requestId },
      order: { decidedAt: 'DESC' },
    });
  }
}
