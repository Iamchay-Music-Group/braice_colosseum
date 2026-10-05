// BRAICE Governance Solana Program.
//
// ROLE: this program is a *verifiable audit anchor*, not the enforcement
// point. Postgres remains the source of truth for who may read what, and the
// off-chain permission engine makes every access decision fail-closed. The
// program exists so that a community's governance decisions and the permissions
// they produce are attributable to a specific key and cannot be rewritten
// afterwards.
//
// WHAT IS STORED: identifiers, public keys, hashes, timestamps and status only.
// No personal data, no activity records, no AI datasets, and no permission
// contents — a permission is committed to by `policy_hash`, not by its text.
//
// WHAT IS NOT STORED, AND WHY:
//   - Access decisions. A request must never depend on validator reachability;
//     if the chain were the enforcement point, an unreachable RPC would either
//     deny legitimate access or fail open. Both are worse than degrading.
//   - Anything that legitimately changes off-chain. Storing mutable text here
//     would mean paying rent forever to hold a value the community must be able
//     to correct.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod validation;

#[cfg(test)]
mod tests;

pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("5kd7y5YMtwCEggyHQahFFgmS4CeTEdGeaGBjVfuz8p2b");

#[program]
pub mod braice_governance {
    use super::*;

    /// Bind a community id to a governance authority, once and permanently.
    pub fn initialize_community(
        ctx: Context<InitializeCommunity>,
        community_id: [u8; 32],
        authority: Pubkey,
        name_hash: [u8; 32],
    ) -> Result<()> {
        instructions::initialize_community::initialize_community(
            ctx,
            community_id,
            authority,
            name_hash,
        )
    }

    /// Anchor an approved permission for a community.
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
        instructions::create_permission::create_permission(
            ctx,
            permission_id,
            grantee,
            purpose_hash,
            resource_hash,
            policy_hash,
            expires_at,
        )
    }

    /// Withdraw a permission, permanently.
    pub fn revoke_permission(
        ctx: Context<RevokePermission>,
        policy_hash: [u8; 32],
    ) -> Result<()> {
        instructions::revoke_permission::revoke_permission(ctx, policy_hash)
    }

    /// Anchor that a community reached a governance decision.
    pub fn record_governance_decision(
        ctx: Context<RecordGovernanceDecision>,
        event_id: [u8; 32],
        decision_hash: [u8; 32],
        outcome: DecisionOutcome,
    ) -> Result<()> {
        instructions::record_governance_decision::record_governance_decision(
            ctx,
            event_id,
            decision_hash,
            outcome,
        )
    }

    /// Record a community's first (genesis) ruleset and activate it.
    pub fn initialize_ruleset(
        ctx: Context<InitializeRuleSet>,
        version: u32,
        rules_hash: [u8; 32],
        threshold_bps: u16,
        quorum_bps: u16,
        min_active_members: u32,
    ) -> Result<()> {
        instructions::initialize_ruleset::initialize_ruleset(
            ctx,
            version,
            rules_hash,
            threshold_bps,
            quorum_bps,
            min_active_members,
        )
    }

    /// Create the next ruleset version without activating it.
    pub fn propose_ruleset(
        ctx: Context<ProposeRuleSet>,
        version: u32,
        rules_hash: [u8; 32],
        threshold_bps: u16,
        quorum_bps: u16,
        min_active_members: u32,
    ) -> Result<()> {
        instructions::propose_ruleset::propose_ruleset(
            ctx,
            version,
            rules_hash,
            threshold_bps,
            quorum_bps,
            min_active_members,
        )
    }

    /// Make a proposed ruleset version the one in force.
    ///
    /// The only instruction that writes the live ruleset. Under
    /// `CreatorControl` the community authority alone suffices; under
    /// `SharedGovernance` it must be accompanied by enough distinct approvers
    /// in `remaining_accounts` to meet the version's threshold.
    pub fn activate_ruleset(ctx: Context<ActivateRuleSet>, version: u32) -> Result<()> {
        instructions::activate_ruleset::activate_ruleset(ctx, version)
    }

    /// Report a change in active membership for the handover trigger.
    pub fn record_membership_delta(
        ctx: Context<RecordMembershipDelta>,
        delta: i32,
    ) -> Result<()> {
        instructions::record_membership_delta::record_membership_delta(ctx, delta)
    }

    /// Move a community from creator control to shared governance, once the
    /// creator's own `min_active_members` threshold has been reached.
    pub fn handover_to_shared_governance(
        ctx: Context<HandoverToSharedGovernance>,
        version: u32,
    ) -> Result<()> {
        instructions::handover_to_shared_governance::handover_to_shared_governance(ctx, version)
    }
}
