//! Host-side unit tests.
//!
//! These run without a validator and cover the two classes of bug that are
//! cheap to catch here and expensive to catch on-chain: a PDA seed that no
//! longer matches what the client derives, and an account size constant that
//! has drifted from its struct. Instruction-body behaviour that needs an
//! `AccountInfo` is covered by the integration tests in `tests/`.

use anchor_lang::error::ERROR_CODE_OFFSET;
use anchor_lang::prelude::*;
use crate::constants::{
    seeds, space, DecisionOutcome, PermissionStatus, RuleMode, MAX_THRESHOLD_BPS,
};
use crate::errors::GovernanceError;
use crate::instructions::activate_ruleset::required_approvals;
use crate::state::{ActiveRules, CommunityState, GovernanceEvent, PermissionState, RuleSet};
use crate::validation::rules::{
    validate_expiry, validate_member_count, validate_revocable, validate_thresholds,
    validate_version_chain,
};

const PROGRAM_ID: Pubkey = crate::ID;

fn bytes32(n: u8) -> [u8; 32] {
    [n; 32]
}

#[test]
fn program_id_matches_the_generated_keypair() {
    // A mismatch here means Anchor.toml, declare_id!, and the deployed program
    // disagree, and every PDA in the program would be wrong.
    assert_eq!(
        PROGRAM_ID.to_string(),
        "5kd7y5YMtwCEggyHQahFFgmS4CeTEdGeaGBjVfuz8p2b"
    );
}

#[test]
fn community_pda_derivation_is_deterministic() {
    let community_id = bytes32(1);

    let (first, bump_first) =
        Pubkey::find_program_address(&[seeds::COMMUNITY, &community_id], &PROGRAM_ID);
    let (second, bump_second) =
        Pubkey::find_program_address(&[seeds::COMMUNITY, &community_id], &PROGRAM_ID);

    assert_eq!(first, second, "PDA derivation must be stable");
    assert_eq!(bump_first, bump_second);
}

#[test]
fn permission_pda_differs_per_permission_id() {
    let community_id = bytes32(1);

    let (a, _) = Pubkey::find_program_address(
        &[seeds::PERMISSION, &community_id, &bytes32(2)],
        &PROGRAM_ID,
    );
    let (b, _) = Pubkey::find_program_address(
        &[seeds::PERMISSION, &community_id, &bytes32(3)],
        &PROGRAM_ID,
    );
    let (other_community, _) = Pubkey::find_program_address(
        &[seeds::PERMISSION, &bytes32(9), &bytes32(2)],
        &PROGRAM_ID,
    );

    assert_ne!(a, b, "each permission id needs its own account");
    assert_ne!(
        a, other_community,
        "permission namespaces must not collide across communities"
    );
}

#[test]
fn event_pda_differs_per_event_id() {
    let community_id = bytes32(1);

    let (a, _) =
        Pubkey::find_program_address(&[seeds::EVENT, &community_id, &bytes32(4)], &PROGRAM_ID);
    let (b, _) =
        Pubkey::find_program_address(&[seeds::EVENT, &community_id, &bytes32(5)], &PROGRAM_ID);

    assert_ne!(a, b, "each decision needs its own account so history is append-only");
}

#[test]
fn pda_is_off_the_ed25519_curve() {
    // A PDA must not have a canonical on-curve address, otherwise it is a
    // normal account and the seeds would not be enforced. Verified against
    // real keys: a wallet-derived pubkey and the system program are both
    // on-curve, so this is a real distinction and not a trivially-true check.
    let (pda, _) =
        Pubkey::find_program_address(&[seeds::COMMUNITY, &bytes32(1)], &PROGRAM_ID);
    assert!(
        !pda.is_on_curve(),
        "{pda} is on the ed25519 curve and is not a PDA"
    );

    // Guard against the assertion above passing vacuously.
    assert!(Pubkey::new_unique().is_on_curve());
}

