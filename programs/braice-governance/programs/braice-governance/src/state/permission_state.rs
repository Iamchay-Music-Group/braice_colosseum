// PermissionState account
//
// pub struct PermissionState {
//   pub permission_id: [u8; 32],     // Permission identifier
//   pub community_id: [u8; 32],      // Community identifier
//   pub requester: Pubkey,           // Brand wallet
//   pub dataset_hash: [u8; 32],      // Dataset identifier hash
//   pub purpose_hash: [u8; 32],      // Purpose hash
//   pub issued_at: i64,              // Issue timestamp
//   pub expires_at: i64,             // Expiration timestamp
//   pub status: u8,                  // 0=ACTIVE, 1=REVOKED, 2=EXPIRED
//   pub policy_hash: [u8; 32],       // SHA-256 of permission JSON
//   pub bump: u8,                    // PDA bump
// }
//
// Status:
//   0 = ACTIVE
//   1 = REVOKED
//   2 = EXPIRED
