use anchor_lang::prelude::*;
use crate::constants::seeds;
use crate::errors::GovernanceError;
use crate::state::{CommunityInitialized, CommunityState};

#[derive(Accounts)]
#[instruction(community_id: [u8; 32], authority: Pubkey, name_hash: [u8; 32])]
pub struct InitializeCommunity<'info> {
    /// Pays for the account and must sign. Bound to `authority` below, so
    /// whoever pays is also the community's governance key.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The community's governance root.
    ///
    /// The authority is an explicit instruction argument rather than derived
    /// from the payer, which is what makes the binding irreversible: the PDA
    /// cannot later be re-pointed at a different key, so the governance
    /// identity of a community cannot be captured after the fact.
    #[account(
        init,
        payer = payer,
        space = CommunityState::LEN,
        seeds = [seeds::COMMUNITY, community_id.as_ref()],
        bump,
    )]
    pub community: Account<'info, CommunityState>,

    pub system_program: Program<'info, System>,
}

/// Bind a community id to a governance authority, once and permanently.
///
/// The off-chain layer decides *who* is allowed to create a community; this
/// instruction records that choice immutably so that later, off-chain
/// permission records can be attributed to a specific key.
pub fn initialize_community(
    ctx: Context<InitializeCommunity>,
    community_id: [u8; 32],
    authority: Pubkey,
    name_hash: [u8; 32],
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.payer.key(),
        authority,
        GovernanceError::AuthorityMismatch
    );

    let now = clock::Clock::get()?.unix_timestamp;

    let community = &mut ctx.accounts.community;
    community.community_id = community_id;
    community.authority = authority;
    community.name_hash = name_hash;
    community.permission_count = 0;
    community.decision_count = 0;
    community.created_at = now;
    community.bump = ctx.bumps.community;

    emit!(CommunityInitialized {
        community_id,
        authority,
        name_hash,
        created_at: now,
    });

    Ok(())
}