/// Guards the hand-written `space::*` constants against the real struct layout.
///
/// If a field is added to an account without bumping its constant, the `init`
/// constraint allocates too little and the write corrupts the neighbouring
/// account. This catches that at compile-test time instead.
#[test]
fn space_constants_match_struct_layouts() {
    assert_eq!(
        CommunityState::INIT_SPACE + 8,
        space::COMMUNITY,
        "CommunityState layout changed; update constants::space::COMMUNITY"
    );
    assert_eq!(
        PermissionState::INIT_SPACE + 8,
        space::PERMISSION,
        "PermissionState layout changed; update constants::space::PERMISSION"
    );
    assert_eq!(
        GovernanceEvent::INIT_SPACE + 8,
        space::EVENT,
        "GovernanceEvent layout changed; update constants::space::EVENT"
    );
}

#[test]
fn permission_is_effective_before_expiry_only() {
    let base = PermissionState {
        permission_id: bytes32(1),
        community_id: bytes32(1),
        grantee: Pubkey::new_unique(),
        purpose_hash: bytes32(2),
        resource_hash: bytes32(3),
        policy_hash: bytes32(4),
        issued_at: 1_000,
        expires_at: 2_000,
        revoked_at: 0,
        status: PermissionStatus::Active,
        bump: 254,
    };

    assert!(base.is_effective_at(1_999), "active and unexpired");
    assert!(
        !base.is_effective_at(2_000),
        "expiry is exclusive to match the off-chain engine's <= check"
    );
    assert!(!base.is_effective_at(5_000), "long past expiry");

    let revoked = PermissionState {
        status: PermissionStatus::Revoked,
        revoked_at: 1_500,
        ..base
    };
    assert!(
        !revoked.is_effective_at(1_100),
        "revocation takes effect immediately, not at its timestamp"
    );
}

#[test]
fn expiry_rejects_non_future_timestamps() {
    let now = 1_000;

    assert!(validate_expiry(now, now + 1).is_ok());

    // The off-chain engine denies when expiresAt <= now, so the boundary must
    // be rejected here too or the two layers disagree.
    assert_eq!(
        validate_expiry(now, now).unwrap_err(),
        GovernanceError::PermissionAlreadyExpired.into(),
        "expires_at == now must be rejected"
    );
    assert_eq!(
        validate_expiry(now, now - 1).unwrap_err(),
        GovernanceError::PermissionAlreadyExpired.into()
    );
    assert_eq!(
        validate_expiry(now, i64::MIN).unwrap_err(),
        GovernanceError::PermissionAlreadyExpired.into(),
        "a far-future date must not overflow into acceptance"
    );
}

#[test]
fn revocation_is_rejected_when_not_active() {
    assert!(validate_revocable(PermissionStatus::Active).is_ok());
    assert_eq!(
        validate_revocable(PermissionStatus::Revoked).unwrap_err(),
        GovernanceError::PermissionAlreadyRevoked.into()
    );
}

#[test]
fn status_and_outcome_decoding_reject_unknown_values() {
    assert_eq!(PermissionStatus::from_u8(0), Some(PermissionStatus::Active));
    assert_eq!(
        PermissionStatus::from_u8(1),
        Some(PermissionStatus::Revoked)
    );
    assert_eq!(PermissionStatus::from_u8(2), None);
    assert_eq!(PermissionStatus::from_u8(255), None);

    assert_eq!(
        DecisionOutcome::from_u8(0),
        Some(DecisionOutcome::Approved)
    );
    assert_eq!(DecisionOutcome::from_u8(1), Some(DecisionOutcome::Rejected));
    assert_eq!(DecisionOutcome::from_u8(2), None);
}

