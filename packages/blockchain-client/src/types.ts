import type { Commitment } from '@solana/web3.js';

/** Commitment level used when sending and confirming transactions. */
export type { Commitment };

/**
 * Outcome of a recorded governance decision.
 *
 * The numeric values are the on-chain discriminants and are part of the
 * program's wire format: they are asserted in the Rust tests and must not be
 * reordered.
 */
export enum DecisionOutcome {
  Approved = 0,
  Rejected = 1,
}

/**
 * Lifecycle status of an anchored permission.
 *
 * Mirror of `constants::PermissionStatus` in the Rust program.
 */
export enum AnchoredPermissionStatus {
  Active = 0,
  Revoked = 1,
}

/**
 * Authority structure a community currently governs under.
 *
 * Mirror of `constants::RuleMode` in the Rust program. The numeric values are
 * the on-chain discriminants and are part of the wire format.
 */
export enum RuleMode {
  /** The creator's key alone can change the rules. Bounded by `min_active_members`. */
  CreatorControl = 0,
  /** Rule changes need threshold signatures. Set once, by handover, and never undone. */
  SharedGovernance = 1,
}

export interface SolanaClientConfig {
  /** JSON-RPC endpoint. */
  rpcUrl: string;
  /** Base58 program id. A placeholder or blank value disables anchoring. */
  programId: string;
  /** Commitment for send + confirm. Defaults to 'confirmed'. */
  commitment: Commitment;
  /** Filesystem path to the keypair that signs anchoring transactions. */
  keypairPath: string;
}

/** A permission as the chain records it. */
export interface AnchoredPermission {
  permissionId: Uint8Array;
  communityId: Uint8Array;
  grantee: Uint8Array;
  purposeHash: Uint8Array;
  resourceHash: Uint8Array;
  policyHash: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  /** 0 when never revoked. */
  revokedAt: number;
  status: AnchoredPermissionStatus;
  bump: number;
}

/** One immutable ruleset version, as the chain records it. */
export interface AnchoredRuleSet {
  communityId: Uint8Array;
  version: number;
  mode: RuleMode;
  thresholdBps: number;
  quorumBps: number;
  /** Active member count at which the creator scheduled handover. 0 means never. */
  minActiveMembers: number;
  /** SHA-256 of the canonical off-chain ruleset JSON. */
  rulesHash: Uint8Array;
  /** The version this replaced, or 0 for genesis. */
  previousVersion: number;
  createdAt: number;
  /** 0 while the version is proposed but not yet in force. */
  activatedAt: number;
  bump: number;
}

/** The single account naming which ruleset version is in force. */
export interface AnchoredActiveRules {
  communityId: Uint8Array;
  version: number;
  mode: RuleMode;
  activeMemberCount: number;
  activatedAt: number;
  /** 0 until handover happens; non-zero afterwards, permanently. */
  handedOverAt: number;
  bump: number;
}

/**
 * On-chain program error codes.
 *
 * Anchor derives each code as 6000 + the variant's position in the Rust
 * `GovernanceError` enum, so these numbers are positional, not chosen. The enum
 * is append-only: inserting a variant would renumber every later error and
 * break clients that have already shipped.
 *
 * Only errors the program can actually raise are listed. A duplicate id is not
 * here because it never reaches the program — `#[account(init)]` is rejected by
 * the System Program's allocation ("account already in use", `Custom: 0`) before
 * the handler body runs. `tests/anchor-integration.js` pins that behaviour and
 * asserts the original record is left untouched.
 */
export const GOVERNANCE_ERROR = {
  NotCommunityAuthority: 6000,
  PermissionAlreadyExpired: 6001,
  PermissionAlreadyRevoked: 6002,
  InvalidTimestamp: 6003,
  AuthorityMismatch: 6004,
  RulesetAlreadyInitialized: 6005,
  RulesetVersionNotSequential: 6006,
  RulesetHasPredecessor: 6007,
  RulesetPredecessorMismatch: 6008,
  ThresholdOutOfRange: 6009,
  QuorumAboveThreshold: 6010,
  AlreadyHandedOver: 6011,
  HandoverThresholdNotMet: 6012,
  MemberCountUnderflow: 6013,
  NoActiveRuleset: 6014,
  RulesetAlreadyActivated: 6015,
  InsufficientApprovals: 6016,
} as const;

const ERROR_MESSAGES: Record<number, string> = {
  [GOVERNANCE_ERROR.NotCommunityAuthority]:
    'Signer is not the community authority',
  [GOVERNANCE_ERROR.PermissionAlreadyExpired]:
    'Permission expires_at must be in the future',
  [GOVERNANCE_ERROR.PermissionAlreadyRevoked]:
    'Permission has already been revoked',
  [GOVERNANCE_ERROR.InvalidTimestamp]: 'Timestamps overflow the supported range',
  [GOVERNANCE_ERROR.AuthorityMismatch]:
    'Payer does not match the declared community authority',
  [GOVERNANCE_ERROR.RulesetAlreadyInitialized]:
    'This community already has a genesis ruleset',
  [GOVERNANCE_ERROR.RulesetVersionNotSequential]:
    'Ruleset versions must increase by exactly one',
  [GOVERNANCE_ERROR.RulesetHasPredecessor]:
    'Only the genesis ruleset may have no predecessor',
  [GOVERNANCE_ERROR.RulesetPredecessorMismatch]:
    'Ruleset predecessor does not match the version in force',
  [GOVERNANCE_ERROR.ThresholdOutOfRange]:
    'Threshold must be between 1 and 10000 basis points',
  [GOVERNANCE_ERROR.QuorumAboveThreshold]:
    'Quorum cannot exceed the approval threshold',
  [GOVERNANCE_ERROR.AlreadyHandedOver]:
    'This community has already handed over to shared governance',
  [GOVERNANCE_ERROR.HandoverThresholdNotMet]:
    'Active member count has not reached min_active_members',
  [GOVERNANCE_ERROR.MemberCountUnderflow]:
    'Membership change would drive the active member count below zero',
  [GOVERNANCE_ERROR.NoActiveRuleset]:
    'No ruleset is in force for this community',
  [GOVERNANCE_ERROR.RulesetAlreadyActivated]:
    'This ruleset version is already in force',
  [GOVERNANCE_ERROR.InsufficientApprovals]:
    'Not enough distinct signer approvals to meet the threshold',
};

/**
 * Turn a program error code into a readable reason.
 *
 * Solana reports a failed instruction as a bare number, so without this an
 * operator sees "6002" and has to guess. Unrecognised codes return null rather
 * than a guessed message, so a program upgrade that adds an error is visible as
 * an unknown code instead of being mislabelled.
 */
export function describeGovernanceError(
  code: number,
): string | null {
  return ERROR_MESSAGES[code] ?? null;
}

/** Thrown when the chain rejects an instruction with a known program error. */
export class GovernanceProgramError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'GovernanceProgramError';
  }
}
