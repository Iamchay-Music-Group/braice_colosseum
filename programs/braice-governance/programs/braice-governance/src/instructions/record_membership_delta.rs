use anchor_lang::prelude::*;
use crate::constants::seeds;
use crate::errors::GovernanceError;
use crate::state::{ActiveRules, CommunityState, MembershipCountChanged};
use crate::validation;

#[derive(Accounts)]
#[instruction(delta: i32)]
pub struct RecordMembershipDelta<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The community whose membership changed.
    pub community: Account<'info, CommunityState>,

    /// The community's governance key.
    pub authority: Signer<'info>,

    /// The live ruleset pointer, whose member count is updated.
    #[account(
        mut,
        seeds = [seeds::ACTIVE_RULES, community.community_id.as_ref()],
        bump = active_rules.bump,
    )]
    pub active_rules: Account<'info, ActiveRules>,
}

/// Report a change in active membership.
///
/// WHY THE COUNT IS ON-CHAIN AT ALL
///
/// The handover trigger is `min_active_members`, and if that count lived only in
/// Postgres then the party who benefits from *not* handing over - the creator -
/// would be the party who controls the number that triggers it. A creator could
/// simply never report their joins and the handover would never fire, making the
/// creator's own commitment to the community unenforceable.
///
/// Putting the count here means it is the chain's number. It is still reported by
/// the authority rather than derived on-chain, which is an honest limitation and
/// not a solved problem: a creator can under-report, and what the chain
/// guarantees is that the number they *did* report is the one the threshold is
/// measured against, and that it only ever moves through an event. A member-count
/// oracle is the next thing this would need, and it is not in scope here.
///
/// The count is signed by the authority and cannot go negative. `validate_member_count`
/// uses checked arithmetic because a wrapped `u32` would read as a huge member
/// count and instantly satisfy every handover threshold.
pub fn record_membership_delta(ctx: Context<RecordMembershipDelta>, delta: i32) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.community.authority,
        GovernanceError::NotCommunityAuthority
    );

    let previous = ctx.accounts.active_rules.active_member_count;
    let updated = validation::rules::validate_member_count(previous, delta)?;

    ctx.accounts.active_rules.active_member_count = updated;

    emit!(MembershipCountChanged {
        community_id: ctx.accounts.community.community_id,
        previous_count: previous,
        active_member_count: updated,
    });

    Ok(())
}
