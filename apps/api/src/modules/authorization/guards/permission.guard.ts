import { SetMetadata, CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../../permissions/permissions.service';
import { AuthenticatedRequest } from '../../../common/guards/jwt-auth.guard';
import { Operation } from '../../../common/interfaces/permission.interface';

export const REQUIRED_PERMISSION = 'required_permission';

export interface RequiredPermissionMetadata {
  purpose: string;
  operation: Operation;
  /** Route param carrying the dataset UUID. Defaults to 'id'. */
  resourceParam?: string;
}

/**
 * Declarative route protection.
 *
 * @RequirePermission('campaign_planning', Operation.ANALYZE)
 * on a route with an :id param routes every request through the permission
 * engine first.
 */
export const RequirePermission = (metadata: RequiredPermissionMetadata) =>
  SetMetadata(REQUIRED_PERMISSION, metadata);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      RequiredPermissionMetadata | undefined
    >(REQUIRED_PERMISSION, [context.getHandler(), context.getClass()]);

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      AuthenticatedRequest & { params: Record<string, string> }
    >();

    if (!request.principal) {
      // JwtAuthGuard must run first; without a principal we cannot decide.
      throw new ForbiddenException('Route requires an authenticated principal');
    }

    const param = required.resourceParam ?? 'id';
    const resourceId = request.params?.[param];
    if (!resourceId) {
      throw new ForbiddenException(
        `Route parameter "${param}" is required to resolve the protected resource`,
      );
    }

    const decision = await this.permissionsService.checkAccess({
      principalId: request.principal.sub,
      resourceId,
      purpose: required.purpose,
      operation: required.operation,
    });

    if (!decision.allowed) {
      throw new ForbiddenException(
        `Permission denied: ${decision.reason ?? 'UNKNOWN'}`,
      );
    }

    return true;
  }
}
