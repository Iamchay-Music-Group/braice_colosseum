// Community entity
// PostgreSQL table: communities
// Columns:
// - id: UUID primary key
// - name: TEXT not null (e.g., "Afrobeat Creators")
// - description: TEXT optional
// - operator_id: UUID not null FK -> users(id) (the creator)
// - governance_config: JSONB not null
//   Example: { "approval_mode": "CREATOR_AND_THRESHOLD", "threshold_percentage": 60 }
// - created_at: TIMESTAMPTZ default NOW()
//
// Relations:
// - operator: ManyToOne -> User
// - memberships: OneToMany -> Membership
// - activityRecords: OneToMany -> ActivityRecord
// - datasets: OneToMany -> CommunityDataset
// - accessRequests: OneToMany -> AccessRequest
// - auditEvents: OneToMany -> AuditEvent
