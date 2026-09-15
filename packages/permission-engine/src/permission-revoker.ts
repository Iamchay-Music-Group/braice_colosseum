// Permission revoker
// Revokes permissions
//
// revoke(permissionId): void
//   - Sets status to REVOKED
//   - Sets revokedAt timestamp
//   - Returns revoked permission
//
// NOTE: Revocation must happen server-side.
// Every subsequent authorization check sees status=REVOKED and rejects.
