// AI service
// Orchestrates AI agent + permission checks
//
// query(communityId, question):
//   1. AI Agent determines needed data
//   2. Tool: communityInsight(communityId)
//     -> PermissionEngine.checkAccess(principal=ai, resource=dataset, operation=ANALYZE)
//     -> If ALLOW: return aggregated dataset
//     -> If DENY: return error
//   3. LLM processes authorized data
//   4. Return insight
//
// The AI never has direct database access.
