import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import {
  CurrentPrincipal,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import { MembershipsService } from '../memberships/memberships.service';
import { CommunitiesService } from '../communities/communities.service';

/**
 * Individual activity ingestion and counts.
 *
 * This is the most sensitive table in the system: one row is one member doing
 * one thing. The design rule is that individual records are written here and
 * never read back out over HTTP.
 *
 * There is deliberately NO route that returns an ActivityRecord. Not for the
 * community operator, not for an admin, not behind a flag. The community's
 * operator legitimately needs to know their aggregate is being computed from
 * the right data, and that is served by the count route, which returns an
 * integer and cannot leak who did what.
 *
 * The previous findByCommunity and findByMember routes returned raw records to
 * unauthenticated callers. They are gone rather than guarded, because a
 * permission that can be granted to grant this table access is a permission
 * nobody should be able to write.
 */
@ApiTags('Activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('communities/:communityId/activity')
export class ActivityController {
  constructor(
    private readonly activityService: ActivityService,
    private readonly communitiesService: CommunitiesService,
    private readonly membershipsService: MembershipsService,
  ) {}

  /**
   * POST /api/communities/:communityId/activity
   *
   * Ingestion. Restricted to the community operator, not merely to any
   * authenticated user: whoever writes these rows controls what the community's
   * published intelligence will summarise, so an open ingest endpoint lets one
   * member author the community's profile.
   */
  @Post()
  @ApiOperation({
    summary: 'Record activity (operator only)',
    description:
      'Ingest individual activity records. Operator-only: whoever writes ' +
      'these rows determines what the community aggregate will summarise.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiOkResponse({ description: 'Activity recorded' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is not the operator of this community',
  })
  async record(
    @Param('communityId') communityId: string,
    @Body() dto: CreateActivityDto,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<{ id: string }> {
    await this.assertOperator(communityId, principal.sub);

    // A member id in the body is a claim that this activity happened to this
    // person. Verified against the membership table so an operator cannot
    // attribute activity to a non-member, which would silently corrupt the
    // aggregate with records for people who were never in the community.
    const membership = await this.membershipsService.findActiveMembership(
      dto.memberId,
      communityId,
    );

    if (!membership) {
      throw new NotFoundException(
        'No active membership for that member in this community',
      );
    }

    const record = await this.activityService.record(communityId, dto);

    // Only the id is returned. The stored row carries the member id, the
    // timestamp and any client metadata, and none of that needs to travel back
    // to the caller that just supplied it.
    return { id: record.id };
  }

  /**
   * GET /api/communities/:communityId/activity/count
   *
   * An integer, available to the operator, so the dashboard can show that
   * aggregation has data to work from without exposing any row.
   */
  @Get('count')
  @ApiOperation({
    summary: 'Get activity count',
    description:
      'Total individual activity records held for a community. Returns a ' +
      'count only; no individual record is exposed by this route or any other.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiOkResponse({ description: 'Activity count' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller does not operate this community',
  })
  async getCount(
    @Param('communityId') communityId: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<{ count: number }> {
    const community = await this.communitiesService.findByIdOrNull(communityId);

    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    const isOperator = community.operatorId === principal.sub;
    const isMember = await this.membershipsService.isActiveMember(
      principal.sub,
      communityId,
    );

    // A member may know the community has activity; they may not see it. That
    // is the whole aggregate/individual split, and it is why this route can be
    // broadly readable while no row is.
    if (!isOperator && !isMember) {
      throw new ForbiddenException(
        'Only a member or the operator may read the activity count',
      );
    }

    const count = await this.activityService.getActivityCount(communityId);

    return { count };
  }

  private async assertOperator(
    communityId: string,
    principalId: string,
  ): Promise<void> {
    const community = await this.communitiesService.findByIdOrNull(communityId);

    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    if (community.operatorId !== principalId) {
      throw new ForbiddenException(
        'Only the community operator may ingest activity records',
      );
    }
  }
}
