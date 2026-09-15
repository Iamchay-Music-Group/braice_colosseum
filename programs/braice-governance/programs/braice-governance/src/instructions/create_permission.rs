// Create permission instruction
// Creates PermissionState from approved governance decision
//
// Accounts:
//   - permission_state (PDA, writable)
//   - community_state (PDA)
//   - requester (signer)
//   - system_program
//
// Args:
//   - permission_id: [u8; 32]
//   - dataset_hash: [u8; 32]
//   - purpose_hash: [u8; 32]
//   - expires_at: i64
//   - policy_hash: [u8; 32]
