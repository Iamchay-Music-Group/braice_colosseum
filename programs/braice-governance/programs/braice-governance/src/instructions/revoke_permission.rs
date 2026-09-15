// Revoke permission instruction
// Changes status from ACTIVE to REVOKED
//
// Accounts:
//   - permission_state (PDA, writable)
//   - operator (signer, must be community creator)
//   - system_program
//
// Args:
//   - (none - revocation is binary)
//
// Emits event: PermissionRevoked
