// AuditEvent entity
// PostgreSQL table: audit_events
// Columns:
// - id: UUID primary key
// - community_id: UUID FK -> communities(id)
// - actor_id: UUID FK -> users(id)
// - event_type: TEXT not null
//   (ACCESS_REQUESTED, GOVERNANCE_APPROVED, PERMISSION_CREATED,
//    AI_ACCESS_GRANTED, AI_ANALYSIS_COMPLETED, PERMISSION_REVOKED, ACCESS_DENIED)
// - resource_id: UUID (related resource)
// - permission_id: UUID (related permission)
// - metadata: JSONB (additional context)
// - blockchain_tx: TEXT (Solana transaction signature)
// - created_at: TIMESTAMPTZ default NOW()
//
// Relations:
// - community: ManyToOne -> Community
// - actor: ManyToOne -> User
