import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { AccessRequestsService } from './access-requests.service';
import { AccessRequest } from './entities/access-request.entity';

@ApiTags('Access Requests')
@Controller('access-requests')
export class AccessRequestsController {
  constructor(private readonly accessRequestsService: AccessRequestsService) {}

  @Post()
  @ApiOperation({
    summary: 'Submit an access request',
    description:
      'A request is a proposal only. It confers no access until community ' +
      'governance approves it and a permission is issued.',
  })
  @ApiResponse({ status: 201, description: 'Request created (status PENDING)' })
  create(
    @Body()
    body: {
      communityId: string;
      requesterId: string;
      datasetId: string;
      purpose: string;
      operation: string;
      requestedDurationSeconds: number;
    },
  ): Promise<AccessRequest> {
    return this.accessRequestsService.create(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an access request' })
  @ApiParam({ name: 'id', description: 'Access request UUID' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  findById(@Param('id') id: string): Promise<AccessRequest> {
    return this.accessRequestsService.findById(id);
  }

  @Get()
  @ApiOperation({ summary: 'List requests for a community' })
  findByCommunity(@Param('communityId') communityId: string): Promise<AccessRequest[]> {
    return this.accessRequestsService.findByCommunity(communityId);
  }
}
