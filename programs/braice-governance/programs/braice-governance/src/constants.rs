use anchor_lang::prelude::*;

/// Account discriminators.
///
/// These prefix every PDA seed. They are part of the program's public
/// interface: changing one orphans every account already created under the old
/// seed, so they are fixed forever once deployed.
pub mod seeds {
    /// A community's governance root account.
    pub const COMMUNITY: &[u8] = b"community";
    /// One permission issued by a community.
    pub const PERMISSION: &[u8] = b"permission";
    /// One recorded governance decision.
    pub const EVENT: &[u8] = b"event";
}

/// Account sizes, in bytes, including the 8-byte Anchor discriminator.
///
/// Each constant is `8 + <serialized payload>` and must match the struct
/// definitions in `state/`. Anchor will not detect a mismatch for you at
/// runtime beyond the space it allocates, so these are asserted in unit tests.
pub mod space {
    /// CommunityState: 8 + 32 (community_id) + 32 (authority) + 32 (name_hash)
    ///   + 8 (permission_count) + 8 (decision_count) + 8 (created_at) + 1 (bump)
    pub const COMMUNITY: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1;

    /// PermissionState: 8 + 32 (permission_id) + 32 (community_id) + 32 (grantee)
    ///   + 32 (purpose_hash) + 32 (resource_hash) + 32 (policy_hash)
    ///   + 8 (issued_at) + 8 (expires_at) + 8 (revoked_at) + 1 (status) + 1 (bump)
    pub const PERMISSION: usize = 8 + 32 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1;

    /// GovernanceEvent: 8 + 32 (event_id) + 32 (community_id) + 32 (decision_hash)
    ///   + 8 (decided_at) + 1 (outcome) + 1 (bump)
    pub const EVENT: usize = 8 + 32 + 32 + 32 + 8 + 1 + 1;
}

/// Lifecycle status of an anchored permission.
///
/// The chain records what a community *decided*. It does not evaluate access:
/// an `Active` permission on-chain is a claim that governance approved it, not
/// an authorisation to read data. The off-chain permission engine is what
/// actually decides, and it is strictly fail-closed.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
#[borsh(use_discriminant = true)]
pub enum PermissionStatus {
    /// Governance approved this permission and it has not been withdrawn.
    Active = 0,
    /// The community authority withdrew this permission.
    Revoked = 1,
}

impl PermissionStatus {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(PermissionStatus::Active),
            1 => Some(PermissionStatus::Revoked),
            _ => None,
        }
    }
}

/// `InitSpace` derives account sizes from each field's `Space` impl, so the
/// enums used inside accounts must declare theirs. Both serialise to a single
/// byte because `use_discriminant = true` writes the numeric discriminant.
impl Space for PermissionStatus {
    const INIT_SPACE: usize = 1;
}

/// Outcome of a recorded governance decision.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
#[borsh(use_discriminant = true)]
pub enum DecisionOutcome {
    Approved = 0,
    Rejected = 1,
}

impl DecisionOutcome {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(DecisionOutcome::Approved),
            1 => Some(DecisionOutcome::Rejected),
            _ => None,
        }
    }
}

impl Space for DecisionOutcome {
    const INIT_SPACE: usize = 1;
}
