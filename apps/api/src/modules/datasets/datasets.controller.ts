import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { DatasetsService } from './datasets.service';
import { CommunityDataset } from './entities/community-dataset.entity';

@ApiTags('Datasets')
@Controller()
export class DatasetsController {
  constructor(private readonly datasetsService: DatasetsService) {}

  @Post('communities/:communityId/datasets/generate')
  @ApiOperation({
    summary: 'Aggregate community activity into community intelligence',
    description:
      'The data boundary. Individual records are collapsed to category ' +
      'percentages; no member identifier crosses this line.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiResponse({ status: 201, description: 'Dataset generated' })
  @ApiResponse({ status: 404, description: 'Community not found' })
  generate(
    @Param('communityId') communityId: string,
    @Body('datasetType') datasetType?: string,
  ): Promise<CommunityDataset> {
    return this.datasetsService.generate(communityId, datasetType ?? 'interests');
  }

  @Get('communities/:communityId/datasets')
  @ApiOperation({ summary: 'List datasets for a community' })
  findByCommunity(
    @Param('communityId') communityId: string,
  ): Promise<CommunityDataset[]> {
    return this.datasetsService.findByCommunity(communityId);
  }

  @Get('datasets/:id')
  @ApiOperation({ summary: 'Get a dataset' })
  @ApiResponse({ status: 404, description: 'Dataset not found' })
  findById(@Param('id') id: string): Promise<CommunityDataset> {
    return this.datasetsService.findById(id);
  }
}
