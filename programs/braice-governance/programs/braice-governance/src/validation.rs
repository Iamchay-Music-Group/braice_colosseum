use anchor_lang::prelude::*;
use crate::constants::PermissionStatus;
use crate::errors::GovernanceError;

/// Pure validation, kept out of the instruction bodies so it can be unit
/// tested without a validator. The rules live here rather than being inlined at
/// each call site so that the same invariant cannot be enforced one way in
/// `create_permission` and another way in a future instruction.
pub mod rules {
    use super::*;

    /// A permission must expire strictly in the future at creation time.
    ///
    /// Strictly, not inclusively: a permission whose `expires_at` equals the
    /// current second is already spent, and the off-chain engine treats
    /// `expiresAt <= now` as expired. Accepting the boundary here would let a
    /// permission be anchored that the engine immediately rejects.
    pub fn validate_expiry(now: i64, expires_at: i64) -> Result<()> {
        require!(expires_at > now, GovernanceError::PermissionAlreadyExpired);
        Ok(())
    }

    /// Only an active permission can transition to revoked.
    pub fn validate_revocable(status: PermissionStatus) -> Result<()> {
        require!(
            status == PermissionStatus::Active,
            GovernanceError::PermissionAlreadyRevoked
        );
        Ok(())
    }
}
