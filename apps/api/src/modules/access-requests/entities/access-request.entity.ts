// AccessRequest entity
// PostgreSQL table: access_requests
// Columns:
// - id: UUID primary key
// - community_id: UUID not null FK -> communities(id)
// - requester_id: UUID not null FK -> users(id) (the brand)
// - dataset_id: UUID not null FK -> community_datasets(id)
// - purpose: TEXT not null (campaign_planning, research, etc.)
// - operation: TEXT not null (READ, ANALYZE)
// - requested_duration_seconds: INTEGER not null
// - status: TEXT not null (PENDING, APPROVED, REJECTED)
// - created_at: TIMESTAMPTZ default NOW()
//
// Example:
// {
//   "requester": "Nike",
//   "dataset": "Community Interests",
//   "purpose": "Campaign Planning",
//   "operation": "ANALYZE",
//   "duration": "30 days"
// }
//
// Relations:
// - community: ManyToOne -> Community
// - requester: ManyToOne -> User
// - dataset: ManyToOne -> CommunityDataset
// - governanceDecisions: OneToMany -> GovernanceDecision
// - permissions: OneToMany -> Permission
