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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CommunitiesService } from './communities.service';
import { MembershipsService } from '../memberships/memberships.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import {
  CurrentPrincipal,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Community CRUD.
 *
 * Creating a community used to read its operator straight from the request
 * body, so anyone could create a community with someone else's id as operator
 * and then act as its operator. The operator is now taken from the verified
 * token.
 */
@ApiTags('Communities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('communities')
export class CommunitiesController {
  constructor(
    private readonly communitiesService: CommunitiesService,
    private readonly membershipsService: MembershipsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a community',
    description:
      'The operator is the authenticated caller. A body-supplied operatorId ' +
      'is rejected by the global validation pipe.',
  })
  @ApiCreatedResponse({ description: 'Community created' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  create(
    @Body() dto: CreateCommunityDto,
    @CurrentPrincipal() principal: JwtPayload,
  ) {
    return this.communitiesService.create(dto, principal.sub);
  }

  @Get()
  @ApiOperation({
    summary: 'List all communities',
    description:
      'Public directory: name, description and governance configuration ' +
      'only. Memberships and operator identity are not included.',
  })
  @ApiOkResponse({ description: 'List of communities' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async findAll() {
    const communities = await this.communitiesService.findAll();

    // findAll loads the `operator` relation. The operator's email is not part
    // of the community's public identity, so the listing is projected down
    // rather than shipped whole.
    return communities.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      governanceConfig: c.governanceConfig,
      createdAt: c.createdAt,
    }));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get community details',
    description:
      'Returns the community with its governance configuration. Memberships ' +
      'and the operator account are not included; use the roster route for ' +
      'members.',
  })
  @ApiParam({ name: 'id', description: 'Community UUID' })
  @ApiOkResponse({ description: 'Community found' })
  @ApiNotFoundResponse({ description: 'Community not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async findById(@Param('id') id: string) {
    const community = await this.communitiesService.findById(id);

    return {
      id: community.id,
      name: community.name,
      description: community.description,
      governanceConfig: community.governanceConfig,
      createdAt: community.createdAt,
    };
  }

  /**
   * GET /api/communities/:id/members
   *
   * Scoped to the operator and current members. This was an open route returning
   * full membership rows for any community id.
   */
  @Get(':id/members')
  @ApiOperation({
    summary: 'List community members',
    description: 'Operator or member only.',
  })
  @ApiParam({ name: 'id', description: 'Community UUID' })
  @ApiOkResponse({ description: 'List of memberships' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is not a member or the operator',
  })
  async findMembers(
    @Param('id') id: string,
    @CurrentPrincipal() principal: JwtPayload,
  ) {
    await this.assertRosterVisible(id, principal.sub);

    const memberships = await this.membershipsService.findByCommunity(id);

    // Projected, not returned raw. The service loads the `user` relation, so
    // returning its rows directly handed every member the whole directory —
    // email, wallet address and account type for everyone in the community —
    // through the one route that had no projection while its twin,
    // GET /api/communities/:id/members, had one. Two routes over the same
    // table with different exposure is how the leak survived review.
    //
    // A roster needs to say who is in the community. It does not need to say
    // how to reach them, and nothing in the governance model depends on that.
    return memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
    }));
  }

  /**
   * GET /api/communities/:id/member-count
   *
   * Readable by anyone who can see the community. A count is not a roster: it
   * says how many, never who, so it cannot be walked one member at a time.
   */
  @Get(':id/member-count')
  @ApiOperation({
    summary: 'Get community member count',
    description: 'Number of active members. Does not identify anyone.',
  })
  @ApiParam({ name: 'id', description: 'Community UUID' })
  @ApiOkResponse({ description: 'Member count' })
  @ApiNotFoundResponse({ description: 'Community not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async getMemberCount(@Param('id') id: string) {
    await this.membershipsService.assertCommunityExists(id);

    return this.membershipsService.getMemberCount(id);
  }

  private async assertRosterVisible(
    communityId: string,
    principalId: string,
  ): Promise<void> {
    const community = await this.communitiesService.findByIdOrNull(communityId);

    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    const canView = await this.membershipsService.canViewRoster(
      communityId,
      principalId,
    );

    if (!canView) {
      throw new ForbiddenException(
        'Only a member or the operator may list community members',
      );
    }
  }
}