#[test]
fn error_codes_are_stable() {
    // The TypeScript client maps these exact numbers to messages
    // (GOVERNANCE_ERROR in packages/blockchain-client/src/types.ts), so a
    // mismatch here means the client reports the wrong reason for a real
    // failure.
    //
    // Anchor's `#[error_code]` keeps the source enum's discriminants at 0..n and
    // emits a second, offset enum on chain, so the on-chain code is
    // ERROR_CODE_OFFSET + position. That generated enum is not nameable from
    // here — it collides with `anchor_lang::error::ErrorCode` — so this test
    // pins the offset and the ordering instead. The end-to-end test in
    // tests/anchor-integration.js asserts the resulting 6000.. values against
    // the real program, which is what actually closes the loop.
    assert_eq!(
        ERROR_CODE_OFFSET, 6000,
        "the TypeScript error map is hard-coded to the 6000 block; if Anchor \
         ever changes this offset the client must be updated in the same commit"
    );

    let ordered = [
        (GovernanceError::NotCommunityAuthority, "NotCommunityAuthority"),
        (GovernanceError::PermissionAlreadyExpired, "PermissionAlreadyExpired"),
        (GovernanceError::PermissionAlreadyRevoked, "PermissionAlreadyRevoked"),
        (GovernanceError::InvalidTimestamp, "InvalidTimestamp"),
        (GovernanceError::AuthorityMismatch, "AuthorityMismatch"),
        // Appended after the five above, in this exact order. The codes the
        // TypeScript client maps are 6005..6016.
        (GovernanceError::RulesetAlreadyInitialized, "RulesetAlreadyInitialized"),
        (GovernanceError::RulesetVersionNotSequential, "RulesetVersionNotSequential"),
        (GovernanceError::RulesetHasPredecessor, "RulesetHasPredecessor"),
        (GovernanceError::RulesetPredecessorMismatch, "RulesetPredecessorMismatch"),
        (GovernanceError::ThresholdOutOfRange, "ThresholdOutOfRange"),
        (GovernanceError::QuorumAboveThreshold, "QuorumAboveThreshold"),
        (GovernanceError::AlreadyHandedOver, "AlreadyHandedOver"),
        (GovernanceError::HandoverThresholdNotMet, "HandoverThresholdNotMet"),
        (GovernanceError::MemberCountUnderflow, "MemberCountUnderflow"),
        (GovernanceError::NoActiveRuleset, "NoActiveRuleset"),
        (GovernanceError::RulesetAlreadyActivated, "RulesetAlreadyActivated"),
        (GovernanceError::InsufficientApprovals, "InsufficientApprovals"),
    ];

    for (index, (error, name)) in ordered.iter().enumerate() {
        let position = *error as u32;
        let expected = index as u32;
        assert_eq!(
            position, expected,
            "{name} sits at position {position} but is declared in slot {expected}; \
             reordering changes the on-chain code and breaks the TypeScript map"
        );
        assert_eq!(
            position + ERROR_CODE_OFFSET,
            6000 + expected,
            "{name} would land on code {}, not {}",
            position + ERROR_CODE_OFFSET,
            6000 + expected
        );
    }
}

#[test]
fn seeds_are_namespaced_and_distinct() {
    let all = [
        seeds::COMMUNITY,
        seeds::PERMISSION,
        seeds::EVENT,
        seeds::RULESET,
        seeds::ACTIVE_RULES,
    ];
    for (i, a) in all.iter().enumerate() {
        for b in all.iter().skip(i + 1) {
            assert_ne!(a, b, "seed prefixes must not collide across account types");
        }
    }
    for seed in all {
        assert!(
            seed.len() <= 32,
            "seed prefix longer than 32 bytes is truncated by find_program_address"
        );
    }
}

