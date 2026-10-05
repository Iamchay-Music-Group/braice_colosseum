use anchor_lang::prelude::*;
use crate::constants::{PermissionStatus, MAX_THRESHOLD_BPS};
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

    /// A ruleset's numeric parameters must be usable.
    ///
    /// Both values are `u16`, so `threshold_bps` can express 655.35%. A version
    /// carrying such a value could never be corrected, because versions are
    /// append-only: it would sit in the chain forever as a rule that can never be
    /// satisfied. Rejecting it at write time is the only place it can be caught.
    ///
    /// Zero is rejected along with the absurd end. A 0% threshold means a single
    /// approval carries a decision, which is a plausible typo for a creator who
    /// means "no approval needed" - and silently treating it as "unanimous" or
    /// "unconstrained" would both be wrong.
    pub fn validate_thresholds(threshold_bps: u16, quorum_bps: u16) -> Result<()> {
        require!(
            threshold_bps > 0 && threshold_bps <= MAX_THRESHOLD_BPS,
            GovernanceError::ThresholdOutOfRange
        );
        require!(
            quorum_bps > 0 && quorum_bps <= MAX_THRESHOLD_BPS,
            GovernanceError::ThresholdOutOfRange
        );
        // Quorum is a floor on participation; threshold is the bar within it.
        // A quorum above the threshold is unsatisfiable for small communities
        // and means the creator transposed the two fields.
        require!(
            quorum_bps <= threshold_bps,
            GovernanceError::QuorumAboveThreshold
        );
        Ok(())
    }

    /// A new version must extend the live history by exactly one.
    ///
    /// Sequential-only is what makes the chain auditable. Allowing an arbitrary
    /// jump would let a community silently skip versions, and allowing a
    /// `previous_version` that is not the live version would let two rulesets
    /// both claim to descend from the same parent - a fork, which is exactly the
    /// rewrite of history the anchor exists to prevent.
    pub fn validate_version_chain(
        new_version: u32,
        previous_version: u32,
        active_version: Option<u32>,
    ) -> Result<()> {
        match active_version {
            None => {
                require!(new_version == 1, GovernanceError::RulesetVersionNotSequential);
                require!(
                    previous_version == 0,
                    GovernanceError::RulesetHasPredecessor
                );
            }
            Some(active) => {
                require!(
                    new_version == active + 1,
                    GovernanceError::RulesetVersionNotSequential
                );
                require!(
                    previous_version == active,
                    GovernanceError::RulesetPredecessorMismatch
                );
            }
        }
        Ok(())
    }

    /// Applying a membership delta must not take the count below zero.
    ///
    /// Checked with `checked_sub` rather than by comparing after the fact: a
    /// wrapped `u32` would land on a huge number, which would instantly satisfy
    /// every handover threshold on the community. An underflow that aborts is a
    /// nuisance; an underflow that reads as a million members is a takeover.
    pub fn validate_member_count(previous: u32, delta: i32) -> Result<u32> {
        if delta < 0 {
            let magnitude = delta.unsigned_abs();
            require!(
                previous >= magnitude,
                GovernanceError::MemberCountUnderflow
            );
            Ok(previous - magnitude)
        } else {
            // `ok_or` would need a constructed `Error`, which `GovernanceError`
            // does not implicitly convert to at this call site's type. Require
            // first so the failure carries the same program error as the
            // subtraction branch above.
            let sum = previous.checked_add(delta as u32);
            require!(sum.is_some(), GovernanceError::MemberCountUnderflow);
            Ok(sum.unwrap_or(previous))
        }
    }
}
