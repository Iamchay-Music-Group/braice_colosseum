// Permissions service
// Business logic:
// - createPermission(accessRequest, governanceDecision) - Create permission from decision
// - findById(id) - Get permission
// - revoke(id, revokerId) - Revoke permission (ACTIVE -> REVoked)
// - findActivePermission(principalId, resourceId) - Find active permission
// - expirePermissions() - Mark expired permissions
//
// When governance approves, this service creates the permission.
