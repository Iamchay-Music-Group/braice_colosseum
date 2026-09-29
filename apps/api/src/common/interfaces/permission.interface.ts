/**
 * Re-exports of the canonical permission types.
 *
 * These enums are DEFINED in packages/permission-engine and re-exported here
 * so there is exactly one definition of "what an Operation is". The engine
 * previously had its own copy of these enums alongside this file, which meant
 * a change to one would silently not apply to the other.
 */
export {
  PermissionStatus,
  Operation,
  PrincipalType,
  AggregationLevel,
  DenialReason,
} from '@braice/permission-engine';

export type {
  PermissionConditions,
  Permission as EnginePermission,
  ProtectedResource,
  AccessEvaluationInput,
  AuthorizationDecision,
} from '@braice/permission-engine';