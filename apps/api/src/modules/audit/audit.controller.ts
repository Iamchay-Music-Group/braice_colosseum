// Audit controller
// REST endpoints:
// - GET /api/communities/:id/audit - Get audit trail for community
// - GET /api/permissions/:id/audit - Get audit trail for permission
//
// The audit page should show:
// 11:02:14 ACCESS_REQUESTED
// 11:03:01 GOVERNANCE_APPROVED
// 11:03:05 PERMISSION_CREATED
// 11:04:10 AI_ACCESS_GRANTED
// 11:04:13 AI_ANALYSIS_COMPLETED
// 11:05:21 PERMISSION_REVOKED
// 11:05:30 ACCESS_ATTEMPT
// 11:05:30 ACCESS_DENIED
