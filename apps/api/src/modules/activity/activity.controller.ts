import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { CreateActivityDto } from './dto/create-activity.dto';

@Controller('communities/:communityId/activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Post()
  record(
    @Param('communityId') communityId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activityService.record(communityId, dto);
  }

  @Get()
  findByCommunity(@Param('communityId') communityId: string) {
    return this.activityService.findByCommunity(communityId);
  }

  @Get('count')
  getCount(@Param('communityId') communityId: string) {
    return this.activityService.getActivityCount(communityId);
  }

  @Get('member/:memberId')
  findByMember(
    @Param('communityId') communityId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.activityService.findByMember(memberId, communityId);
  }
}
