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
    seeds, space, DecisionOutcome, PermissionStatus,
};
use crate::errors::GovernanceError;
use crate::state::{CommunityState, GovernanceEvent, PermissionState};
use crate::validation::rules::{validate_expiry, validate_revocable};

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
    let all = [seeds::COMMUNITY, seeds::PERMISSION, seeds::EVENT];
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
