// Authorize request DTO
// Validation:
// - principalId: required UUID (user or AI agent)
// - resourceId: required UUID (community dataset)
// - purpose: required string (must match permission purpose)
// - operation: required enum (READ, ANALYZE)
// - requestsIndividualData: optional boolean (default false)
