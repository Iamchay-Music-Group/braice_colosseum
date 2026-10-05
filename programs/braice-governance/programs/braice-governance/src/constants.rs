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
    /// One version of a community's governance ruleset.
    pub const RULESET: &[u8] = b"ruleset";
    /// The single pointer to whichever ruleset version is in force.
    pub const ACTIVE_RULES: &[u8] = b"active_rules";
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

    /// RuleSet: 8 + 32 (community_id) + 4 (version) + 1 (mode)
    ///   + 2 (threshold_bps) + 2 (quorum_bps) + 4 (min_active_members)
    ///   + 32 (rules_hash) + 4 (previous_version)
    ///   + 8 (created_at) + 8 (activated_at) + 1 (bump)
    pub const RULESET: usize = 8 + 32 + 4 + 1 + 2 + 2 + 4 + 32 + 4 + 8 + 8 + 1;

    /// ActiveRules: 8 + 32 (community_id) + 4 (version) + 1 (mode)
    ///   + 4 (active_member_count) + 8 (activated_at) + 8 (handed_over_at) + 1 (bump)
    pub const ACTIVE_RULES: usize = 8 + 32 + 4 + 1 + 4 + 8 + 8 + 1;
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

/// Who holds authority to change a community's governance rules.
///
/// This is the on-chain half of the creator-to-shared-governance handover, and
/// it is deliberately binary and one-way. `CreatorControl` is the state a
/// community starts in and can only leave; `SharedGovernance` is terminal. A
/// third "back to creator" mode would mean a community could re-centralise by
/// the same mechanism that decentralised it, which is the capture scenario the
/// whole handover exists to prevent.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
#[borsh(use_discriminant = true)]
pub enum RuleMode {
    /// The creator's key alone may propose and activate rulesets.
    CreatorControl = 0,
    /// Creator and members govern together. Reaching this requires the
    /// creator's own handover trigger to have been met.
    SharedGovernance = 1,
}

impl RuleMode {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(RuleMode::CreatorControl),
            1 => Some(RuleMode::SharedGovernance),
            _ => None,
        }
    }

    /// Whether this mode has already been handed over.
    ///
    /// Named rather than compared to `SharedGovernance` at call sites so the
    /// irreversibility is stated once: every check that needs "is the handover
    /// done" reads this instead of re-deriving it.
    pub fn is_shared(&self) -> bool {
        matches!(self, RuleMode::SharedGovernance)
    }
}

impl Space for RuleMode {
    const INIT_SPACE: usize = 1;
}

/// Largest threshold expressible in basis points, i.e. 100%.
///
/// A `u16` holds 65535, so an unchecked `threshold_bps` could express 655.35%.
/// Callers validate against this ceiling, which keeps a nonsensical value from
/// being written into an immutable account where it could never be corrected.
pub const MAX_THRESHOLD_BPS: u16 = 10_000;
