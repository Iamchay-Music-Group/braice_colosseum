use anchor_lang::prelude::*;
use crate::constants::{seeds, MAX_THRESHOLD_BPS};
use crate::errors::GovernanceError;
use crate::state::{ActiveRules, CommunityState, RuleSet, RuleSetActivated};
use crate::validation;

#[derive(Accounts)]
#[instruction(version: u32)]
pub struct ActivateRuleSet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The community whose rules are changing.
    pub community: Account<'info, CommunityState>,

    /// The community's governance key. Always required; never sufficient on its
    /// own once governance is shared.
    pub authority: Signer<'info>,

    /// The version being activated.
    #[account(
        mut,
        seeds = [
            seeds::RULESET,
            community.community_id.as_ref(),
            &version.to_be_bytes(),
        ],
        bump = ruleset.bump,
    )]
    pub ruleset: Account<'info, RuleSet>,

    /// The pointer to the live ruleset. The only account this instruction writes,
    /// which is what makes the live ruleset unforgeable.
    #[account(
        mut,
        seeds = [seeds::ACTIVE_RULES, community.community_id.as_ref()],
        bump = active_rules.bump,
    )]
    pub active_rules: Account<'info, ActiveRules>,

    pub system_program: Program<'info, System>,
}

/// Make a proposed ruleset version the one in force.
///
/// THIS IS THE ONLY WRITER OF `ActiveRules`, and that single fact is the whole
/// "no human can change the rules except through governance" guarantee. There is
/// no instruction that edits a live ruleset in place, so any change to the rules
/// leaves a new `RuleSet` account and a `RuleSetActivated` event behind, and
/// `previous_version` proves it descends from the version it replaced.
///
/// WHO MAY ACTIVATE, BY MODE
///
/// * `CreatorControl` - the community authority alone. That is the creator's
///   right while governance is theirs, and it is bounded: the moment
///   `min_active_members` is reached, `handover_to_shared_governance` moves the
///   mode with nobody's permission, so the creator cannot decline to hand over.
/// * `SharedGovernance` - the authority plus at least `threshold_bps` of
///   `active_member_count` *distinct signers*, appended as remaining accounts.
///   The threshold becomes an absolute count against the on-chain
///   `active_member_count`, so the bar is a number the community can see rather
///   than a percentage of a denominator somebody else controls.
///
/// WHAT A SIGNER IS HERE, PRECISELY
///
/// Each remaining account must be marked as a signer, which means Solana's
/// runtime verified its signature over this transaction before this instruction
/// ran. The count is therefore over proven signatures rather than claimed keys.
/// But the program cannot tell a member's key from any other key, because there
/// is no on-chain membership list to check against: the signer set is whatever
/// keyring the community adopted off-chain, and this instruction enforces the
/// *number* of them, not their *identity*.
///
/// That limitation is stated rather than papered over. "60% of the membership
/// approved" is not what this checks. A member registry is the fix, and it is a
/// deliberate omission from this MVP rather than an oversight - it means a new
/// account type and a PDA per member, which is the storage the on-chain tally
/// was otherwise built to avoid.
///
/// The remaining accounts are plain signers rather than one account per voter:
/// a signature is its own proof, so a PDA per member per version would cost rent
/// to store nothing extra.
pub fn activate_ruleset(ctx: Context<ActivateRuleSet>, version: u32) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.community.authority,
        GovernanceError::NotCommunityAuthority
    );

    // The version must belong to this community. `ruleset` is loaded by PDA from
    // `community.community_id`, so another community's version cannot be passed
    // here at all; checking the stored id too means a mismatch is a named error
    // rather than a silent success on the wrong account.
    require!(
        ctx.accounts.ruleset.community_id == ctx.accounts.community.community_id,
        GovernanceError::RulesetPredecessorMismatch
    );

    // A version can be activated exactly once. `activated_at` is written only
    // here, so a second activation is refused instead of re-announcing an event
    // that would read as fresh governance.
    require!(
        ctx.accounts.ruleset.activated_at == 0,
        GovernanceError::RulesetAlreadyActivated
    );

    // The version must extend the live history by exactly one. This is the
    // integrity link: a version whose `previous_version` is not the version
    // currently in force is either a fork or a skipped generation, and neither
    // may be activated.
    validation::rules::validate_version_chain(
        version,
        ctx.accounts.ruleset.previous_version,
        Some(ctx.accounts.active_rules.version),
    )?;

    // The proposal's own thresholds are re-validated rather than trusted from
    // creation. Versions are immutable so these cannot have changed, but the
    // value enforced at activation is the one this instruction reads, and a bad
    // value sitting in an immutable account could never be corrected.
    validation::rules::validate_thresholds(
        ctx.accounts.ruleset.threshold_bps,
        ctx.accounts.ruleset.quorum_bps,
    )?;

    // Mode-gated authorisation.
    let active_rules = &ctx.accounts.active_rules;
    if active_rules.mode.is_shared() {
        let required = required_approvals(
            active_rules.active_member_count,
            ctx.accounts.ruleset.threshold_bps,
        );
        let count = count_distinct_approvers(
            ctx.accounts.authority.key(),
            ctx.remaining_accounts,
        )?;
        require!(
            count >= required,
            GovernanceError::InsufficientApprovals
        );
    }

    let now = clock::Clock::get()?.unix_timestamp;
    let community_id = ctx.accounts.community.community_id;
    let previous_version = active_rules.version;

    ctx.accounts.ruleset.activated_at = now;
    ctx.accounts.active_rules.version = version;
    ctx.accounts.active_rules.activated_at = now;

    emit!(RuleSetActivated {
        community_id,
        version,
        previous_version,
        activated_at: now,
    });

    Ok(())
}

/// Count distinct approving signers, including the community authority.
///
/// Two failure modes are handled, and both matter:
///
/// * **Duplicates.** The same key repeated in `remaining_accounts` is one
///   approver. Counting it twice would let one signer clear any threshold, which
///   is the whole difference between shared governance and a formality.
/// * **Non-signers.** An account that did not sign is rejected rather than
///   skipped. Skipping would be safe for the tally - it simply would not count -
///   but it would let a caller assemble a transaction that looks like it carries
///   approvals and silently does not. Failing loudly keeps that bug on the
///   caller's side of the wire, where it can be debugged.
///
/// The authority is seeded into the set, so a caller's only job is to append the
/// other signers, and the authority cannot be double-counted by repeating it.
pub fn count_distinct_approvers<'info>(
    authority: Pubkey,
    remaining: &[AccountInfo<'info>],
) -> Result<u32> {
    let mut approvers: Vec<Pubkey> = vec![authority];
    for account in remaining {
        require!(account.is_signer, GovernanceError::InsufficientApprovals);
        let key = account.key();
        if approvers.contains(&key) {
            continue;
        }
        approvers.push(key);
    }
    Ok(approvers.len() as u32)
}

/// Approvals needed to satisfy a basis-point threshold, rounded up.
///
/// `ceil`, matching `GovernanceService.computeThreshold` off-chain. If the two
/// implementations disagreed about the boundary, a decision the API accepted
/// could be one the chain refuses to ratify - the worst possible split, because
/// the product would report success while the anchor contradicted it.
pub fn required_approvals(member_count: u32, threshold_bps: u16) -> u32 {
    let product = member_count as u64 * threshold_bps as u64;
    product.div_ceil(MAX_THRESHOLD_BPS as u64) as u32
}
