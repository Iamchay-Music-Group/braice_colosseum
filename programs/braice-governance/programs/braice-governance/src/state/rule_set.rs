use anchor_lang::prelude::*;
use crate::constants::{space, RuleMode};

/// One immutable version of a community's governance rules.
///
/// ROLE: this is where the rules themselves live. `CommunityState` holds a
/// community's identity and authority; a `RuleSet` holds the policy that
/// community governs by, and the chain of them is the history.
///
/// WHY A NEW ACCOUNT PER VERSION, RATHER THAN ONE MUTABLE ACCOUNT
///
/// A single mutable ruleset would be simpler and would destroy the property the
/// whole design rests on. If the live rules lived in one account that anyone
/// with the authority key could rewrite, then "the rules at the time of this
/// decision" would not be a checkable fact, and an off-chain edit would be
/// undetectable. Instead each version is created with `init` and never written
/// again, and `previous_version` links each to the one it replaced. The history
/// is then a walk backwards from the live version, and every link is verified by
/// `activate_ruleset` when it is written.
///
/// WHAT IS STORED: only the enforceable parameters, plus a hash of the full
/// ruleset. The creator's original text - which is prose, is mutable off-chain,
/// and can be arbitrarily long - stays off-chain and is committed to by
/// `rules_hash`. An auditor recomputes `sha256(canonical_json)` from the
/// off-chain record and compares. Reading the rules therefore needs no chain
/// read at all, while proving *which version was in force* does.
#[account]
#[derive(InitSpace)]
pub struct RuleSet {
    /// Owning community, shared with the off-chain record.
    pub community_id: [u8; 32],
    /// Monotonic version number. Version 1 is genesis; every later version must
    /// be exactly one more than its predecessor.
    pub version: u32,
    /// Which authority structure this version was written under.
    ///
    /// Copied onto the version rather than read from `ActiveRules`, because a
    /// rule that only makes sense in the mode it was written under has to say
    /// so itself. A ruleset that required threshold approval but was activated
    /// under creator control would be an unreproducible rule, and a verifier
    /// reading the version in isolation could not tell.
    pub mode: RuleMode,
    /// Approval threshold in basis points (6000 = 60%).
    ///
    /// Basis points, not a percentage as a float or an integer: `threshold_bps`
    /// is exactly representable in `u16`, so "the rules say 60%" has one
    /// encoding and cannot drift between what the creator typed and what the
    /// chain stores.
    pub threshold_bps: u16,
    /// Share of members who must vote at all, in basis points. Distinct from
    /// `threshold_bps`: a threshold of 80% of members who voted is a different
    /// rule from 80% of all members, and conflating them is how a "we got a
    /// quorum" claim quietly becomes "two people decided".
    pub quorum_bps: u16,
    /// Active member count at which the creator's rules require handover to
    /// shared governance. Zero means the creator never scheduled a handover.
    pub min_active_members: u32,
    /// SHA-256 of the canonical ruleset JSON. Commits to the parts that are not
    /// stored here, including the creator's original wording.
    pub rules_hash: [u8; 32],
    /// The version this one replaces, or 0 for genesis.
    ///
    /// This is the integrity link. `activate_ruleset` requires it to equal the
    /// currently-active version, which makes the history a chain: a version
    /// cannot be skipped, forked, or back-dated, because a fork would have to
    /// name a predecessor that was not live at the time.
    pub previous_version: u32,
    /// Unix timestamp the version was created. A version can be created and
    /// never activated, so this is not when it took effect.
    pub created_at: i64,
    /// Unix timestamp it became the version in force, or 0 if it never was.
    pub activated_at: i64,
    /// Canonical PDA bump.
    pub bump: u8,
}

impl RuleSet {
    /// Space required for this account, including the discriminator.
    pub const LEN: usize = space::RULESET;

    /// Whether the creator scheduled a handover at all.
    pub fn schedules_handover(&self) -> bool {
        self.min_active_members > 0
    }
}

/// The single account naming which ruleset version is in force.
///
/// ROLE: this is the account that makes "no human can change the rules except
/// through governance" a property of the chain rather than a convention.
///
/// `RuleSet` is append-only and `ActiveRules` has exactly one writer
/// (`activate_ruleset`), which requires the proposer to be authorised by the
/// mode currently recorded here. So there is no path to a different live ruleset
/// that does not leave a version account and an event behind.
///
/// It also carries the two pieces of state that must not be re-derivable
/// off-chain: `active_member_count`, which is the handover trigger, and
/// `handed_over_at`, which is the receipt that the transition happened. Both are
/// counted here by authority-signed writes so that a community cannot be
/// prevented from handing over by an off-chain member count that stays at one.
#[account]
#[derive(InitSpace)]
pub struct ActiveRules {
    /// Owning community.
    pub community_id: [u8; 32],
    /// The `RuleSet.version` currently in force.
    pub version: u32,
    /// Authority structure currently in force.
    pub mode: RuleMode,
    /// Active member count as last reported on-chain.
    pub active_member_count: u32,
    /// Unix timestamp the current version was activated.
    pub activated_at: i64,
    /// Unix timestamp governance moved from creator to shared, or 0 if it has
    /// not. Non-zero is the permanent record that handover occurred.
    pub handed_over_at: i64,
    /// Canonical PDA bump.
    pub bump: u8,
}

impl ActiveRules {
    /// Space required for this account, including the discriminator.
    pub const LEN: usize = space::ACTIVE_RULES;

    /// Whether the creator-to-shared handover has already happened.
    ///
    /// Driven by the receipt rather than by `mode`, so "has it happened" and
    /// "what is it now" cannot disagree if a future change adds a third mode.
    pub fn has_handed_over(&self) -> bool {
        self.handed_over_at > 0
    }

    /// Whether `member_count` satisfies the handover condition of `rules`.
    pub fn handover_satisfied_by(&self, rules: &RuleSet, member_count: u32) -> bool {
        rules.schedules_handover() && member_count >= rules.min_active_members
    }
}

/// A community's first ruleset was created.
#[event]
pub struct RuleSetInitialized {
    pub community_id: [u8; 32],
    pub version: u32,
    pub mode: RuleMode,
    pub rules_hash: [u8; 32],
    pub created_at: i64,
}

/// A new ruleset version was proposed.
///
/// Separate from activation on purpose: a proposal can be made under creator
/// control and activated after handover, or activated by a different set of
/// signers. One event for both would erase who did what.
#[event]
pub struct RuleSetProposed {
    pub community_id: [u8; 32],
    pub version: u32,
    pub mode: RuleMode,
    pub rules_hash: [u8; 32],
    pub proposed_at: i64,
}

/// A ruleset version became the version in force.
#[event]
pub struct RuleSetActivated {
    pub community_id: [u8; 32],
    pub version: u32,
    pub previous_version: u32,
    pub activated_at: i64,
}

/// Governance moved from creator control to shared governance.
#[event]
pub struct GovernanceHandedOver {
    pub community_id: [u8; 32],
    pub active_member_count: u32,
    pub min_active_members: u32,
    pub handed_over_at: i64,
}

/// A community reported a change in active membership.
#[event]
pub struct MembershipCountChanged {
    pub community_id: [u8; 32],
    pub previous_count: u32,
    pub active_member_count: u32,
}
