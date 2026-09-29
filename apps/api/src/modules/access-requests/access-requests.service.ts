import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AccessRequest,
  AccessRequestStatus,
} from './entities/access-request.entity';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/entities/audit-event.entity';

@Injectable()
export class AccessRequestsService {
  constructor(
    @InjectRepository(AccessRequest)
    private readonly requestRepo: Repository<AccessRequest>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * A request is a proposal, not an authorisation. Creating one grants
   * nothing; only an APPROVED governance decision can produce a permission.
   */
  async create(dto: {
    communityId: string;
    requesterId: string;
    datasetId: string;
    purpose: string;
    operation: string;
    requestedDurationSeconds: number;
  }): Promise<AccessRequest> {
    const request = await this.requestRepo.save(
      this.requestRepo.create({
        communityId: dto.communityId,
        requesterId: dto.requesterId,
        datasetId: dto.datasetId,
        purpose: dto.purpose,
        operation: dto.operation,
        requestedDurationSeconds: dto.requestedDurationSeconds,
        status: AccessRequestStatus.PENDING,
      }),
    );

    // The request itself was not audited, so the trail began at
    // GOVERNANCE_APPROVED with nothing showing who asked or for what. This is
    // the entry point of the whole story: a reader needs the ask, not just the
    // decision, or a grant has no visible motivation.
    //
    // Recorded after the save so the row exists before it is referenced, and
    // AuditService.record never throws, so a logging failure cannot discard a
    // request the user successfully made.
    await this.auditService.record({
      communityId: dto.communityId,
      actorId: dto.requesterId,
      eventType: AuditEventType.ACCESS_REQUESTED,
      resourceId: dto.datasetId,
      metadata: {
        requestId: request.id,
        purpose: dto.purpose,
        operation: dto.operation,
        requestedDurationSeconds: dto.requestedDurationSeconds,
      },
    });

    return request;
  }

  async findById(id: string): Promise<AccessRequest> {
    const request = await this.requestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Access request ${id} not found`);
    }
    return request;
  }

  async findByCommunity(communityId: string): Promise<AccessRequest[]> {
    return this.requestRepo.find({
      where: { communityId },
      order: { createdAt: 'DESC' },
    });
  }
}
