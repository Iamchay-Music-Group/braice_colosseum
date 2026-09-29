import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent, AuditEventType } from './entities/audit-event.entity';

export interface RecordAuditInput {
  communityId: string | null;
  actorId: string | null;
  eventType: AuditEventType | string;
  resourceId?: string | null;
  permissionId?: string | null;
  metadata?: Record<string, unknown> | null;
  blockchainTx?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEvent)
    private readonly auditRepo: Repository<AuditEvent>,
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

  async findByCommunity(
    communityId: string,
    limit = 100,
  ): Promise<AuditEvent[]> {
    return this.auditRepo.find({
      where: { communityId },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  async findByPermission(permissionId: string): Promise<AuditEvent[]> {
    return this.auditRepo.find({
      where: { permissionId },
      order: { createdAt: 'DESC' },
    });
  }
}
