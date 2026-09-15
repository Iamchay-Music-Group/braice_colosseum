// GovernanceDecision entity
// PostgreSQL table: governance_decisions
// Columns:
// - id: UUID primary key
// - access_request_id: UUID not null FK -> access_requests(id)
// - decision: TEXT not null (APPROVED, REJECTED)
// - approved_by: JSONB not null (list of approver IDs)
// - approval_count: INTEGER (number of approvals)
// - threshold: INTEGER (required approvals)
// - decided_at: TIMESTAMPTZ default NOW()
// - blockchain_tx: TEXT (Solana transaction signature)
//
// Relations:
// - accessRequest: ManyToOne -> AccessRequest
