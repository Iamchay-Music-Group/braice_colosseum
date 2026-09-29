import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AccessRequest,
  AccessRequestStatus,
} from './entities/access-request.entity';

@Injectable()
export class AccessRequestsService {
  constructor(
    @InjectRepository(AccessRequest)
    private readonly requestRepo: Repository<AccessRequest>,
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
    return this.requestRepo.save(
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
