import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GovernanceService } from './governance.service';
import { RecordDecisionDto } from './dto/record-decision.dto';
import { IssuePermissionDto } from './dto/issue-permission.dto';
import { GovernanceDecision } from './entities/governance-decision.entity';
import { JwtAuthGuard, CurrentPrincipal } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

/**
 * Governance decisions, and the permissions issued from them.
 *
 * Every route here is operator-only. These are the two endpoints in the system
 * that create authority — one approves, one mints an enforceable grant anchored
 * on-chain — and both previously took the operator's word for it: the guard
 * proved who the caller was, and `principal.sub` was then used only as the audit
 * actor. Any authenticated account could therefore record an approval on a
 * community it had no claim on and issue itself a permission to that community's
 * data. The operator check now happens in the service, against the community
 * named by the request rather than anything the client supplies.
 *
 * The bodies are decorated DTOs rather than `@Body('field')` reads. Those read
 * the key straight off the raw object, so the global ValidationPipe had nothing
 * to inspect and `forbidNonWhitelisted` never applied.
 */
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
      'Operator only. Evaluates the community\'s configured rules. The threshold ' +
      'is derived from live active membership, not from anything the client ' +
      'supplies, duplicate approvers are collapsed, and an approver that is not ' +
      'an active member of this community is rejected rather than counted.',
  })
  @ApiParam({ name: 'id', description: 'Access request UUID' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is not the operator of this community',
  })
  @ApiNotFoundResponse({ description: 'Access request not found' })
  approve(
    @Param('id') id: string,
    @Body() dto: RecordDecisionDto,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<GovernanceDecision> {
    return this.governanceService.evaluate(id, dto.approvedBy, principal.sub);
  }

  @Post('permissions')
  @ApiOperation({
    summary: 'Issue a permission from an approved decision',
    description:
      'Operator only. The principal is the application that will exercise the ' +
      'permission (typically the AI agent), not the partner that made the request. ' +
      'A partner requesting access never grants the partner itself data access.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is not the operator of this community',
  })
  @ApiNotFoundResponse({ description: 'Access request not found' })
  createPermission(
    @Param('id') id: string,
    @Body() dto: IssuePermissionDto,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<{ id: string; policyHash: string | null }> {
    return this.governanceService.createPermissionFromDecision(
      id,
      dto.principalId,
      principal.sub,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List governance decisions for a request',
    description: 'Readable by the requester and the community operator.',
  })
  @ApiParam({ name: 'id', description: 'Access request UUID' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is neither the requester nor the community operator',
  })
  findByRequest(
    @Param('id') id: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<GovernanceDecision[]> {
    return this.governanceService.findByRequest(id, principal.sub);
  }
}
