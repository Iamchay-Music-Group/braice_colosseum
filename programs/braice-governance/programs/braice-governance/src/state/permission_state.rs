use anchor_lang::prelude::*;
use crate::constants::{space, PermissionStatus};

/// One permission issued by a community, anchored on-chain.
///
/// This is a *receipt of governance*, not an access token. Holding this account
/// grants nothing by itself: the off-chain permission engine re-derives the
/// decision from Postgres and the request context, fail-closed. The value here
/// is that `policy_hash` is immutable, so a later off-chain edit that changes
/// what a permission actually says can be detected by recomputing the hash and
/// comparing it to this account.
#[account]
#[derive(InitSpace)]
pub struct PermissionState {
    /// Stable identifier for the permission, shared with the off-chain record.
    pub permission_id: [u8; 32],
    /// Owning community.
    pub community_id: [u8; 32],
    /// Wallet the permission was issued to.
    pub grantee: Pubkey,
    /// Hash of the granted purpose string.
    pub purpose_hash: [u8; 32],
    /// Hash of the protected resource identifier.
    pub resource_hash: [u8; 32],
    /// SHA-256 of the canonical off-chain permission JSON. The core integrity
    /// field: it commits to every condition of the grant in one value.
    pub policy_hash: [u8; 32],
    /// Unix timestamp the permission was anchored.
    pub issued_at: i64,
    /// Unix timestamp after which the permission is no longer in force.
    pub expires_at: i64,
    /// Unix timestamp of revocation, or 0 if never revoked.
    pub revoked_at: i64,
    /// Lifecycle status. `Revoked` is terminal and irreversible on-chain.
    pub status: PermissionStatus,
    /// Canonical PDA bump.
    pub bump: u8,
}

impl PermissionState {
    /// Space required for this account, including the discriminator.
    pub const LEN: usize = space::PERMISSION;

    /// Whether this permission is in force at `unix_ts`.
    ///
    /// Expiry is evaluated at read time rather than written back, so a
    /// permission expires on schedule without needing a keeper transaction to
    /// flip its status. `revoked_at` is checked independently because a
    /// revocation after the expiry instant must still be reported as revoked.
    pub fn is_effective_at(&self, unix_ts: i64) -> bool {
        self.status == PermissionStatus::Active && unix_ts < self.expires_at
    }
}

/// A permission was anchored by community governance.
#[event]
pub struct PermissionCreated {
    pub permission_id: [u8; 32],
    pub community_id: [u8; 32],
    pub grantee: Pubkey,
    pub policy_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
}

/// A community authority withdrew a permission.
#[event]
pub struct PermissionRevoked {
    pub permission_id: [u8; 32],
    pub community_id: [u8; 32],
    pub policy_hash: [u8; 32],
    pub revoked_at: i64,
}
