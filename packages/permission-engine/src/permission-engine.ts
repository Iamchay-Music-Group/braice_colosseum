import {
  AccessEvaluationInput,
  AggregationLevel,
  AuthorizationDecision,
  DenialReason,
  Permission,
  PermissionStatus,
} from './types';

/**
 * The BRAICE permission engine.
 *
 * This is the only place a data access decision is made. Every protected read
 * and every AI tool call routes through checkAccess(). If a check is added
 * anywhere else, it will eventually diverge from this one.
 *
 * The engine is pure: it reads a permission and returns a decision, and never
 * performs I/O. Callers are responsible for loading the permission; the
 * engine is responsible for judging it.
 */
export class PermissionEngine {
  /**
   * Evaluate an access request against a permission.
   *
   * Checks run in a fixed, fail-closed order. The order matters for audit
   * clarity: a revoked permission reports PERMISSION_REVOKED even if the
   * caller also asked for the wrong purpose, because revocation is the more
   * significant fact and the one an auditor needs to see.
   */
  checkAccess(
    input: AccessEvaluationInput,
    permission: Permission | null,
  ): AuthorizationDecision {
    // 1. Resource must exist and be resolvable.
    if (!input.resource || !input.resource.id) {
      return this.deny(DenialReason.RESOURCE_NOT_FOUND);
    }

    // 2. A permission must exist at all.
    if (!permission) {
      return this.deny(DenialReason.NO_PERMISSION);
    }

    // 3. Revocation is checked before the generic not-active check so the
    //    reason distinguishes "we took it back" from "it never activated".
    if (permission.status === PermissionStatus.REVOKED) {
      return this.deny(DenialReason.PERMISSION_REVOKED, permission);
    }

    if (permission.status !== PermissionStatus.ACTIVE) {
      return this.deny(DenialReason.PERMISSION_NOT_ACTIVE, permission);
    }

    // 4. Expiry. Compared against the caller-supplied clock so tests are
    //    deterministic; callers pass new Date() in production.
    if (permission.expiresAt.getTime() <= input.now.getTime()) {
      return this.deny(DenialReason.PERMISSION_EXPIRED, permission);
    }

    // 5. Purpose must match exactly. This is what stops a permission granted
    //    for "campaign_planning" from being reused for "market_research".
    if (permission.purpose !== input.purpose) {
      return this.deny(DenialReason.PURPOSE_MISMATCH, permission);
    }

    // 6. Operation must be the one that was granted.
    if (permission.operation !== input.operation) {
      return this.deny(DenialReason.OPERATION_NOT_ALLOWED, permission);
    }

    // 7. Resource scope must match the permission's resource.
    if (permission.resourceId !== input.resource.id) {
      return this.deny(DenialReason.NO_PERMISSION, permission);
    }

    // 8. The data boundary. Derived from the resource's own aggregation level
    //    plus the server-written conditions — never from anything the caller
    //    supplied. A COMMUNITY resource is physically incapable of returning
    //    individual rows, so the only way to reach member data is through a
    //    member-scoped route, which never goes through this engine.
    const level = input.resource.aggregationLevel;
    if (
      level === AggregationLevel.COMMUNITY &&
      permission.conditions?.allowIndividualData !== false
    ) {
      return this.deny(DenialReason.INDIVIDUAL_DATA_RESTRICTED, permission);
    }

    return {
      allowed: true,
      permissionId: permission.id,
      communityId: input.resource.communityId,
      aggregationLevel: level,
    };
  }

  private deny(
    reason: DenialReason,
    permission?: Permission,
  ): AuthorizationDecision {
    return {
      allowed: false,
      reason,
      // The permission id is still returned on denial when we have one, so a
      // caller can tell "denied, and here is the permission that denied it"
      // from "no permission exists at all".
      ...(permission ? { permissionId: permission.id } : {}),
    };
  }

  /**
   * Conditions for a newly issued permission.
   *
   * Always community-level with individual access closed. This is the only
   * place conditions are constructed, so there is no path by which
   * allowIndividualData could be set true.
   */
  buildDefaultConditions(): Permission['conditions'] {
    return {
      aggregationLevel: AggregationLevel.COMMUNITY,
      allowIndividualData: false,
    };
  }
}

export const permissionEngine = new PermissionEngine();
