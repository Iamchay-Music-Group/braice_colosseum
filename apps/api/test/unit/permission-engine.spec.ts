// Permission engine unit tests
//
// Test cases:
// - checkAccess: returns ALLOW for valid permission
// - checkAccess: returns DENY for no permission
// - checkAccess: returns DENY for expired permission
// - checkAccess: returns DENY for revoked permission
// - checkAccess: returns DENY for wrong purpose
// - checkAccess: returns DENY for wrong operation
// - checkAccess: returns DENY for individual data request
// - createPermission: creates permission from governance decision
// - revokePermission: changes status to REVOKED
