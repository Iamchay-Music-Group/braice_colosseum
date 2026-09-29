import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MembershipsService } from './memberships.service';
import {
  CurrentPrincipal,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Community membership.
 *
 * The caller identity on every route comes from the verified JWT. There is no
 * userId in any request body, because the previous versions of these two routes
 * accepted one: POST /members could add any account to any community, and
 * DELETE /members/:userId could remove anyone, both unauthenticated.
 *
 * Leaving is self-service. Removing someone else is the operator's call, and is
 * a separate, explicit route — collapsing the two would let any member evict a
 * competitor.
 */
@ApiTags('Memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('communities/:communityId/members')
export class MembershipsController {
  constructor(
    private readonly membershipsService: MembershipsService,
  ) {}

  /**
   * POST /api/communities/:communityId/members
   *
   * Self-service join. Joining a community is a low-risk act and the roster is
   * not a secret; the reason this is authenticated rather than open is that an
   * open join let anyone place an arbitrary account into any community.
   */
  @Post()
  @ApiOperation({
    summary: 'Join a community',
    description:
      'Adds the authenticated caller to the community. The user id is taken ' +
      'from the verified token, never from the request body.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiCreatedResponse({ description: 'Membership created' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiNotFoundResponse({ description: 'Community not found' })
  @ApiForbiddenResponse({ description: 'Already a member of this community' })
  async join(
    @Param('communityId') communityId: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<{ id: string; communityId: string; userId: string; role: string }> {
    await this.membershipsService.assertCommunityExists(communityId);

    const membership = await this.membershipsService.join(
      communityId,
      principal.sub,
    );

    return {
      id: membership.id,
      communityId: membership.communityId,
      userId: membership.userId,
      role: membership.role,
    };
  }

  /**
   * DELETE /api/communities/:communityId/members/me
   *
   * Self-service leave. The `:userId` route that accepted any id is gone.
   */
  @Delete('me')
  @ApiOperation({
    summary: 'Leave a community',
    description: 'Removes the authenticated caller from the community.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiOkResponse({ description: 'Membership removed' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiNotFoundResponse({ description: 'Caller is not a member' })
  async leave(
    @Param('communityId') communityId: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<{ removed: true }> {
    await this.membershipsService.assertCommunityExists(communityId);

    await this.membershipsService.leave(communityId, principal.sub);

    return { removed: true };
  }

  /**
   * DELETE /api/communities/:communityId/members/:userId
   *
   * Operator-only removal, for moderation. Distinct from leaving on purpose:
   * "I am removing you" and "I am leaving" are different acts with different
   * authority behind them, and sharing one route meant either could be done by
   * anyone.
   */
  @Delete(':userId')
  @ApiOperation({
    summary: 'Remove a member (operator only)',
    description:
      'Removes another member from the community. Restricted to the ' +
      'community operator.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiParam({ name: 'userId', description: 'Member UUID to remove' })
  @ApiOkResponse({ description: 'Membership removed' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiNotFoundResponse({ description: 'Membership not found' })
  @ApiForbiddenResponse({
    description: 'Caller is not the operator of this community',
  })
  async removeMember(
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<{ removed: true }> {
    const community = await this.membershipsService.assertCommunityOperator(
      communityId,
      principal.sub,
    );

    // Removing the operator is a lockout: the community would have nobody
    // able to approve access requests, mint permissions, or remove the next
    // member. Refused explicitly rather than allowed.
    if (userId === community.operatorId) {
      throw new ForbiddenException(
        'The community operator cannot be removed. Transfer operator ' +
          'ownership before leaving.',
      );
    }

    await this.membershipsService.leave(communityId, userId);

    return { removed: true };
  }

  /**
   * GET /api/communities/:communityId/members
   *
   * The roster is readable by any member. It exposes a userId and a join date
   * and nothing about behaviour — no activity, no interests — so it sits on
   * the safe side of the aggregate/individual boundary.
   */
  @Get()
  @ApiOperation({
    summary: 'List community members',
    description:
      'The membership roster: user id, role, and join date. No activity or ' +
      'interest data is exposed by this route.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiOkResponse({ description: 'List of memberships' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiNotFoundResponse({ description: 'Community not found' })
  @ApiForbiddenResponse({
    description: 'Caller is not a member of this community',
  })
  async findMembers(
    @Param('communityId') communityId: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<{ id: string; userId: string; role: string; joinedAt: Date }[]> {
    await this.membershipsService.assertCommunityExists(communityId);

    // An operator manages the roster and so needs to read it. Everyone else
    // needs to be a member: the roster is not public, because membership is
    // itself a signal about who belongs to a community.
    const canView = await this.membershipsService.canViewRoster(
      communityId,
      principal.sub,
    );

    if (!canView) {
      throw new ForbiddenException(
        'Only a member or the operator may list community members',
      );
    }

    const memberships = await this.membershipsService.findByCommunity(communityId);

    return memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
  }
}
