import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AccessRequestsService } from './access-requests.service';
import { AccessRequest } from './entities/access-request.entity';
import {
  CurrentPrincipal,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import { MembershipsService } from '../memberships/memberships.service';

/**
 * Access requests.
 *
 * A request is a proposal, not a grant. It confers nothing on its own — only
 * an approved governance decision mints a permission — but it is the origin of
 * the entire chain, so who filed it matters.
 *
 * `requesterId` therefore comes from the verified token. It used to be a body
 * field, which let any caller file a request in someone else's name and have
 * the audit trail attribute the ask to a principal who never made it.
 */
@ApiTags('Access Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('access-requests')
export class AccessRequestsController {
  constructor(
    private readonly accessRequestsService: AccessRequestsService,
    private readonly membershipsService: MembershipsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Submit an access request',
    description:
      'A proposal only; confers no access until governance approves it and ' +
      'a permission is issued. The requester is the authenticated caller and ' +
      'cannot be set in the body.',
  })
  @ApiOkResponse({ description: 'Request created (status PENDING)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is not a member of the community',
  })
  create(
    @Body()
    body: {
      communityId: string;
      datasetId: string;
      purpose: string;
      operation: string;
      requestedDurationSeconds: number;
    },
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<AccessRequest> {
    return this.accessRequestsService.create({
      ...body,
      requesterId: principal.sub,
    });
  }

  /**
   * GET /api/access-requests/:id
   *
   * Visible to the requester and to the community operator. Anyone else is
   * refused: a request names a principal, a purpose and a duration, which is
   * the start of a permission grant.
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get an access request',
    description: 'Readable by the requester and the community operator.',
  })
  @ApiParam({ name: 'id', description: 'Access request UUID' })
  @ApiOkResponse({ description: 'Access request' })
  @ApiNotFoundResponse({ description: 'Request not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is neither the requester nor the community operator',
  })
  async findById(
    @Param('id') id: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<AccessRequest> {
    const request = await this.accessRequestsService.findById(id);

    const isRequester = request.requesterId === principal.sub;
    const isOperator = await this.membershipsService.isCommunityOperator(
      request.communityId,
      principal.sub,
    );

    if (!isRequester && !isOperator) {
      throw new ForbiddenException(
        'Only the requester or the community operator may read this request',
      );
    }

    return request;
  }

  /**
   * GET /api/access-requests?communityId=...
   *
   * Operator only. This route previously read a `communityId` path parameter
   * that the route did not declare, so it was always undefined and returned
   * nothing; it is now a query parameter the caller must actually supply.
   *
   * Operator-only rather than member-visible: the roster of who is asking for
   * what is not something a community publishes to its own members.
   */
  @Get()
  @ApiOperation({
    summary: 'List access requests for a community',
    description: 'Community operator only.',
  })
  @ApiQuery({ name: 'communityId', description: 'Community UUID' })
  @ApiOkResponse({ description: 'Access requests, newest first' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is not the operator of this community',
  })
  async findByCommunity(
    @Query('communityId') communityId: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<AccessRequest[]> {
    if (!communityId) {
      throw new BadRequestException('communityId query parameter is required');
    }

    await this.membershipsService.assertCommunityOperator(
      communityId,
      principal.sub,
    );

    return this.accessRequestsService.findByCommunity(communityId);
  }
}
