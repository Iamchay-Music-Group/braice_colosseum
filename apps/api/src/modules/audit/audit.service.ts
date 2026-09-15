// Audit service
// Business logic:
// - logEvent(dto) - Record audit event
// - findByCommunity(communityId) - Get audit trail for community
// - findByPermission(permissionId) - Get audit trail for permission
// - findByTimeRange(start, end) - Get events in time range
//
// Audit events:
// - ACCESS_REQUESTED
// - GOVERNANCE_APPROVED
// - GOVERNANCE_REJECTED
// - PERMISSION_CREATED
// - AI_ACCESS_GRANTED
// - AI_ANALYSIS_COMPLETED
// - PERMISSION_REVOKED
// - ACCESS_DENIED
