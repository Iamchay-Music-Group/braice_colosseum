// Permissions controller
// REST endpoints:
// - GET /api/permissions/:id - Get permission details
// - POST /api/permissions/:id/revoke - Revoke permission (creator only)
// - POST /api/authorize - Check if request is authorized
//
// POST /api/authorize is the key endpoint.
// Request:
// {
//   "principalId": "ai-agent",
//   "resourceId": "community-dataset-123",
//   "purpose": "campaign_planning",
//   "operation": "ANALYZE"
// }
//
// Response:
// {
//   "allowed": true,
//   "permissionId": "perm-123"
// }
// or:
// {
//   "allowed": false,
//   "reason": "PERMISSION_REVOKED"
// }