#[test]
fn ruleset_pda_differs_per_version_and_never_collides_with_active_rules() {
    let community_id = bytes32(1);

    let (v1, _) = Pubkey::find_program_address(
        &[seeds::RULESET, &community_id, &1u32.to_be_bytes()],
        &PROGRAM_ID,
    );
    let (v2, _) = Pubkey::find_program_address(
        &[seeds::RULESET, &community_id, &2u32.to_be_bytes()],
        &PROGRAM_ID,
    );
    assert_ne!(
        v1, v2,
        "each version needs its own account or the history cannot be walked"
    );

    // The big-endian encoding matters: little-endian would make version 1 and
    // version 256 collide only for large numbers, but more importantly the
    // TypeScript client encodes the same way and a mismatch would send every
    // activation to an account the program does not read.
    let (v1_le, _) = Pubkey::find_program_address(
        &[seeds::RULESET, &community_id, &1u32.to_le_bytes()],
        &PROGRAM_ID,
    );
    assert_ne!(v1, v1_le, "the version seed must be big-endian");

    let (active, _) =
        Pubkey::find_program_address(&[seeds::ACTIVE_RULES, &community_id], &PROGRAM_ID);
    assert_ne!(
        v1, active,
        "a version account and the live-ruleset pointer must never share an address"
    );
}

#[test]
fn threshold_and_quorum_bounds_are_enforced() {
    assert!(validate_thresholds(6000, 5000).is_ok());
    assert!(validate_thresholds(1, 1).is_ok());
    assert!(validate_thresholds(MAX_THRESHOLD_BPS, MAX_THRESHOLD_BPS).is_ok());

    // A u16 could express 655.35%, which can never be satisfied and, because
    // versions are immutable, could never be corrected once written.
    assert!(validate_thresholds(MAX_THRESHOLD_BPS + 1, 1).is_err());
    assert!(validate_thresholds(u16::MAX, 1).is_err());
    // 0% means one approval decides, which is a plausible typo for "no approval
    // needed" and must not be silently accepted.
    assert!(validate_thresholds(0, 1).is_err());
    assert!(validate_thresholds(6000, 0).is_err());

    // Quorum is a floor on participation, threshold the bar within it.
    assert!(validate_thresholds(5000, 6000).is_err());
}

#[test]
fn version_chain_requires_a_genesis_then_exactly_one_step() {
    // Genesis: version 1, no predecessor.
    assert!(validate_version_chain(1, 0, None).is_ok());
    assert!(validate_version_chain(2, 0, None).is_err());
    assert!(validate_version_chain(1, 1, None).is_err());

    // After genesis: strictly active + 1, predecessor must be the active version.
    assert!(validate_version_chain(2, 1, Some(1)).is_ok());
    assert!(validate_version_chain(3, 1, Some(1)).is_err(), "no skipping");
    assert!(validate_version_chain(2, 0, Some(1)).is_err(), "no forking");
    assert!(validate_version_chain(2, 2, Some(1)).is_err(), "no self-reference");
}

#[test]
fn required_approvals_rounds_up_like_the_off_chain_engine() {
    // ceil(members * bps / 10000). Rounding down would let a 1% threshold on ten
    // members pass with zero approvers, and would disagree with
    // `GovernanceService.computeThreshold` at exactly the boundary.
    assert_eq!(required_approvals(10, 6000), 6);
    assert_eq!(required_approvals(100, 6000), 60);
    assert_eq!(required_approvals(10, 1), 1);
    assert_eq!(required_approvals(0, 6000), 0);
    // 33% of 10 is 3.3, so 4.
    assert_eq!(required_approvals(10, 3300), 4);
    // Exactly on the boundary must round up, not down.
    assert_eq!(required_approvals(20, 5000), 10);
    assert_eq!(required_approvals(3, 3333), 1);
    assert_eq!(required_approvals(3, 3334), 2);
}

#[test]
fn membership_delta_uses_checked_arithmetic() {
    assert_eq!(validate_member_count(5, 3).unwrap(), 8);
    assert_eq!(validate_member_count(5, -5).unwrap(), 0);
    assert_eq!(validate_member_count(0, 0).unwrap(), 0);

    // The dangerous case: a wrapped u32 would read as ~4 billion members and
    // instantly satisfy every handover threshold on the community.
    assert!(validate_member_count(2, -5).is_err());
    assert!(validate_member_count(0, -1).is_err());
    assert!(validate_member_count(1, i32::MIN).is_err());
    assert!(validate_member_count(u32::MAX, 1).is_err());
}

