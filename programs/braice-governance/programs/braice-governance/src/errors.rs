use anchor_lang::prelude::*;

/// Program errors.
///
/// `#[error_code]` assigns each variant the on-chain code 6000 + its position in
/// this enum. Explicit discriminants must NOT be written: Anchor honours them
/// verbatim, which would make the chain emit 0, 1, 2 ... while the generated
/// IDL advertises 6000, 6001, 6002 — the client would then map every failure to
/// the wrong reason.
///
/// Stability therefore comes from ordering, not from numeric assignment: this
/// enum is append-only. A variant's code is 6000 + its index, so inserting a
/// variant in the middle would renumber every later error and silently break
/// every client that has already shipped. New errors go at the end.
///
/// This enum deliberately contains only errors the program can actually raise.
/// A variant that no code path can return is worse than no variant at all: it
/// looks like a contract, invites a client to handle a case that cannot occur,
/// and inflates every later error's code. Three candidates were removed for
/// exactly this reason:
///
/// * "already exists" — every account is created with `#[account(init)]`, so a
///   duplicate id is rejected by the System Program's account allocation
///   ("account already in use", `Custom: 0`) before the handler body runs. A
///   program-level check can never get the chance to fire.
/// * "invalid bump" — every PDA declares `bump` without a supplied value, so
///   Anchor derives it canonically and it can never disagree with the client.
/// * "permission is not Active" — `create_permission` runs only against a
///   freshly `init`-ed account and assigns `Active` unconditionally, so there
///   is no window in which the account exists in any other state.
///
/// The numeric codes the TypeScript client maps are asserted in
/// `tests::error_codes_are_stable` and exercised end to end against the real
/// program in `tests/anchor-integration.js`.
#[error_code]
pub enum GovernanceError {
    #[msg("Signer is not the community authority")]
    NotCommunityAuthority,

    #[msg("Permission expires_at must be strictly in the future")]
    PermissionAlreadyExpired,

    #[msg("Permission has already been revoked and cannot be revoked again")]
    PermissionAlreadyRevoked,

    #[msg("Timestamps overflow the supported range")]
    InvalidTimestamp,

    #[msg("The signing authority does not match the authority the community was initialized with")]
    AuthorityMismatch,

    // --- Ruleset errors. Appended after the permission errors above. ---
    //
    // Never insert above this line: codes are positional (6000 + index), so a
    // new variant in the middle renumbers everything after it and silently
    // breaks every client that already maps the old numbers.

    #[msg("This community already has a ruleset; only initialize once")]
    RulesetAlreadyInitialized,
    #[msg("Ruleset version must be exactly one more than the version in force")]
    RulesetVersionNotSequential,
    #[msg("Genesis ruleset must declare no predecessor")]
    RulesetHasPredecessor,
    #[msg("Non-genesis ruleset must name the version currently in force as its predecessor")]
    RulesetPredecessorMismatch,
    #[msg("threshold_bps and quorum_bps must be between 1 and 10000 basis points")]
    ThresholdOutOfRange,
    #[msg("quorum_bps cannot exceed threshold_bps")]
    QuorumAboveThreshold,
    #[msg("Governance has already moved from creator control to shared governance")]
    AlreadyHandedOver,
    #[msg("Handover requires the active member count to reach the creator's threshold")]
    HandoverThresholdNotMet,
    #[msg("Active member count would go negative")]
    MemberCountUnderflow,
    #[msg("This community has no ruleset in force")]
    NoActiveRuleset,
    #[msg("Ruleset version was already activated and cannot be activated again")]
    RulesetAlreadyActivated,
    #[msg("Not enough distinct approvals to meet the threshold under shared governance")]
    InsufficientApprovals,
}
