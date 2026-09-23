import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Membership } from './entities/membership.entity';

@Injectable()
export class MembershipsService {
  constructor(
    @InjectRepository(Membership)
    private readonly membershipRepo: Repository<Membership>,
  ) {}

  async join(communityId: string, userId: string): Promise<Membership> {
    const existing = await this.membershipRepo.findOne({
      where: { communityId, userId },
    });
    if (existing) {
      throw new ConflictException('User is already a member of this community');
    }

    const membership = this.membershipRepo.create({
      communityId,
      userId,
      role: 'MEMBER',
      status: 'ACTIVE',
    });

    return this.membershipRepo.save(membership);
  }

  async leave(communityId: string, userId: string): Promise<void> {
    const membership = await this.membershipRepo.findOne({
      where: { communityId, userId },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }
    await this.membershipRepo.remove(membership);
  }

  async findByCommunity(communityId: string): Promise<Membership[]> {
    return this.membershipRepo.find({
      where: { communityId },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  async findByUser(userId: string): Promise<Membership[]> {
    return this.membershipRepo.find({
      where: { userId },
      relations: ['community'],
      order: { joinedAt: 'DESC' },
    });
  }

  async getMemberCount(communityId: string): Promise<number> {
    return this.membershipRepo.count({
      where: { communityId, status: 'ACTIVE' },
    });
  }
}