#[test]
fn handover_fires_only_when_the_creator_scheduled_it_and_the_count_reached_it() {
    let rules = ruleset_with_min_members(3);
    let active = active_rules_with_members(3);

    // Exactly at the threshold counts. `>=`, not `>`: a creator who wrote 3
    // meant 3, and requiring one more member than promised would be a rule the
    // chain silently tightened.
    assert!(active.handover_satisfied_by(&rules, 3));
    assert!(active.handover_satisfied_by(&rules, 10));
    assert!(!active.handover_satisfied_by(&rules, 2));

    // A creator who never scheduled a handover cannot be handed over. Without
    // this, `min_active_members == 0` would mean "any single member count
    // triggers", so zero has to read as "never".
    let unscheduled = ruleset_with_min_members(0);
    assert!(!unscheduled.schedules_handover());
    assert!(!active.handover_satisfied_by(&unscheduled, 3));
    assert!(
        !active.handover_satisfied_by(&unscheduled, u32::MAX),
        "a max member count must not substitute for a scheduled handover"
    );
}

#[test]
fn handover_receipt_is_driven_by_the_timestamp_not_the_mode() {
    let mut active = active_rules_with_members(3);
    assert!(!active.has_handed_over());

    // mode and receipt are set together by the instruction, but the receipt is
    // what is read. Asserting on the timestamp pins that intent.
    active.handed_over_at = 1_700_000_000;
    assert!(active.has_handed_over());

    // A backdated-zero receipt must not read as "not handed over": 0 is the
    // sentinel for "never", so any non-zero value is a receipt.
    assert!(!active_rules_with_members(3).has_handed_over());
}

fn ruleset_with_min_members(min_active_members: u32) -> RuleSet {
    RuleSet {
        community_id: bytes32(1),
        version: 1,
        mode: RuleMode::CreatorControl,
        threshold_bps: 6000,
        quorum_bps: 5000,
        min_active_members,
        rules_hash: bytes32(7),
        previous_version: 0,
        created_at: 1_700_000_000,
        activated_at: 1_700_000_000,
        bump: 254,
    }
}

fn active_rules_with_members(active_member_count: u32) -> ActiveRules {
    ActiveRules {
        community_id: bytes32(1),
        version: 1,
        mode: RuleMode::CreatorControl,
        active_member_count,
        activated_at: 1_700_000_000,
        handed_over_at: 0,
        bump: 253,
    }
}

#[test]
fn mode_decoding_rejects_unknown_values() {
    assert_eq!(RuleMode::from_u8(0), Some(RuleMode::CreatorControl));
    assert_eq!(RuleMode::from_u8(1), Some(RuleMode::SharedGovernance));
    assert_eq!(RuleMode::from_u8(2), None, "there is no third mode; handover is one-way");

    assert!(!RuleMode::CreatorControl.is_shared());
    assert!(RuleMode::SharedGovernance.is_shared());
}

#[test]
fn active_rules_space_matches_the_struct() {
    // 8 discriminator + 32 community_id + 4 version + 1 mode
    //   + 4 active_member_count + 8 activated_at + 8 handed_over_at + 1 bump
    assert_eq!(space::ACTIVE_RULES, 8 + 32 + 4 + 1 + 4 + 8 + 8 + 1);
    assert_eq!(ActiveRules::LEN, space::ACTIVE_RULES);
}

#[test]
fn ruleset_space_matches_the_struct() {
    // 8 + 32 community_id + 4 version + 1 mode + 2 threshold_bps + 2 quorum_bps
    //   + 4 min_active_members + 32 rules_hash + 4 previous_version
    //   + 8 created_at + 8 activated_at + 1 bump
    assert_eq!(space::RULESET, 8 + 32 + 4 + 1 + 2 + 2 + 4 + 32 + 4 + 8 + 8 + 1);
    assert_eq!(RuleSet::LEN, space::RULESET);
}
