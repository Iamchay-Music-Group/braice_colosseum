import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Operation } from '@braice/permission-engine';
import { DatasetsService } from './datasets.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { MembershipsService } from '../memberships/memberships.service';
import { CommunityDataset } from './entities/community-dataset.entity';
import {
  DatasetAccessQueryDto,
  DatasetSummary,
} from './dto/dataset-access-query.dto';
import {
  CurrentPrincipal,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Community datasets: the community-level aggregate.
 *
 * A CommunityDataset contains no member identifiers, which is what makes it
 * publishable at all — but it is still a community's derived intelligence, and
 * the governance model exists precisely so a community decides who receives
 * it. Every read below is therefore scoped to the operator or to a permission.
 */
@ApiTags('Datasets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DatasetsController {
  constructor(
    private readonly datasetsService: DatasetsService,
    private readonly authorizationService: AuthorizationService,
    private readonly membershipsService: MembershipsService,
  ) {}

  @Post('communities/:communityId/datasets/generate')
  @ApiOperation({
    summary: 'Aggregate community activity into community intelligence',
    description:
      'The data boundary. Individual records are collapsed to category ' +
      'percentages; no member identifier crosses this line.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiOkResponse({ description: 'Dataset generated' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is not the operator of this community',
  })
  @ApiNotFoundResponse({ description: 'Community not found' })
  async generate(
    @Param('communityId') communityId: string,
    @Body('datasetType') datasetType: string | undefined,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<CommunityDataset> {
    // Aggregation reads every individual record in the community, so it is
    // reserved to the operator. Anyone else can be served a dataset that
    // already exists; none of them may cause one to be built.
    const community = await this.datasetsService.findCommunity(communityId);

    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    if (community.operatorId !== principal.sub) {
      throw new ForbiddenException(
        'Only the community operator may generate a dataset',
      );
    }

    return this.datasetsService.generate(communityId, datasetType ?? 'interests');
  }

  @Get('communities/:communityId/datasets')
  @ApiOperation({
    summary: 'List datasets for a community',
    description:
      'Metadata only: id, type, version, source count and creation time. The ' +
      'aggregate contents are NOT included — reading those is governed by ' +
      'GET /api/datasets/:id and requires a permission. Members and the ' +
      'operator may list; nobody may read contents through this route.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiOkResponse({ description: 'Dataset metadata for the community' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is not a member or the operator',
  })
  async findByCommunity(
    @Param('communityId') communityId: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<DatasetSummary[]> {
    const community = await this.datasetsService.findCommunity(communityId);

    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    if (community.operatorId !== principal.sub) {
      const isMember = await this.membershipsService.isActiveMember(
        principal.sub,
        communityId,
      );

      if (!isMember) {
        throw new ForbiddenException(
          'Only a member or the operator may list community datasets',
        );
      }
    }

    // Stripped of `data`, deliberately and for everyone including the operator.
    //
    // This route returned whole CommunityDataset rows, so a plain member — who
    // holds no permission at all — could read the same aggregate that an
    // approved permission exists to govern, by listing instead of fetching.
    // The governed route below was doing its job the whole time and was simply
    // not the only way in.
    //
    // A version number and a record count are not intelligence: they say that
    // something was derived, not what it found. That is the same reasoning
    // that keeps the member count readable, applied here.
    return (await this.datasetsService.findByCommunity(communityId)).map(
      (dataset) => ({
        id: dataset.id,
        datasetType: dataset.datasetType,
        version: dataset.version,
        sourceCount: dataset.sourceCount,
        createdAt: dataset.createdAt,
      }),
    );
  }

  /**
   * GET /api/datasets/:id
   *
   * Governed. This route used to hand any community's aggregate to any
   * caller who guessed a UUID, which is the same object an approved permission
   * exists to protect — a permission is only meaningful if the thing it
   * governs is not otherwise open.
   *
   * There is no unauthenticated variant. A community's operator may always see
   * their own data; everyone else needs an active permission whose purpose and
   * operation match what they declared.
   */
  @Get('datasets/:id')
  @ApiOperation({
    summary: 'Get a dataset (permission required)',
    description:
      'Returns a community dataset. The community operator may always read ' +
      'their own; any other caller must present a valid permission for this ' +
      'resource, purpose and operation. A caller with no permission receives ' +
      '404, not 403, so the route cannot be used to probe which dataset ids ' +
      'exist.',
  })
  @ApiParam({ name: 'id', description: 'Dataset UUID' })
  @ApiOkResponse({ description: 'Dataset found' })
  @ApiBadRequestResponse({
    description: 'purpose or operation missing or invalid',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'No valid permission for this resource and purpose',
  })
  @ApiNotFoundResponse({ description: 'Dataset not found, or not permitted' })
  async findById(
    @Param('id') id: string,
    @Query() query: DatasetAccessQueryDto,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<CommunityDataset> {
    // Read only enough to learn who owns it. Nothing is returned on this path;
    // it exists so the operator exemption can be applied without a permission,
    // and so a non-operator never sees a row they were not entitled to.
    const communityId = await this.datasetsService.findCommunityIdOf(id);

    if (!communityId) {
      throw new NotFoundException(`Dataset ${id} not found`);
    }

    const community = await this.datasetsService.findCommunity(communityId);

    if (community?.operatorId === principal.sub) {
      return this.datasetsService.requireById(id);
    }

    // loadAuthorizedDataset runs the engine and then re-reads. Handing the
    // decision back a row it was never shown is what keeps a denial from
    // becoming a distinguishable 403: the caller learns that the id does not
    // resolve for them, and nothing about anyone else's data.
    return this.authorizationService.loadAuthorizedDataset(principal.sub, {
      resourceId: id,
      purpose: query.purpose,
      operation: query.operation as Operation,
    });
  }
}
