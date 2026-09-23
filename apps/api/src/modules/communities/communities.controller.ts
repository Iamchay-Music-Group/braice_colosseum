import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { MembershipsService } from '../memberships/memberships.service';
import { CreateCommunityDto } from './dto/create-community.dto';

@Controller('communities')
export class CommunitiesController {
  constructor(
    private readonly communitiesService: CommunitiesService,
    private readonly membershipsService: MembershipsService,
  ) {}

  @Post()
  create(@Body() dto: CreateCommunityDto) {
    return this.communitiesService.create(dto, dto.operatorId);
  }

  @Get()
  findAll() {
    return this.communitiesService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.communitiesService.findById(id);
  }

  @Get(':id/members')
  findMembers(@Param('id') id: string) {
    return this.membershipsService.findByCommunity(id);
  }

  @Get(':id/member-count')
  getMemberCount(@Param('id') id: string) {
    return this.membershipsService.getMemberCount(id);
  }
}
