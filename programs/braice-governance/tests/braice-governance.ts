// Anchor tests for braice_governance program
//
// Test cases:
// - initialize_community: Creates community state
// - record_governance_decision: Records decision
// - create_permission: Creates permission from governance
// - revoke_permission: Revokes active permission
//
// Verify:
// - Correct PDA derivation
// - State mutations
// - Event emissions
// - Access control (only operator can revoke)
