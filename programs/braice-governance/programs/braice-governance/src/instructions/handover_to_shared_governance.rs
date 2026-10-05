use anchor_lang::prelude::*;
use crate::constants::seeds;
use crate::errors::GovernanceError;
use crate::state::{ActiveRules, CommunityState, GovernanceHandedOver, RuleSet};

#[derive(Accounts)]
#[instruction(version: u32)]
pub struct HandoverToSharedGovernance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The community handing over.
    pub community: Account<'info, CommunityState>,

    /// The community's governance key. It signs the handover and gains nothing
    /// by refusing it: the condition is the creator's own, and once satisfied
    /// anyone may call this.
    pub authority: Signer<'info>,

    /// The ruleset whose `min_active_members` is the trigger. Read only.
    #[account(
        seeds = [
            seeds::RULESET,
            community.community_id.as_ref(),
            &version.to_be_bytes(),
        ],
        bump = ruleset.bump,
    )]
    pub ruleset: Account<'info, RuleSet>,

    /// The live ruleset pointer, whose mode flips.
    #[account(
        mut,
        seeds = [seeds::ACTIVE_RULES, community.community_id.as_ref()],
        bump = active_rules.bump,
    )]
    pub active_rules: Account<'info, ActiveRules>,
}

/// Move a community from creator control to shared governance.
///
/// PERMISSIONLESS BY DESIGN, GATED BY THE CREATOR'S OWN RULE
///
/// The creator writes `min_active_members` into their genesis ruleset. Once the
/// on-chain count reaches it, this instruction succeeds - signed by the creator,
/// but not gated on their consent. That is the point: the creator committed to a
/// point at which control would be shared, and the commitment has to be
/// enforceable against them. If handover required the creator's agreement it
/// would be a request, and a creator who never wanted to share would simply
/// never agree.
///
/// The creator still signs, for a mundane reason: this instruction is also how
/// they would notice it happened. Requiring the signature without requiring the
/// *intent* is what makes the trigger enforceable while keeping the transition
/// visible to the party it affects.
///
/// IRREVERSIBLE, ONCE
///
/// `handed_over_at` is set and never cleared, and a second call is rejected. This
/// is not a missing feature. Re-centralising by the same mechanism that
/// decentralised is the capture scenario the handover exists to prevent: a
/// community could be walked back to single-operator control by a creator who
/// lost a vote. Getting there requires a new community.
pub fn handover_to_shared_governance(
    ctx: Context<HandoverToSharedGovernance>,
    version: u32,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.community.authority,
        GovernanceError::NotCommunityAuthority
    );

    require!(
        ctx.accounts.ruleset.community_id == ctx.accounts.community.community_id,
        GovernanceError::RulesetPredecessorMismatch
    );

    let active_rules = &ctx.accounts.active_rules;

    // Already shared. Rejected rather than succeeding as a no-op, so a second
    // call cannot be read as a fresh governance action.
    require!(
        !active_rules.has_handed_over(),
        GovernanceError::AlreadyHandedOver
    );

    // The trigger is measured against the version currently in force. Passing an
    // older version's lower threshold would let a community pick whichever
    // historical ruleset made handover easiest, which is the creator choosing
    // the terms of their own exit.
    require!(
        version == active_rules.version,
        GovernanceError::RulesetPredecessorMismatch
    );

    require!(
        active_rules.handover_satisfied_by(&ctx.accounts.ruleset, active_rules.active_member_count),
        GovernanceError::HandoverThresholdNotMet
    );

    let now = clock::Clock::get()?.unix_timestamp;

    let active = &mut ctx.accounts.active_rules;
    active.mode = crate::constants::RuleMode::SharedGovernance;
    active.handed_over_at = now;

    emit!(GovernanceHandedOver {
        community_id: ctx.accounts.community.community_id,
        active_member_count: active.active_member_count,
        min_active_members: ctx.accounts.ruleset.min_active_members,
        handed_over_at: now,
    });

    Ok(())
}
