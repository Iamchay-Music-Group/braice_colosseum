import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { CreateActivityDto } from './dto/create-activity.dto';

@ApiTags('Activity')
@Controller('communities/:communityId/activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Post()
  @ApiOperation({
    summary: 'Record activity (INTERNAL ONLY)',
    description: 'Ingest individual activity records. This endpoint is for internal use only — brands and AI must NOT access individual activity data.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiResponse({ status: 201, description: 'Activity recorded' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  record(
    @Param('communityId') communityId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activityService.record(communityId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List community activity', description: 'Get all activity records for a community' })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiResponse({ status: 200, description: 'List of activity records' })
  findByCommunity(@Param('communityId') communityId: string) {
    return this.activityService.findByCommunity(communityId);
  }

  @Get('count')
  @ApiOperation({ summary: 'Get activity count', description: 'Count total activity records for a community' })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiResponse({ status: 200, description: 'Activity count' })
  getCount(@Param('communityId') communityId: string) {
    return this.activityService.getActivityCount(communityId);
  }

  @Get('member/:memberId')
  @ApiOperation({ summary: 'Get member activity', description: 'Get all activity records for a specific member in a community' })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiParam({ name: 'memberId', description: 'Member (User) UUID' })
  @ApiResponse({ status: 200, description: 'List of activity records' })
  findByMember(
    @Param('communityId') communityId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.activityService.findByMember(memberId, communityId);
  }
}
