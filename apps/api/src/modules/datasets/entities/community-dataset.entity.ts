// CommunityDataset entity
// PostgreSQL table: community_datasets
// Columns:
// - id: UUID primary key
// - community_id: UUID not null FK -> communities(id)
// - dataset_type: TEXT not null (interests, demographics, etc.)
// - version: INTEGER not null (incremented on each generation)
// - data: JSONB not null (the aggregated community intelligence)
// - source_count: INTEGER not null (number of individual records used)
// - created_at: TIMESTAMPTZ default NOW()
//
// CRITICAL: This dataset does NOT contain:
// - member_id
// - name
// - email
// - phone
// - wallet
// - individual activity
//
// It only contains aggregated community-level intelligence.
//
// Relations:
// - community: ManyToOne -> Community
// - accessRequests: OneToMany -> AccessRequest
// - permissions: OneToMany -> Permission
