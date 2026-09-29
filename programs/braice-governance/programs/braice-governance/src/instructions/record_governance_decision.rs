use anchor_lang::prelude::*;
use crate::constants::{seeds, DecisionOutcome};
use crate::errors::GovernanceError;
use crate::state::{CommunityState, GovernanceDecisionRecorded, GovernanceEvent};

#[derive(Accounts)]
#[instruction(event_id: [u8; 32], decision_hash: [u8; 32], outcome: DecisionOutcome)]
pub struct RecordGovernanceDecision<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The community that reached the decision.
    pub community: Account<'info, CommunityState>,

    /// The community's governance key.
    pub authority: Signer<'info>,

    /// One account per decision id. Re-recording the same id fails at the `init`
    /// constraint, so history cannot be rewritten.
    #[account(
        init,
        payer = payer,
        space = GovernanceEvent::LEN,
        seeds = [seeds::EVENT, community.community_id.as_ref(), event_id.as_ref()],
        bump,
    )]
    pub event: Account<'info, GovernanceEvent>,

    pub system_program: Program<'info, System>,
}

/// Anchor that a community reached a governance decision.
///
/// The decision's *contents* stay off-chain; the chain stores a hash of them.
/// That is enough to prove the off-chain decision record has not been altered
/// since it was approved, without making mutable proposal text immutable or
/// paying rent for it.
#[allow(clippy::too_many_arguments)]
pub fn record_governance_decision(
    ctx: Context<RecordGovernanceDecision>,
    event_id: [u8; 32],
    decision_hash: [u8; 32],
    outcome: DecisionOutcome,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.community.authority,
        GovernanceError::NotCommunityAuthority
    );

    let now = clock::Clock::get()?.unix_timestamp;

    let event = &mut ctx.accounts.event;
    event.event_id = event_id;
    event.community_id = ctx.accounts.community.community_id;
    event.decision_hash = decision_hash;
    event.decided_at = now;
    event.outcome = outcome;
    event.bump = ctx.bumps.event;

    ctx.accounts.community.decision_count = ctx
        .accounts
        .community
        .decision_count
        .checked_add(1)
        .ok_or(GovernanceError::InvalidTimestamp)?;

    emit!(GovernanceDecisionRecorded {
        event_id,
        community_id: ctx.accounts.community.community_id,
        decision_hash,
        outcome,
        decided_at: now,
    });

    Ok(())
}
