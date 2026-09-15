// Membership entity
// PostgreSQL table: memberships
// Columns:
// - id: UUID primary key
// - community_id: UUID not null FK -> communities(id)
// - user_id: UUID not null FK -> users(id)
// - role: TEXT not null (OPERATOR, MEMBER)
// - status: TEXT not null (ACTIVE, INACTIVE)
// - joined_at: TIMESTAMPTZ default NOW()
// - UNIQUE(community_id, user_id)
//
// Relations:
// - community: ManyToOne -> Community
// - user: ManyToOne -> User
