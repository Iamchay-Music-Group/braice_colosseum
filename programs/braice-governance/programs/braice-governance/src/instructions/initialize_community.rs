// Initialize community instruction
// Creates CommunityState on-chain
//
// Accounts:
//   - community_state (PDA, writable)
//   - operator (signer)
//   - system_program
//
// Args:
//   - community_id: [u8; 32]
//   - governance_rule_hash: [u8; 32]
