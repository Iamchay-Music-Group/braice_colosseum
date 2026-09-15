// User entity
// PostgreSQL table: users
// Columns:
// - id: UUID primary key
// - wallet_address: TEXT unique (Solana wallet)
// - email: TEXT optional
// - display_name: TEXT not null
// - user_type: ENUM (CREATOR, MEMBER, BRAND, APPLICATION, ADMIN)
// - created_at: TIMESTAMPTZ default NOW()
//
// Relations:
// - memberships: OneToMany -> Membership
// - operatedCommunities: OneToMany -> Community
// - activities: OneToMany -> ActivityRecord
// - auditEvents: OneToMany -> AuditEvent
