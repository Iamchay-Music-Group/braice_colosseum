use anchor_lang::prelude::*;
use crate::constants::{seeds, RuleMode};
use crate::errors::GovernanceError;
use crate::state::{ActiveRules, CommunityState, RuleSet, RuleSetInitialized};
use crate::validation;

#[derive(Accounts)]
#[instruction(
    version: u32,
    rules_hash: [u8; 32],
    threshold_bps: u16,
    quorum_bps: u16,
    min_active_members: u32
)]
pub struct InitializeRuleSet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The community whose rules these are.
    pub community: Account<'info, CommunityState>,

    /// The community's governance key. Required, so rules can only be written
    /// by the key the community was bound to.
    pub authority: Signer<'info>,

    /// Version 1, the genesis ruleset.
    ///
    /// Declared before `active_rules` so that every ruleset instruction lists the
    /// version before the pointer. Anchor matches accounts positionally, and a
    /// client that gets this pair backwards compiles, runs, and fails with an
    /// opaque `ConstraintSeeds` - the exact bug this ordering prevents.
    #[account(
        init,
        payer = payer,
        space = RuleSet::LEN,
        seeds = [
            seeds::RULESET,
            community.community_id.as_ref(),
            &version.to_be_bytes(),
        ],
        bump,
    )]
    pub ruleset: Account<'info, RuleSet>,

    /// The pointer to the version in force. `init` only, so a community can
    /// never start again from a blank slate with a more permissive ruleset.
    #[account(
        init,
        payer = payer,
        space = ActiveRules::LEN,
        seeds = [seeds::ACTIVE_RULES, community.community_id.as_ref()],
        bump,
    )]
    pub active_rules: Account<'info, ActiveRules>,

    pub system_program: Program<'info, System>,
}

/// Record a community's first ruleset.
///
/// Genesis is always `CreatorControl`. A community cannot start life in shared
/// governance, because "shared" is only meaningful relative to a creator who set
/// the terms and a threshold they committed to reaching - and that commitment is
/// `min_active_members`. Starting in shared mode would leave a community whose
/// rules nobody authored, and the handover would have nothing to measure.
pub fn initialize_ruleset(
    ctx: Context<InitializeRuleSet>,
    version: u32,
    rules_hash: [u8; 32],
    threshold_bps: u16,
    quorum_bps: u16,
    min_active_members: u32,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.community.authority,
        GovernanceError::NotCommunityAuthority
    );

    validation::rules::validate_thresholds(threshold_bps, quorum_bps)?;
    validation::rules::validate_version_chain(version, 0, None)?;

    let now = clock::Clock::get()?.unix_timestamp;

    let community_id = ctx.accounts.community.community_id;

    let ruleset = &mut ctx.accounts.ruleset;
    ruleset.community_id = community_id;
    ruleset.version = version;
    ruleset.mode = RuleMode::CreatorControl;
    ruleset.threshold_bps = threshold_bps;
    ruleset.quorum_bps = quorum_bps;
    ruleset.min_active_members = min_active_members;
    // SHA-256 of the canonical ruleset JSON, supplied by the caller. The chain
    // stores parameters and this hash; the rule text itself stays off-chain,
    // which is what lets an auditor read the rules without an RPC call and still
    // prove which version was in force.
    ruleset.rules_hash = rules_hash;
    ruleset.previous_version = 0;
    ruleset.created_at = now;
    // Activated immediately: there is nothing to activate it from.
    ruleset.activated_at = now;
    ruleset.bump = ctx.bumps.ruleset;

    let active = &mut ctx.accounts.active_rules;
    active.community_id = community_id;
    active.version = version;
    active.mode = RuleMode::CreatorControl;
    // Seeded at 1, not 0: creating a community enrols its operator as an active
    // member off-chain, and a count of zero would mean a brand new community
    // could satisfy a handover threshold of 1 before a single person joined.
    active.active_member_count = 1;
    active.activated_at = now;
    active.handed_over_at = 0;
    active.bump = ctx.bumps.active_rules;

    emit!(RuleSetInitialized {
        community_id,
        version,
        mode: RuleMode::CreatorControl,
        rules_hash,
        created_at: now,
    });

    Ok(())
}
