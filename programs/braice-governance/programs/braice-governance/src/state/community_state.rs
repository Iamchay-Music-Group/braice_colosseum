use anchor_lang::prelude::*;
use crate::constants::space;

/// Governance root for a single community.
///
/// Created once by `initialize_community`, which binds the community to an
/// authority key. Every later permission and decision must be signed by that
/// same key, so the chain can prove *which* key attested to a community's
/// governance outcomes — not merely that some transaction happened.
///
/// Only hashes are stored. A community's name and description are not personal
/// data, but they are mutable off-chain state that has no business being
/// immutable on-chain, so the program stores a `name_hash` and lets the
/// off-chain record hold the text.
#[account]
#[derive(InitSpace)]
pub struct CommunityState {
    /// Stable identifier for the community, shared with the off-chain record.
    pub community_id: [u8; 32],
    /// The governance key. Required to sign every write for this community.
    pub authority: Pubkey,
    /// Hash of the community's display name at initialization time.
    pub name_hash: [u8; 32],
    /// Number of permissions ever created. Monotonic; never decremented, so
    /// the count is a faithful audit trail even as permissions are revoked.
    pub permission_count: u64,
    /// Number of governance decisions ever recorded. Monotonic.
    pub decision_count: u64,
    /// Unix timestamp of initialization.
    pub created_at: i64,
    /// Canonical PDA bump, stored so later instructions can re-sign the
    /// account without a `find_program_address` search.
    pub bump: u8,
}

impl CommunityState {
    /// Space required for this account, including the discriminator.
    pub const LEN: usize = space::COMMUNITY;
}

/// Anchor the community to an authority.
#[event]
pub struct CommunityInitialized {
    pub community_id: [u8; 32],
    pub authority: Pubkey,
    pub name_hash: [u8; 32],
    pub created_at: i64,
}
