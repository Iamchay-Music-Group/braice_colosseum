import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import {
  AggregationLevel,
  DenialReason,
  Operation,
  PermissionEngine,
  PermissionStatus,
  AuthorizationDecision,
  ProtectedResource,
} from '@braice/permission-engine';
import { Permission } from './entities/permission.entity';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';
import { Community } from '../communities/entities/community.entity';
import { User } from '../users/entities/user.entity';
import { HashService } from '../blockchain/hash.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/entities/audit-event.entity';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(CommunityDataset)
    private readonly datasetRepo: Repository<CommunityDataset>,
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly engine: PermissionEngine,
    private readonly hashService: HashService,
    private readonly blockchainService: BlockchainService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The authorization choke point.
   *
   * Loads the applicable permission and hands the decision to the pure engine.
   * The principal is the caller's authenticated identity — it is never taken
   * from request input.
   */
  async checkAccess(input: {
    principalId: string;
    resourceId: string;
    purpose: string;
    operation: Operation;
    now?: Date;
    /**
     * Granularity the caller wants to read at, when finer than the resource
     * naturally provides. See AccessEvaluationInput — naming INDIVIDUAL is a
     * request the engine can refuse, not a way to obtain member data.
     */
    requestedAggregationLevel?: AggregationLevel;
  }): Promise<AuthorizationDecision> {
    const resource = await this.resolveResource(input.resourceId);
    const permission = await this.findApplicablePermission(
      input.principalId,
      input.resourceId,
    );

    return this.engine.checkAccess(
      {
        principalId: input.principalId,
        resource,
        purpose: input.purpose,
        operation: input.operation as unknown as Operation,
        now: input.now ?? new Date(),
        requestedAggregationLevel: input.requestedAggregationLevel,
      },
      permission,
    );
  }

  /**
   * Resolve a dataset into a protected resource.
   *
   * A CommunityDataset is by construction community-level aggregate data, so
   * its aggregation level is fixed to COMMUNITY. This is what makes member
   * data unreachable: individual activity is a separate table that this
   * lookup never consults.
   */
  private async resolveResource(
    resourceId: string,
  ): Promise<ProtectedResource> {
    const dataset = await this.datasetRepo.findOne({
      where: { id: resourceId },
    });

    if (!dataset) {
      throw new NotFoundException(`Resource ${resourceId} not found`);
    }

    return {
      id: dataset.id,
      communityId: dataset.communityId,
      datasetType: dataset.datasetType,
      aggregationLevel: AggregationLevel.COMMUNITY,
    };
  }

  /**
   * Find the permission that could authorise this access.
   *
   * Status and expiry are filtered in SQL rather than in memory so a revoked
   * or expired permission is not returned as a candidate at all. The engine
   * still re-checks both, so the ordering guarantees hold even if a caller
   * supplies a permission by another path.
   */
  private async findApplicablePermission(
    principalId: string,
    resourceId: string,
  ): Promise<Permission | null> {
    return this.permissionRepo.findOne({
      where: [
        {
          principalId,
          resourceId,
          status: PermissionStatus.ACTIVE,
          expiresAt: MoreThan(new Date()),
        },
        // Also consider non-active rows so the engine can report *why*
        // access was denied rather than a bare NO_PERMISSION.
        { principalId, resourceId },
      ],
      order: { issuedAt: 'DESC' },
    });
  }

  /**
   * Issue a permission from an approved governance decision.
   *
   * Conditions are built by the engine, never by the caller, so
   * allowIndividualData cannot be set to true by any code path.
   */
  async createFromDecision(params: {
    accessRequestId: string;
    principalId: string;
    resourceId: string;
    purpose: string;
    operation: Operation;
    durationSeconds: number;
  }): Promise<Permission> {
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + params.durationSeconds * 1000,
    );

    const permission = this.permissionRepo.create({
      accessRequestId: params.accessRequestId,
      principalId: params.principalId,
      resourceId: params.resourceId,
      purpose: params.purpose,
      operation: params.operation,
      conditions: this.engine.buildDefaultConditions(),
      issuedAt,
      expiresAt,
      revokedAt: null,
      status: PermissionStatus.ACTIVE,
      policyHash: null,
      blockchainReference: null,
    });

    permission.policyHash = this.hashService.createPolicyHash(permission);

    const saved = await this.permissionRepo.save(permission);

    // On-chain anchoring is best-effort. The permission is already
    // enforceable; a missing chain write degrades verifiability, not access.
    const signature = await this.anchorPermission(saved);
    if (signature) {
      saved.blockchainReference = signature;
      await this.permissionRepo.save(saved);
    }

    return saved;
  }

  /**
   * Anchor a saved permission, tolerating every failure.
   *
   * The permission is already committed to Postgres by the time this runs, so
   * this must never throw: failing here would turn a successful grant into a
   * 500 and leave the caller thinking nothing was created. Anything that
   * prevents anchoring — an unresolvable community, an unreachable RPC —
   * costs verifiability and nothing else.
   */
  private async anchorPermission(permission: Permission): Promise<string | null> {
    try {
      const dataset = await this.datasetRepo.findOne({
        where: { id: permission.resourceId },
      });
      if (!dataset) {
        this.logger.warn(
          `Not anchoring permission ${permission.id}: resource ` +
            `${permission.resourceId} does not resolve to a dataset`,
        );
        return null;
      }

      // Accounts are identified by email + password, not by a wallet. A user
      // who has not linked one (POST /api/auth/wallet/link) has no on-chain
      // grantee pubkey to record, so the grant stays fully enforceable
      // off-chain and simply is not anchored. This is an ordinary outcome, not
      // a failure — hence debug rather than warn.
      const user = await this.userRepo.findOne({
        where: { id: permission.principalId },
      });
      if (!user?.walletAddress) {
        this.logger.debug(
          `Permission ${permission.id} is not anchored on-chain: principal ` +
            `${permission.principalId} has no linked wallet`,
        );
        return null;
      }

      return await this.blockchainService.recordPermissionCreated({
        communityId: dataset.communityId,
        permissionId: permission.id,
        granteeWallet: user.walletAddress,
        purpose: permission.purpose,
        resourceId: permission.resourceId,
        policyHash: permission.policyHash as string,
        expiresAt: permission.expiresAt,
      });
    } catch (err) {
      this.logger.warn(
        `On-chain anchoring skipped for permission ${permission.id}: ` +
          `${(err as Error).message}`,
      );
      return null;
    }
  }

  async findById(id: string): Promise<Permission> {
    const permission = await this.permissionRepo.findOne({ where: { id } });
    if (!permission) {
      throw new NotFoundException(`Permission ${id} not found`);
    }
    return permission;
  }

  /**
   * Revoke a permission.
   *
   * Only a community operator may revoke, and the check is server-side: the
   * caller asserts their identity via a verified JWT, and we compare it to
   * the community that owns the resource.
   */
  async revoke(
    id: string,
    revokerId: string,
  ): Promise<Permission> {
    const permission = await this.findById(id);

    if (permission.status === PermissionStatus.REVOKED) {
      throw new ForbiddenException('Permission is already revoked');
    }

    const dataset = await this.datasetRepo.findOne({
      where: { id: permission.resourceId },
    });

    if (!dataset) {
      throw new NotFoundException(
        `Resource ${permission.resourceId} not found for permission ${id}`,
      );
    }

    const community = await this.communityRepo.findOne({
      where: { id: dataset.communityId },
    });

    if (!community || community.operatorId !== revokerId) {
      throw new ForbiddenException(
        'Only the community operator may revoke this permission',
      );
    }

    permission.status = PermissionStatus.REVOKED;
    permission.revokedAt = new Date();
    const saved = await this.permissionRepo.save(permission);

    // The operator check above is the real authorization gate; anchoring just
    // records the outcome. A missing policy hash means the permission was never
    // hashed, so there is nothing to anchor against and we skip rather than
    // send a placeholder.
    if (saved.policyHash) {
      await this.blockchainService.recordPermissionRevoked({
        communityId: dataset.communityId,
        permissionId: saved.id,
        policyHash: saved.policyHash,
      });
    } else {
      this.logger.warn(
        `Not anchoring revocation of permission ${saved.id}: no policy hash on record`,
      );
    }

    this.logger.log(
      `Permission ${id} revoked by ${revokerId} (community ${dataset.communityId})`,
    );

    // Revocation is the outcome an auditor most needs to see, and it was not
    // previously recorded. `revokedBy` is stored because "who withdrew this and
    // when" is the question the event exists to answer, and a bare timestamp
    // cannot answer it after the operator account changes hands.
    await this.auditService.record({
      communityId: dataset.communityId,
      actorId: revokerId,
      eventType: AuditEventType.PERMISSION_REVOKED,
      resourceId: saved.resourceId,
      permissionId: saved.id,
      metadata: {
        purpose: saved.purpose,
        operation: saved.operation,
        revokedBy: revokerId,
        expiresAt: saved.expiresAt,
        anchoredOnChain: Boolean(saved.blockchainReference),
      },
    });

    return saved;
  }

  /**
   * Mark lapsed permissions as EXPIRED.
   *
   * Status is cosmetic once expiresAt has passed — the engine denies on the
   * timestamp regardless — but keeping the column accurate makes reporting
   * and the audit trail honest.
   */
  async expireLapsed(): Promise<number> {
    const result = await this.permissionRepo
      .createQueryBuilder()
      .update(Permission)
      .set({ status: PermissionStatus.EXPIRED })
      .where('status = :active', { active: PermissionStatus.ACTIVE })
      .andWhere('expires_at <= NOW()')
      .execute();

    if (result.affected && result.affected > 0) {
      this.logger.log(`Marked ${result.affected} permission(s) EXPIRED`);
    }
    return result.affected ?? 0;
  }

  async findAll(): Promise<Permission[]> {
    return this.permissionRepo.find({ order: { issuedAt: 'DESC' } });
  }

}

export { DenialReason };
