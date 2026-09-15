// Permission entity
// PostgreSQL table: permissions
// Columns:
// - id: UUID primary key
// - access_request_id: UUID not null FK -> access_requests(id)
// - principal_id: UUID not null FK -> users(id) (who is authorized)
// - resource_id: UUID not null FK -> community_datasets(id) (what data)
// - purpose: TEXT not null (why - must match request purpose)
// - operation: TEXT not null (how - READ, ANALYZE)
// - conditions: JSONB not null
//   {
//     "aggregationLevel": "COMMUNITY",
//     "allowIndividualData": false
//   }
// - issued_at: TIMESTAMPTZ not null
// - expires_at: TIMESTAMPTZ not null
// - revoked_at: TIMESTAMPTZ nullable
// - status: TEXT not null (PENDING, ACTIVE, EXPIRED, REVOKED)
// - policy_hash: TEXT (SHA-256 of permission JSON for blockchain)
// - blockchain_reference: TEXT (Solana transaction signature)
//
// A permission answers:
// - WHO? (principal)
// - WHAT? (resource)
// - WHY? (purpose)
// - HOW? (operation)
// - FOR HOW LONG? (expires_at)
// - UNDER WHAT CONDITIONS? (conditions)
//
// Relations:
// - accessRequest: ManyToOne -> AccessRequest
// - principal: ManyToOne -> User
// - resource: ManyToOne -> CommunityDataset
