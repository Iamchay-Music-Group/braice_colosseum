import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Community } from './entities/community.entity';
import { CreateCommunityDto } from './dto/create-community.dto';

@Injectable()
export class CommunitiesService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
  ) {}

  async create(dto: CreateCommunityDto, operatorId: string): Promise<Community> {
    const community = this.communityRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      operatorId,
      governanceConfig: dto.governanceConfig,
    });

    return this.communityRepo.save(community);
  }

  async findById(id: string): Promise<Community> {
    const community = await this.communityRepo.findOne({
      where: { id },
      relations: ['operator', 'memberships'],
    });
    if (!community) {
      throw new NotFoundException(`Community ${id} not found`);
    }
    return community;
  }

  async findByOperator(operatorId: string): Promise<Community[]> {
    return this.communityRepo.find({
      where: { operatorId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(): Promise<Community[]> {
    return this.communityRepo.find({
      relations: ['operator'],
      order: { createdAt: 'DESC' },
    });
  }
}
