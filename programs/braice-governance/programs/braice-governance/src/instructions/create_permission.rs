use anchor_lang::prelude::*;
use crate::constants::seeds;
use crate::errors::GovernanceError;
use crate::constants::PermissionStatus;
use crate::state::{CommunityState, PermissionCreated, PermissionState};
use crate::validation;

#[derive(Accounts)]
#[instruction(
    permission_id: [u8; 32],
    grantee: Pubkey,
    purpose_hash: [u8; 32],
    resource_hash: [u8; 32],
    policy_hash: [u8; 32],
    expires_at: i64
)]
pub struct CreatePermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The community whose governance approved this permission.
    pub community: Account<'info, CommunityState>,

    /// The community's governance key. Its signature is what makes the
    /// anchored permission attributable to that community.
    pub authority: Signer<'info>,

    /// The permission receipt. One per permission id, so a permission can never
    /// be anchored twice under different terms.
    #[account(
        init,
        payer = payer,
        space = PermissionState::LEN,
        seeds = [seeds::PERMISSION, community.community_id.as_ref(), permission_id.as_ref()],
        bump,
    )]
    pub permission: Account<'info, PermissionState>,

    pub system_program: Program<'info, System>,
}

/// Anchor an approved permission for a community.
///
/// Requires the community authority's signature: the program will not record a
/// permission merely because some account asked it to. A permission that exists
/// on-chain is therefore evidence that this community's governance key
/// approved a payload with this exact `policy_hash` — which is what makes
/// off-chain tampering with the stored permission detectable.
#[allow(clippy::too_many_arguments)]
pub fn create_permission(
    ctx: Context<CreatePermission>,
    permission_id: [u8; 32],
    grantee: Pubkey,
    purpose_hash: [u8; 32],
    resource_hash: [u8; 32],
    policy_hash: [u8; 32],
    expires_at: i64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.community.authority,
        GovernanceError::NotCommunityAuthority
    );

    let now = clock::Clock::get()?.unix_timestamp;
    validation::rules::validate_expiry(now, expires_at)?;

    let permission = &mut ctx.accounts.permission;
    permission.permission_id = permission_id;
    permission.community_id = ctx.accounts.community.community_id;
    permission.grantee = grantee;
    permission.purpose_hash = purpose_hash;
    permission.resource_hash = resource_hash;
    permission.policy_hash = policy_hash;
    permission.issued_at = now;
    permission.expires_at = expires_at;
    permission.revoked_at = 0;
    permission.status = PermissionStatus::Active;
    permission.bump = ctx.bumps.permission;

    ctx.accounts.community.permission_count = ctx
        .accounts
        .community
        .permission_count
        .checked_add(1)
        .ok_or(GovernanceError::InvalidTimestamp)?;

    emit!(PermissionCreated {
        permission_id,
        community_id: ctx.accounts.community.community_id,
        grantee,
        policy_hash,
        issued_at: now,
        expires_at,
    });

    Ok(())
}
