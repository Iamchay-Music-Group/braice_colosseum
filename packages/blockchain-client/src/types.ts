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
