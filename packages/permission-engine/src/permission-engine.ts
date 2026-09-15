// Permission engine
// CORE: checkAccess(), createPermission(), revokePermission(), expirePermission()
//
// checkAccess(input: AccessRequest): AuthorizationDecision
//   - Identifies principal, resource, operation
//   - Finds applicable permission
//   - Verifies status, expiration, purpose, operation, conditions
//   - Returns ALLOW or DENY with reason
//
// createPermission(accessRequest, governanceDecision): Permission
//   - Creates permission from approved governance decision
//   - Sets conditions: aggregationLevel=COMMUNITY, allowIndividualData=false
//   - Generates policy hash
//
// revokePermission(permissionId): void
//   - Changes status from ACTIVE to REVOKED
//   - Triggers audit event and blockchain record
//
// expirePermissions(): void
//   - Marks expired permissions
