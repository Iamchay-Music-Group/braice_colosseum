/**
 * Core permission types.
 *
 * These are deliberately framework-free. The engine is pure logic so it can
 * be tested exhaustively without a database, and so the same rules could be
 * reused by an edge worker or a different backend later.
 */

export enum PermissionStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

export enum Operation {
  READ = 'READ',
  ANALYZE = 'ANALYZE',
  EXPORT = 'EXPORT',
}

export enum PrincipalType {
  USER = 'USER',
  APPLICATION = 'APPLICATION',
}

/**
 * Aggregation level of the underlying resource.
 *
 * This is derived from the resource itself, never from the caller. A
 * COMMUNITY_DATASET physically contains no member-level rows, so a permission
 * against one can never be escalated into individual data.
 */
export enum AggregationLevel {
  INDIVIDUAL = 'INDIVIDUAL',
  COMMUNITY = 'COMMUNITY',
}

export interface PermissionConditions {
  aggregationLevel: AggregationLevel;
  allowIndividualData: boolean;
}

export interface Permission {
  id: string;
  accessRequestId: string;
  principalId: string;
  resourceId: string;
  purpose: string;
  operation: Operation;
  conditions: PermissionConditions;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  status: PermissionStatus;
  policyHash?: string | null;
  blockchainReference?: string | null;
}

export interface ProtectedResource {
  id: string;
  communityId: string;
  datasetType: string;
  aggregationLevel: AggregationLevel;
}

export interface AccessEvaluationInput {
  principalId: string;
  resource: ProtectedResource;
  purpose: string;
  operation: Operation;
  now: Date;
  /**
   * The granularity the caller is asking to read at, which may be finer than
   * the resource naturally provides.
   *
   * Set this when a caller reaches for member-level detail through an
   * otherwise-authorized path — an AI tool being asked "which members like
   * streetwear" is the motivating case. The engine denies it with
   * INDIVIDUAL_DATA_RESTRICTED, so the refusal is a recorded policy decision
   * rather than a shape error the caller happened to avoid.
   *
   * Omitted by ordinary reads, which want the resource as-is. It is a request,
   * never an entitlement: naming a coarser level grants nothing, and the
   * server-written conditions below remain the only authority on what is
   * reachable.
   */
  requestedAggregationLevel?: AggregationLevel;
}

export enum DenialReason {
  NO_PERMISSION = 'NO_PERMISSION',
  PERMISSION_NOT_ACTIVE = 'PERMISSION_NOT_ACTIVE',
  PERMISSION_REVOKED = 'PERMISSION_REVOKED',
  PERMISSION_EXPIRED = 'PERMISSION_EXPIRED',
  PURPOSE_MISMATCH = 'PURPOSE_MISMATCH',
  OPERATION_NOT_ALLOWED = 'OPERATION_NOT_ALLOWED',
  INDIVIDUAL_DATA_RESTRICTED = 'INDIVIDUAL_DATA_RESTRICTED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason?: DenialReason;
  permissionId?: string;
  communityId?: string;
  aggregationLevel?: AggregationLevel;
}
