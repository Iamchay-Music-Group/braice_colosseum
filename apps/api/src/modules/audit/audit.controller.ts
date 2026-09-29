import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
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
import { AuditService } from './audit.service';
import { AuditEvent, AuditEventType } from './entities/audit-event.entity';
import {
  CurrentPrincipal,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

/**
 * The audit lifecycle, in the order a reader will see it:
 *
 *   ACCESS_REQUESTED      someone asked
 *   GOVERNANCE_APPROVED   the community said yes
 *   PERMISSION_CREATED    a scoped grant now exists
 *   AI_ACCESS_GRANTED     an analysis request passed the engine
 *   AI_ANALYSIS_COMPLETED an answer was produced
 *   ACCESS_GRANTED/DENIED every subsequent attempt, allowed or not
 *   PERMISSION_REVOKED    the community withdrew it
 *
 * The trail is evidence: anyone who reads it learns what a community approved,
 * for which principal, and for how long. So it is scoped at least as tightly as
 * the permissions it describes, and exposes no way to write.
 */
@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /api/communities/:communityId/audit
   *
   * Operator only. A community member cannot read this: membership is not
   * consent to see who was granted what, and the trail names grantees.
   */
  @Get('communities/:communityId/audit')
  @ApiOperation({
    summary: 'Audit trail for a community',
    description:
      'Operator-only. The full decision history for a community, newest ' +
      'first, including denied attempts.',
  })
  @ApiParam({ name: 'communityId', description: 'Community UUID' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max events (1-500)' })
  @ApiOkResponse({ description: 'Audit events, newest first' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is not the community operator, or it does not exist',
  })
  async findByCommunity(
    @Param('communityId') communityId: string,
    @CurrentPrincipal() principal: JwtPayload,
    @Query('limit') limit?: string,
  ): Promise<AuditEvent[]> {
    await this.auditService.assertCommunityOperator(
      principal.sub,
      communityId,
    );

    return this.auditService.findByCommunity(
      communityId,
      AuditController.parseLimit(limit),
    );
  }

  /**
   * GET /api/permissions/:permissionId/audit
   *
   * The grantee may read their own permission's trail — a data subject with a
   * right to know what was granted about them is a legitimate reader, and the
   * route is already scoped to one permission. Anyone else must be the
   * operator of the community owning the resource.
   */
  @Get('permissions/:permissionId/audit')
  @ApiOperation({
    summary: 'Audit trail for one permission',
    description:
      'Readable by the grantee of the permission or by the operator of the ' +
      'community that owns the resource.',
  })
  @ApiParam({ name: 'permissionId', description: 'Permission UUID' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max events (1-500)' })
  @ApiOkResponse({ description: 'Audit events, newest first' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({
    description: 'Caller is neither the grantee nor the community operator',
  })
  @ApiNotFoundResponse({ description: 'Permission not found' })
  async findByPermission(
    @Param('permissionId') permissionId: string,
    @CurrentPrincipal() principal: JwtPayload,
    @Query('limit') limit?: string,
  ): Promise<AuditEvent[]> {
    const permission = await this.auditService.findPermission(permissionId);

    // A caller holding a permission UUID legitimately needs a 404 for an id
    // that does not exist, so this is the one route that distinguishes the two.
    if (!permission) {
      throw new NotFoundException(`Permission ${permissionId} not found`);
    }

    const isGrantee = permission.principalId === principal.sub;
    const isOperator = await this.auditService.isOperatorForResource(
      permission.resourceId,
      principal.sub,
    );

    if (!isGrantee && !isOperator) {
      throw new ForbiddenException(
        'Only the grantee of this permission or the community operator may ' +
          'read its audit trail',
      );
    }

    // Filtered by role. The operator auditing a grant's lifecycle does not
    // need the access log; the grantee checking what was decided about them
    // does not need to see other principals' activity. The unfiltered trail is
    // the community-scoped route.
    const eventTypes = isOperator
      ? undefined
      : [
          AuditEventType.ACCESS_REQUESTED,
          AuditEventType.GOVERNANCE_APPROVED,
          AuditEventType.GOVERNANCE_REJECTED,
          AuditEventType.PERMISSION_CREATED,
          AuditEventType.PERMISSION_REVOKED,
        ];

    return this.auditService.findByPermission(permissionId, {
      limit: AuditController.parseLimit(limit),
      eventTypes,
    });
  }

  /**
   * Clamp the caller's limit rather than trusting or rejecting it.
   *
   * A bad limit is a client bug, not an attack, and failing the whole request
   * over it serves nobody. Anything unparseable falls back to the default,
   * which is also enforced service-side.
   */
  private static parseLimit(raw?: string): number {
    if (raw === undefined) return 100;

    const parsed = Number.parseInt(raw, 10);

    if (!Number.isFinite(parsed) || parsed <= 0) return 100;

    return Math.min(parsed, 500);
  }
}
