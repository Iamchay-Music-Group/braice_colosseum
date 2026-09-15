// Permission interfaces
//
// PermissionStatus: PENDING, ACTIVE, EXPIRED, REVOKED
// Operation: READ, ANALYZE, EXPORT
// PrincipalType: USER, APPLICATION
//
// Permission object:
// - id: unique identifier
// - principal: who (type + id)
// - resource: what (COMMUNITY_DATASET + id)
// - purpose: why (campaign_planning, etc.)
// - operations: how (READ, ANALYZE)
// - conditions: aggregation level, allowIndividualData
// - issuedAt/expiresAt: duration
// - status: current state
// - policyHash: for blockchain verification
