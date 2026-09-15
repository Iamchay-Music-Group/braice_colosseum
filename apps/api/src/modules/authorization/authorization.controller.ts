// Authorization controller
// REST endpoints:
// - POST /api/authorize - Check if request is authorized
//
// This is the key endpoint for runtime authorization.
// Request:
// {
//   "principalId": "...",
//   "resourceId": "...",
//   "purpose": "campaign_planning",
//   "operation": "ANALYZE"
// }
//
// Response:
// {
//   "allowed": true,
//   "permissionId": "perm-123"
// }
