use anchor_lang::prelude::*;
use crate::constants::seeds;
use crate::errors::GovernanceError;
use crate::state::{ActiveRules, CommunityState, RuleSet, RuleSetProposed};
use crate::validation;

#[derive(Accounts)]
#[instruction(
    version: u32,
    rules_hash: [u8; 32],
    threshold_bps: u16,
    quorum_bps: u16,
    min_active_members: u32
)]
pub struct ProposeRuleSet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The community the proposed rules would govern.
    pub community: Account<'info, CommunityState>,

    /// The community's governance key.
    ///
    /// Under `CreatorControl` this is the whole authorisation. Under
    /// `SharedGovernance` it is still required - the creator never stops being
    /// part of shared governance - but it is no longer sufficient on its own;
    /// `activate_ruleset` additionally requires threshold distinct signers.
    pub authority: Signer<'info>,

    /// The proposed version. `init` only: a version number can be proposed
    /// once, so a proposal that was rejected cannot be quietly re-proposed with
    /// different terms under the same number.
    ///
    /// Declared before `active_rules` so that every ruleset instruction lists the
    /// version before the pointer. Anchor matches accounts positionally, and a
    /// client that gets this pair backwards runs and fails with an opaque
    /// `ConstraintSeeds` - the exact bug this ordering prevents.
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

    /// Current governance state, read to learn which mode the proposal is made
    /// under. Never written here.
    pub active_rules: Account<'info, ActiveRules>,

    pub system_program: Program<'info, System>,
}

/// Create the next ruleset version without activating it.
///
/// Splitting proposal from activation is what makes the two-authority phases
/// work. Under `SharedGovernance` the creator's key alone is no longer enough to
/// change the rules, so a proposal records *what* the community is considering
/// and a separate activation records *that enough members agreed*. Collapsing
/// them would force the proposal and the vote into one transaction, which is
/// either the creator's decision alone or a single member's.
///
/// Note what this instruction does NOT do: it does not check whether the
/// proposer is entitled to propose. It checks who the community's authority is,
/// and leaves the mode-dependent entitlement to `activate_ruleset`. That split
/// is deliberate - proposal is a right, activation is the gate, and only the
/// gate protects the live ruleset.
pub fn propose_ruleset(
    ctx: Context<ProposeRuleSet>,
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

    // The predecessor is the version currently in force, read from the account
    // rather than computed as `version - 1`. Both expressions agree in the happy
    // path, but `version - 1` underflows for a caller-supplied `version` of 0,
    // and a BPF build is a release build where u32 overflow wraps silently
    // instead of panicking - the proposal would then record a predecessor of
    // u32::MAX. validate_version_chain rejects that version anyway; deriving the
    // value from account state means no caller input reaches the arithmetic.
    let previous_version = ctx.accounts.active_rules.version;
    validation::rules::validate_version_chain(
        version,
        previous_version,
        Some(previous_version),
    )?;

    let now = clock::Clock::get()?.unix_timestamp;
    let community_id = ctx.accounts.community.community_id;
    let mode = ctx.accounts.active_rules.mode;

    let ruleset = &mut ctx.accounts.ruleset;
    ruleset.community_id = community_id;
    ruleset.version = version;
    // The mode is inherited, not chosen. A proposal cannot declare itself to be
    // under shared governance to escape the creator's control, nor under creator
    // control to escape the members'.
    ruleset.mode = mode;
    ruleset.threshold_bps = threshold_bps;
    ruleset.quorum_bps = quorum_bps;
    ruleset.min_active_members = min_active_members;
    ruleset.rules_hash = rules_hash;
    ruleset.previous_version = previous_version;
    ruleset.created_at = now;
    // 0 until activated. This is what lets activation reject a version that was
    // already activated: the flag is the receipt.
    ruleset.activated_at = 0;
    ruleset.bump = ctx.bumps.ruleset;

    emit!(RuleSetProposed {
        community_id,
        version,
        mode,
        rules_hash,
        proposed_at: now,
    });

    Ok(())
}
