import {
  AggregationLevel,
  DenialReason,
  Operation,
  PermissionEngine,
  PermissionStatus,
} from '@braice/permission-engine';
import type {
  AccessEvaluationInput,
  Permission,
  ProtectedResource,
} from '@braice/permission-engine';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const FUTURE = new Date('2026-12-31T00:00:00.000Z');
const PAST = new Date('2025-01-01T00:00:00.000Z');

const RESOURCE: ProtectedResource = {
  id: 'dataset-uuid',
  communityId: 'community-uuid',
  datasetType: 'interests',
  aggregationLevel: AggregationLevel.COMMUNITY,
};

function input(overrides: Partial<AccessEvaluationInput> = {}): AccessEvaluationInput {
  return {
    principalId: 'brand-user-id',
    resource: RESOURCE,
    purpose: 'campaign_planning',
    operation: Operation.ANALYZE,
    now: NOW,
    ...overrides,
  };
}

function permission(overrides: Partial<Permission> = {}): Permission {
  return {
    id: 'permission-1',
    accessRequestId: 'request-1',
    principalId: 'brand-user-id',
    resourceId: 'dataset-uuid',
    purpose: 'campaign_planning',
    operation: Operation.ANALYZE,
    conditions: {
      aggregationLevel: AggregationLevel.COMMUNITY,
      allowIndividualData: false,
    },
    issuedAt: PAST,
    expiresAt: FUTURE,
    revokedAt: null,
    status: PermissionStatus.ACTIVE,
    policyHash: 'abc123',
    blockchainReference: null,
    ...overrides,
  };
}

describe('PermissionEngine', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine();
  });

  describe('allow path', () => {
    it('allows a valid, active, unexpired, correctly-scoped request', () => {
      const decision = engine.checkAccess(input(), permission());

      expect(decision.allowed).toBe(true);
      expect(decision.permissionId).toBe('permission-1');
      expect(decision.communityId).toBe('community-uuid');
      expect(decision.aggregationLevel).toBe(AggregationLevel.COMMUNITY);
      expect(decision.reason).toBeUndefined();
    });

    it('reports COMMUNITY aggregation on success so callers know the data boundary', () => {
      const decision = engine.checkAccess(input(), permission());
      expect(decision.aggregationLevel).not.toBe(AggregationLevel.INDIVIDUAL);
    });
  });

  describe('denial reasons', () => {
    it('denies with NO_PERMISSION when no permission exists', () => {
      const decision = engine.checkAccess(input(), null);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.NO_PERMISSION);
      expect(decision.permissionId).toBeUndefined();
    });

    it('denies with NO_PERMISSION when the permission is scoped to a different resource', () => {
      const decision = engine.checkAccess(
        input(),
        permission({ resourceId: 'some-other-dataset' }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.NO_PERMISSION);
    });

    it('denies with PERMISSION_REVOKED after revocation', () => {
      const decision = engine.checkAccess(
        input(),
        permission({
          status: PermissionStatus.REVOKED,
          revokedAt: PAST,
        }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.PERMISSION_REVOKED);
    });

    it('distinguishes revocation from never-active', () => {
      const revoked = engine.checkAccess(
        input(),
        permission({ status: PermissionStatus.REVOKED }),
      );
      const pending = engine.checkAccess(
        input(),
        permission({ status: PermissionStatus.PENDING }),
      );

      expect(revoked.reason).toBe(DenialReason.PERMISSION_REVOKED);
      expect(pending.reason).toBe(DenialReason.PERMISSION_NOT_ACTIVE);
    });

    it('denies with PERMISSION_NOT_ACTIVE for PENDING permissions', () => {
      const decision = engine.checkAccess(
        input(),
        permission({ status: PermissionStatus.PENDING }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.PERMISSION_NOT_ACTIVE);
    });

    it('denies with PERMISSION_EXPIRED once expiresAt has passed', () => {
      const decision = engine.checkAccess(
        input(),
        permission({ expiresAt: new Date('2025-06-01T00:00:00.000Z') }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.PERMISSION_EXPIRED);
    });

    it('treats the exact expiry instant as expired, not valid', () => {
      const decision = engine.checkAccess(
        input(),
        permission({ expiresAt: NOW }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.PERMISSION_EXPIRED);
    });

    it('denies with PURPOSE_MISMATCH when the purpose differs', () => {
      const decision = engine.checkAccess(
        input({ purpose: 'market_research' }),
        permission(),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.PURPOSE_MISMATCH);
    });

    it('denies with OPERATION_NOT_ALLOWED when a different operation is requested', () => {
      const decision = engine.checkAccess(
        input({ operation: Operation.EXPORT }),
        permission({ operation: Operation.ANALYZE }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.OPERATION_NOT_ALLOWED);
    });

    it('denies with INDIVIDUAL_DATA_RESTRICTED if conditions permit individual data on a community resource', () => {
      const decision = engine.checkAccess(
        input(),
        permission({
          conditions: {
            aggregationLevel: AggregationLevel.COMMUNITY,
            allowIndividualData: true,
          },
        }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.INDIVIDUAL_DATA_RESTRICTED);
    });

    it('denies with RESOURCE_NOT_FOUND when the resource is absent', () => {
      const decision = engine.checkAccess(
        input({ resource: undefined as unknown as ProtectedResource }),
        permission(),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(DenialReason.RESOURCE_NOT_FOUND);
    });
  });

  describe('check ordering', () => {
    it('reports PERMISSION_REVOKED even when the purpose is also wrong', () => {
      // Revocation is the more significant fact; an auditor scanning denial
      // reasons needs to see that the community withdrew access.
      const decision = engine.checkAccess(
        input({ purpose: 'wrong_purpose' }),
        permission({ status: PermissionStatus.REVOKED }),
      );

      expect(decision.reason).toBe(DenialReason.PERMISSION_REVOKED);
    });

    it('reports PERMISSION_EXPIRED even when the operation is also wrong', () => {
      const decision = engine.checkAccess(
        input({ operation: Operation.EXPORT }),
        permission({ expiresAt: PAST }),
      );

      expect(decision.reason).toBe(DenialReason.PERMISSION_EXPIRED);
    });

    it('reports PURPOSE_MISMATCH before OPERATION_NOT_ALLOWED', () => {
      const decision = engine.checkAccess(
        input({ purpose: 'wrong_purpose', operation: Operation.EXPORT }),
        permission(),
      );

      expect(decision.reason).toBe(DenialReason.PURPOSE_MISMATCH);
    });
  });

  describe('buildDefaultConditions', () => {
    it('always closes individual data access', () => {
      expect(engine.buildDefaultConditions().allowIndividualData).toBe(false);
    });

    it('always produces COMMUNITY aggregation', () => {
      expect(engine.buildDefaultConditions().aggregationLevel).toBe(
        AggregationLevel.COMMUNITY,
      );
    });

    it('returns a fresh object each call so callers cannot mutate shared state', () => {
      const first = engine.buildDefaultConditions();
      first.allowIndividualData = true;

      expect(engine.buildDefaultConditions().allowIndividualData).toBe(false);
    });
  });
});
