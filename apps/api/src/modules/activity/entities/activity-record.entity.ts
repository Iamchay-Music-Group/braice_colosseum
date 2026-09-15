// ActivityRecord entity
// PostgreSQL table: activity_records
// Columns:
// - id: UUID primary key
// - community_id: UUID not null FK -> communities(id)
// - member_id: UUID not null FK -> users(id)
// - activity_type: TEXT not null (clicked, viewed, purchased)
// - interest_category: TEXT not null (streetwear, music, sneakers, beauty)
// - metadata: JSONB optional
// - occurred_at: TIMESTAMPTZ not null
//
// CRITICAL: This table contains individual-level data.
// It must NEVER be directly queried by brands or AI.
// The aggregation pipeline (DatasetsModule) transforms this into community intelligence.
//
// Relations:
// - community: ManyToOne -> Community
// - member: ManyToOne -> User
