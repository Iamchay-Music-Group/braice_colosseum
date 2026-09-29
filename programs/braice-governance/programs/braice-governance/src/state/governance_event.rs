use anchor_lang::prelude::*;
use crate::constants::{space, DecisionOutcome};

/// An immutable record that a governance decision was made.
///
/// One account per decision, keyed by the decision id, so re-recording the same
/// decision is rejected rather than silently overwriting history. Only the
/// decision's hash is stored, never its contents: the reasoning and the
/// proposal text stay off-chain and mutable, while the chain commits to
/// "a decision with this exact id and this exact hash was reached".
#[account]
#[derive(InitSpace)]
pub struct GovernanceEvent {
    /// Stable identifier for the decision, shared with the off-chain record.
    pub event_id: [u8; 32],
    /// Community that reached the decision.
    pub community_id: [u8; 32],
    /// Hash of the canonical decision payload.
    pub decision_hash: [u8; 32],
    /// Unix timestamp the decision was anchored.
    pub decided_at: i64,
    /// Whether the decision approved or rejected the proposal.
    pub outcome: DecisionOutcome,
    /// Canonical PDA bump.
    pub bump: u8,
}

impl GovernanceEvent {
    /// Space required for this account, including the discriminator.
    pub const LEN: usize = space::EVENT;
}

/// A governance decision was anchored.
#[event]
pub struct GovernanceDecisionRecorded {
    pub event_id: [u8; 32],
    pub community_id: [u8; 32],
    pub decision_hash: [u8; 32],
    pub outcome: DecisionOutcome,
    pub decided_at: i64,
}
