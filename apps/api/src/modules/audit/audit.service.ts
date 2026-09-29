import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { AuditEvent, AuditEventType } from './entities/audit-event.entity';
import { Community } from '../communities/entities/community.entity';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';
import { Permission } from '../permissions/entities/permission.entity';

/** Hard ceiling on a single audit read, independent of the requested limit. */
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export interface RecordAuditInput {
  communityId: string | null;
  actorId: string | null;
  eventType: AuditEventType | string;
  resourceId?: string | null;
  permissionId?: string | null;
  metadata?: Record<string, unknown> | null;
  blockchainTx?: string | null;
}

export interface AuditReadOptions {
  limit?: number;
  eventTypes?: AuditEventType[];
}

/**
 * The audit trail: append-only writes, scoped reads.
 *
 * Read scoping lives here rather than in the controller because it is a policy
 * decision, and a policy decision in a controller is one route away from being
 * forgotten on the next route. Reads resolve their own ownership via
 * community.operatorId, which is the same comparison PermissionsService.revoke
 * uses — so the audit surface and the revocation gate cannot drift apart.
 *
 * This does mean AuditModule loads the Community and CommunityDataset
 * repositories. That is deliberate: PermissionsModule already imports
 * AuditModule to write revocation events, so importing PermissionsModule back
 * would form a cycle. Two read-only repository handles are a better trade than
 * a circular module dependency.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEvent)
    private readonly auditRepo: Repository<AuditEvent>,
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(CommunityDataset)
    private readonly datasetRepo: Repository<CommunityDataset>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
  ) {}

  /**
   * Append an audit event.
   *
   * Never throws. An audit write failure must not deny access that policy
   * allows; the decision is already made by this point, and failing the
   * request would let a logging outage become an availability incident.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          communityId: input.communityId,
          actorId: input.actorId,
          eventType: input.eventType,
          resourceId: input.resourceId ?? null,
          permissionId: input.permissionId ?? null,
          metadata: input.metadata ?? null,
          blockchainTx: input.blockchainTx ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to record audit event ${input.eventType}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * A community's whole trail. Operator only.
   *
   * Includes denied attempts. A run of ACCESS_DENIED is how an abuse attempt
   * becomes visible, so filtering them out would remove the signal the trail
   * exists to provide.
   */
  async findByCommunity(
    communityId: string,
    limit = DEFAULT_LIMIT,
  ): Promise<AuditEvent[]> {
    return this.auditRepo.find({
      where: { communityId },
      order: { createdAt: 'DESC' },
      take: this.clamp(limit),
    });
  }

  /**
   * Events for one permission, optionally filtered by type.
   *
   * The filter exists because the permission lifecycle and its usage are
   * different questions. "How did this grant come about" wants only
   * PERMISSION_CREATED/REVOKED; "show me every time it was used" wants
   * ACCESS_* and AI_*. Returning everything would ship unrelated activity to
   * anyone asking the narrower question.
   */
  async findByPermission(
    permissionId: string,
    options: AuditReadOptions = {},
  ): Promise<AuditEvent[]> {
    const { limit = DEFAULT_LIMIT, eventTypes } = options;

    const where: FindOptionsWhere<AuditEvent> = { permissionId };

    if (eventTypes?.length) {
      where.eventType = In(eventTypes);
    }

    return this.auditRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: this.clamp(limit),
    });
  }

  /**
   * A permission row, or null.
   *
   * The audit routes need the permission to decide who may read its trail.
   * Reading it here rather than from PermissionsService is what keeps
   * AuditModule free of a back-reference to PermissionsModule — that module
   * already imports this one to record revocation events, so importing it
   * back would be a module cycle that fails at DI time, not compile time.
   */
  async findPermission(permissionId: string): Promise<Permission | null> {
    return this.permissionRepo.findOne({ where: { id: permissionId } });
  }

  /** Every event type known to the schema, for client-side filter options. */
  eventTypes(): AuditEventType[] {
    return Object.values(AuditEventType);
  }

  /**
   * Whether a caller operates the community that owns a resource.
   *
   * Resolves resource -> dataset -> community, the same path a permission's
   * scope is established by, so this check and the engine cannot disagree about
   * which community a resource belongs to.
   *
   * Returns false for an unresolvable resource instead of throwing. This is a
   * predicate separating "may read" from "may not"; a resource that does not
   * exist authorises nobody, and a 404 here would tell an unauthorised caller
   * more than the boolean does.
   */
  async isOperatorForResource(
    resourceId: string,
    principalId: string,
  ): Promise<boolean> {
    const dataset = await this.datasetRepo.findOne({ where: { id: resourceId } });

    if (!dataset) return false;

    const community = await this.communityRepo.findOne({
      where: { id: dataset.communityId },
    });

    return community?.operatorId === principalId;
  }

  /** Throws unless the caller operates this community. */
  async assertCommunityOperator(principalId: string, communityId: string): Promise<void> {
    const community = await this.communityRepo.findOne({
      where: { id: communityId },
    });

    // A non-operator gets the same refusal whether the community exists or
    // not. Distinguishing them would let anyone probe which ids are real.
    if (!community || community.operatorId !== principalId) {
      throw new ForbiddenException(
        'Only the community operator may read this audit trail',
      );
    }
  }

  private clamp(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(limit), MAX_LIMIT);
  }
}
