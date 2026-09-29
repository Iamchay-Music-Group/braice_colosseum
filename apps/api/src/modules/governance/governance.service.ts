import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

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
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) {
      throw new Error(`Access request ${requestId} not found`);
    }

    const community = await this.communityRepo.findOne({
      where: { id: request.communityId },
    });
    if (!community) {
      throw new Error(`Community ${request.communityId} not found`);
    }

    const config: GovernanceConfig = {
      ...DEFAULT_GOVERNANCE,
      ...(community.governanceConfig as Partial<GovernanceConfig>),
    };

    const totalMembers = await this.membershipRepo
      .createQueryBuilder('m')
      .where('m.community_id = :communityId', { communityId: community.id })
      .andWhere("m.status = 'ACTIVE'")
      .getCount();

    // Dedupe approvers so one member cannot vote twice and reach a threshold
    // that the community never actually endorsed.
    const uniqueApprovers = [...new Set(approvedBy)];

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

    return saved;
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
   * distinct from the brand that requested access. That separation is the
   * point: a brand's request does not hand the brand itself any data access.
   */
  async createPermissionFromDecision(
    requestId: string,
    principalId: string,
  ): Promise<{ id: string; policyHash: string | null }> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) {
      throw new Error(`Access request ${requestId} not found`);
    }

    if (request.status !== AccessRequestStatus.APPROVED) {
      throw new Error(
        `Access request ${requestId} is ${request.status}; only APPROVED requests can produce a permission`,
      );
    }

    const permission = await this.permissionsService.createFromDecision({
      accessRequestId: requestId,
      principalId,
      resourceId: request.datasetId,
      purpose: request.purpose,
      operation: request.operation as never,
      durationSeconds: request.requestedDurationSeconds,
    });

    await this.auditService.record({
      communityId: request.communityId,
      actorId: principalId,
      eventType: AuditEventType.PERMISSION_CREATED,
      resourceId: request.datasetId,
      permissionId: permission.id,
      metadata: { requestId, policyHash: permission.policyHash },
      blockchainTx: permission.blockchainReference,
    });

    return permission;
  }

  async findByRequest(requestId: string): Promise<GovernanceDecision[]> {
    return this.decisionRepo.find({
      where: { accessRequestId: requestId },
      order: { decidedAt: 'DESC' },
    });
  }
}
