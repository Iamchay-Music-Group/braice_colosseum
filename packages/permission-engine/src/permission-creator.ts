// Permission creator
// Creates permission from governance decision
//
// create(accessRequest, governanceDecision): Permission
//   - Maps access request to permission fields
//   - Sets issuedAt and expiresAt
//   - Sets status to ACTIVE
//   - Generates policy hash (SHA-256)
