import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityRecord } from './entities/activity-record.entity';
import { CreateActivityDto } from './dto/create-activity.dto';

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityRecord)
    private readonly activityRepo: Repository<ActivityRecord>,
  ) {}

  async record(
    communityId: string,
    dto: CreateActivityDto,
  ): Promise<ActivityRecord> {
    const record = this.activityRepo.create({
      communityId,
      memberId: dto.memberId,
      activityType: dto.activityType,
      interestCategory: dto.interestCategory,
      metadata: dto.metadata ?? null,
      occurredAt: new Date(dto.occurredAt),
    });

    return this.activityRepo.save(record);
  }

  async findByCommunity(communityId: string): Promise<ActivityRecord[]> {
    return this.activityRepo.find({
      where: { communityId },
      order: { occurredAt: 'DESC' },
    });
  }

  async findByMember(
    memberId: string,
    communityId: string,
  ): Promise<ActivityRecord[]> {
    return this.activityRepo.find({
      where: { memberId, communityId },
      order: { occurredAt: 'DESC' },
    });
  }

  async getActivityCount(communityId: string): Promise<number> {
    return this.activityRepo.count({ where: { communityId } });
  }
}
