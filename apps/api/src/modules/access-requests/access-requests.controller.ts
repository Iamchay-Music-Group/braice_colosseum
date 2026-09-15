// AccessRequests controller
// REST endpoints:
// - POST /api/access-requests - Create access request (brand only)
// - GET /api/access-requests/:id - Get request details
// - GET /api/communities/:id/access-requests - List requests for community
//
// Request body:
// {
//   "communityId": "...",
//   "datasetId": "...",
//   "purpose": "campaign_planning",
//   "operation": "ANALYZE",
//   "durationSeconds": 2592000
// }
