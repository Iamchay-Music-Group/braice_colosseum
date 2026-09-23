import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CommunitiesService } from './communities.service';
import { MembershipsService } from '../memberships/memberships.service';
import { CreateCommunityDto } from './dto/create-community.dto';

@ApiTags('Communities')
@Controller('communities')
export class CommunitiesController {
  constructor(
    private readonly communitiesService: CommunitiesService,
    private readonly membershipsService: MembershipsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a community', description: 'Create a new community with governance configuration' })
  @ApiResponse({ status: 201, description: 'Community created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  create(@Body() dto: CreateCommunityDto) {
    return this.communitiesService.create(dto, dto.operatorId);
  }

  @Get()
  @ApiOperation({ summary: 'List all communities' })
  @ApiResponse({ status: 200, description: 'List of communities' })
  findAll() {
    return this.communitiesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get community details', description: 'Returns community with operator and memberships' })
  @ApiParam({ name: 'id', description: 'Community UUID' })
  @ApiResponse({ status: 200, description: 'Community found' })
  @ApiResponse({ status: 404, description: 'Community not found' })
  findById(@Param('id') id: string) {
    return this.communitiesService.findById(id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List community members' })
  @ApiParam({ name: 'id', description: 'Community UUID' })
  @ApiResponse({ status: 200, description: 'List of memberships' })
  findMembers(@Param('id') id: string) {
    return this.membershipsService.findByCommunity(id);
  }

  @Get(':id/member-count')
  @ApiOperation({ summary: 'Get community member count', description: 'Returns count of active members' })
  @ApiParam({ name: 'id', description: 'Community UUID' })
  @ApiResponse({ status: 200, description: 'Member count' })
  getMemberCount(@Param('id') id: string) {
    return this.membershipsService.getMemberCount(id);
  }
}
