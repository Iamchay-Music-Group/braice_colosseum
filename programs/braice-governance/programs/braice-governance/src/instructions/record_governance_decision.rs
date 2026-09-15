// Record governance decision instruction
// Records governance decision hash on-chain
//
// Accounts:
//   - community_state (PDA)
//   - governance_event (PDA, writable)
//   - operator (signer)
//   - system_program
//
// Args:
//   - decision_hash: [u8; 32]
//   - timestamp: i64
