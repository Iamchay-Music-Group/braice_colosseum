// AI controller
// REST endpoints:
// - POST /api/ai/query - Ask AI a question about community
//
// Request:
// {
//   "communityId": "...",
//   "question": "What are the strongest emerging interests?"
// }
//
// The AI service determines what data it needs.
// It then goes through the permission gateway.
//
// Response:
// {
//   "answer": "Streetwear is the strongest emerging interest...",
//   "dataAccessed": "community-dataset-123",
//   "permissionId": "perm-456"
// }
