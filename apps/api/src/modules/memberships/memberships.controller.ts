import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { MembershipsService } from './memberships.service';

@ApiTags('Memberships')
@Controller('communities/:communityId/members')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @ApiOperation({ summary: 'Join a community', description: 'Create a membership for a user in a community' })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiBody({ schema: { properties: { userId: { type: 'string', format: 'uuid', description: 'User UUID' } }, required: ['userId'] } })
  @ApiResponse({ status: 201, description: 'Membership created' })
  @ApiResponse({ status: 409, description: 'User is already a member' })
  join(@Param('communityId') communityId: string, @Body('userId') userId: string) {
    return this.membershipsService.join(communityId, userId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Leave a community', description: 'Remove a user\'s membership from a community' })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Membership removed' })
  @ApiResponse({ status: 404, description: 'Membership not found' })
  leave(
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
  ) {
    return this.membershipsService.leave(communityId, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List community members' })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiResponse({ status: 200, description: 'List of memberships' })
  findMembers(@Param('communityId') communityId: string) {
    return this.membershipsService.findByCommunity(communityId);
  }
}
