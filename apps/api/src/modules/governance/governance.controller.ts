import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { GovernanceService } from './governance.service';
import { GovernanceDecision } from './entities/governance-decision.entity';
import { JwtAuthGuard, CurrentPrincipal } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

@ApiTags('Governance')
@Controller('access-requests/:id/governance')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  @Post('approve')
  @ApiOperation({
    summary: 'Record a governance decision',
    description:
      'Evaluates the community\'s configured rules. The threshold is derived ' +
      'from live active membership, not from anything the client supplies, ' +
      'and duplicate approvers are collapsed.',
  })
  @ApiParam({ name: 'id', description: 'Access request UUID' })
  @ApiResponse({ status: 201, description: 'Decision recorded' })
  approve(
    @Param('id') id: string,
    @Body('approvedBy') approvedBy: string[],
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<GovernanceDecision> {
    return this.governanceService.evaluate(id, approvedBy ?? [], principal.sub);
  }

  @Post('permissions')
  @ApiOperation({
    summary: 'Issue a permission from an approved decision',
    description:
      'The principal is the application that will exercise the permission ' +
      '(typically the AI agent), not the brand that made the request. A brand ' +
      'requesting access never grants the brand itself data access.',
  })
  @ApiResponse({ status: 201, description: 'Permission created' })
  @ApiResponse({ status: 400, description: 'Request was not approved' })
  createPermission(
    @Param('id') id: string,
    @Body('principalId') principalId: string,
  ): Promise<{ id: string; policyHash: string | null }> {
    return this.governanceService.createPermissionFromDecision(id, principalId);
  }

  @Get()
  @ApiOperation({ summary: 'List governance decisions for a request' })
  findByRequest(@Param('id') id: string): Promise<GovernanceDecision[]> {
    return this.governanceService.findByRequest(id);
  }
}
