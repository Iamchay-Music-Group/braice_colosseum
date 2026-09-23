import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { MembershipsService } from './memberships.service';

@Controller('communities/:communityId/members')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  join(@Param('communityId') communityId: string, @Body('userId') userId: string) {
    return this.membershipsService.join(communityId, userId);
  }

  @Delete(':userId')
  leave(
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
  ) {
    return this.membershipsService.leave(communityId, userId);
  }

  @Get()
  findMembers(@Param('communityId') communityId: string) {
    return this.membershipsService.findByCommunity(communityId);
  }
}
