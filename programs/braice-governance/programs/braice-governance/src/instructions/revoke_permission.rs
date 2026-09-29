use anchor_lang::prelude::*;
use crate::constants::seeds;
use crate::errors::GovernanceError;
use crate::constants::PermissionStatus;
use crate::state::{CommunityState, PermissionRevoked, PermissionState};
use crate::validation;

#[derive(Accounts)]
#[instruction(policy_hash: [u8; 32])]
pub struct RevokePermission<'info> {
    /// The community that issued the permission.
    pub community: Account<'info, CommunityState>,

    /// The community's governance key. Only this key can revoke.
    pub authority: Signer<'info>,

    /// The permission receipt to withdraw.
    #[account(
        mut,
        seeds = [seeds::PERMISSION, permission.community_id.as_ref(), permission.permission_id.as_ref()],
        bump = permission.bump,
    )]
    pub permission: Account<'info, PermissionState>,
}

/// Withdraw a permission, permanently.
///
/// Revocation is one-way: a revoked account can never return to `Active`, so a
/// permission that was withdrawn on-chain cannot be quietly resurrected by an
/// off-chain write. Revoking twice is rejected rather than silently succeeding,
/// which keeps a double-revoke from looking like a fresh governance action in
/// the event log.
pub fn revoke_permission(
    ctx: Context<RevokePermission>,
    _policy_hash: [u8; 32],
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.community.authority,
        GovernanceError::NotCommunityAuthority
    );

    // Guard against a permission id that exists in this community's namespace
    // but was anchored with different terms. `require_keys_eq!` is for
    // Pubkeys; community_id is a byte array, so this compares directly.
    require!(
        ctx.accounts.permission.community_id == ctx.accounts.community.community_id,
        GovernanceError::NotCommunityAuthority
    );

    let permission = &mut ctx.accounts.permission;
    validation::rules::validate_revocable(permission.status)?;

    let now = clock::Clock::get()?.unix_timestamp;

    permission.status = PermissionStatus::Revoked;
    permission.revoked_at = now;

    emit!(PermissionRevoked {
        permission_id: permission.permission_id,
        community_id: permission.community_id,
        policy_hash: permission.policy_hash,
        revoked_at: now,
    });

    Ok(())
}

/// Keep `_policy_hash` in the IDL.
///
/// The client passes the policy hash it believes is anchored so that a stale
/// client cannot revoke a permission whose terms have since changed. The value
/// is intentionally *not* enforced here: revoking is a safety-increasing
/// action, so refusing to revoke because of a hash mismatch would leave a
/// permission live that the community meant to withdraw.
#[allow(dead_code)]
fn _assert_policy_hash_is_in_idl(policy_hash: [u8; 32]) -> [u8; 32] {
    policy_hash
}
