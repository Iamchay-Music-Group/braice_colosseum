import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from '../permissions/permissions.service';
import { AuthorizeRequestDto } from './dto/authorize-request.dto';
import { AuthorizationResponseDto } from './dto/authorization-response.dto';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';
import { AuditService } from '../audit/audit.service';

/**
 * The authorization gateway.
 *
 * Every data access in BRAICE passes through authorize(). It is the boundary
 * between "a caller asked" and "BRAICE decided". Nothing else in the codebase
 * is permitted to read a community dataset for an external principal.
 */
@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly auditService: AuditService,
    @InjectRepository(CommunityDataset)
    private readonly datasetRepo: Repository<CommunityDataset>,
  ) {}

  /**
   * Decide whether an authenticated principal may access a resource.
   *
   * The principalId is the caller's verified identity, supplied by the guard
   * from the JWT — never read from the request body.
   */
  async authorize(
    principalId: string,
    dto: AuthorizeRequestDto,
  ): Promise<AuthorizationResponseDto> {
    const decision = await this.permissionsService.checkAccess({
      principalId,
      resourceId: dto.resourceId,
      purpose: dto.purpose,
      operation: dto.operation,
    });

    await this.auditService.record({
      communityId: decision.communityId ?? null,
      actorId: principalId,
      eventType: decision.allowed
        ? 'ACCESS_GRANTED'
        : 'ACCESS_DENIED',
      resourceId: dto.resourceId,
      permissionId: decision.permissionId ?? null,
      metadata: {
        purpose: dto.purpose,
        operation: dto.operation,
        reason: decision.reason,
        aggregationLevel: decision.aggregationLevel,
      },
    });

    if (!decision.allowed) {
      this.logger.log(
        `DENY principal=${principalId} resource=${dto.resourceId} reason=${decision.reason}`,
      );
    }

    return decision;
  }

  /**
   * Fetch a dataset, but only after the permission engine allows it.
   *
   * This is the pattern every consumer should follow: authorize, then read.
   * The engine is consulted here rather than trusting the caller to have
   * done so, so a missing check cannot leak data.
   */
  async loadAuthorizedDataset(
    principalId: string,
    dto: AuthorizeRequestDto,
  ): Promise<CommunityDataset> {
    const decision = await this.authorize(principalId, dto);

    if (!decision.allowed) {
      throw new NotFoundException(
        `Access denied: ${decision.reason ?? 'UNKNOWN'}`,
      );
    }

    const dataset = await this.datasetRepo.findOne({
      where: { id: dto.resourceId },
    });

    if (!dataset) {
      throw new NotFoundException(`Dataset ${dto.resourceId} not found`);
    }

    return dataset;
  }
}
