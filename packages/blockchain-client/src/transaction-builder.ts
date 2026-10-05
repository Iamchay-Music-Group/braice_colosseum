import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { INSTRUCTION_DISCRIMINATOR, SEED } from './constants';
import {
  decodeHexHash,
  deriveOnChainId,
  encodeEnum,
  encodeFixed32,
  encodeI32,
  encodeI64,
  encodeU16,
  encodeU32,
} from './encoding';
import { DecisionOutcome } from './types';

/**
 * Builds the four governance instructions.
 *
 * Account ordering here is load-bearing: the runtime matches accounts to the
 * Rust `#[derive(Accounts)]` declaration positionally, so a reorder compiles
 * fine and then fails or, worse, passes the wrong account to a constraint. The
 * order matches the IDL emitted by `anchor build`.
 *
 * PDAs are derived rather than passed in, so a caller cannot accidentally
 * anchor state to an address the program will reject.
 */

/** Anchor a community id to a governance authority. */
export function communityPda(
  programId: PublicKey,
  communityId: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED.community, deriveOnChainId('community', communityId)],
    programId,
  );
}

/** The account holding one permission receipt. */
export function permissionPda(
  programId: PublicKey,
  communityId: string,
  permissionId: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      SEED.permission,
      deriveOnChainId('community', communityId),
      deriveOnChainId('permission', permissionId),
    ],
    programId,
  );
}

/** The account holding one governance decision. */
export function eventPda(
  programId: PublicKey,
  communityId: string,
  eventId: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      SEED.event,
      deriveOnChainId('community', communityId),
      deriveOnChainId('event', eventId),
    ],
    programId,
  );
}

/**
 * Re-derive a permission account's address from the ids stored inside it.
 *
 * `revoke_permission` seeds its PDA from fields inside the permission account
 * rather than from instruction arguments, so a client that only knows the
 * off-chain permission id has to fetch the account first. This turns the
 * account's own `community_id` and `permission_id` back into the canonical
 * address, which a caller can then compare against the account it fetched. A
 * mismatch means the account is not the one the caller thinks it is.
 */
export function permissionPdaFromAccount(
  programId: PublicKey,
  account: { communityId: Uint8Array; permissionId: Uint8Array },
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED.permission, account.communityId, account.permissionId],
    programId,
  );
}

/**
 * The account holding one immutable ruleset version.
 *
 * `version` is seeded big-endian, matching the Rust `version.to_be_bytes()`.
 * Deriving the seed on the client means a caller cannot ask the program to read
 * an account it will not find, and the little-endian mistake is caught here
 * rather than as an opaque "account not initialized" on chain.
 */
export function ruleSetPda(
  programId: PublicKey,
  communityId: string,
  version: number,
): [PublicKey, number] {
  assertPositiveInteger(version, 'version');
  return PublicKey.findProgramAddressSync(
    [
      SEED.ruleset,
      deriveOnChainId('community', communityId),
      versionBuffer(version),
    ],
    programId,
  );
}

/**
 * The single account naming which ruleset version is in force.
 *
 * Seeded without a version, which is what makes it singular: there is exactly
 * one address per community, so every activation competes for the same account
 * and the last writer is the one in force.
 */
export function activeRulesPda(
  programId: PublicKey,
  communityId: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED.activeRules, deriveOnChainId('community', communityId)],
    programId,
  );
}

/** Big-endian u32 seed, mirroring the Rust `to_be_bytes()` on the version. */
function versionBuffer(version: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(version, 0);
  return buf;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, received ${String(value)}`);
  }
}

export interface InitializeCommunityParams {
  communityId: string;
  authority: PublicKey;
  /** Hash of the community display name. */
  nameHash: Uint8Array;
}

/**
 * Bind a community id to an authority.
 *
 * The payer must be the authority: the program compares the two, so a mismatch
 * is rejected rather than silently binding the community to someone else.
 */
export function buildInitializeCommunity(
  programId: PublicKey,
  payer: PublicKey,
  params: InitializeCommunityParams,
): TransactionInstruction {
  const [community] = communityPda(programId, params.communityId);

  return new TransactionInstruction({
    programId,
    // Account order matches InitializeCommunity in the Rust program.
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: community, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.initializeCommunity,
      encodeFixed32(deriveOnChainId('community', params.communityId)),
      encodeFixed32(params.authority.toBytes()),
      encodeFixed32(params.nameHash),
    ]),
  });
}

export interface CreatePermissionParams {
  communityId: string;
  permissionId: string;
  grantee: PublicKey;
  /** Free-text purpose from the access request. Hashed, never sent in the clear. */
  purpose: string;
  /** Off-chain dataset id. Hashed, never sent in the clear. */
  resourceId: string;
  /** 64-char hex SHA-256 of the canonical permission JSON. */
  policyHash: string;
  /** Unix seconds. Must be in the future; the program rejects the past. */
  expiresAt: number;
}

/**
 * Anchor an approved permission.
 *
 * `purpose` and `resourceId` are hashed here rather than passed through, so the
 * transaction contains no free text and no dataset identifier — matching the
 * program's rule that it stores hashes only.
 */
export function buildCreatePermission(
  programId: PublicKey,
  payer: PublicKey,
  authority: PublicKey,
  params: CreatePermissionParams,
): TransactionInstruction {
  const [community] = communityPda(programId, params.communityId);
  const [permission] = permissionPda(
    programId,
    params.communityId,
    params.permissionId,
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: community, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: permission, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.createPermission,
      encodeFixed32(deriveOnChainId('permission', params.permissionId)),
      encodeFixed32(params.grantee.toBytes()),
      encodeFixed32(deriveOnChainId('purpose', params.purpose)),
      encodeFixed32(deriveOnChainId('resource', params.resourceId)),
      encodeFixed32(decodeHexHash(params.policyHash, 'policyHash')),
      encodeI64(params.expiresAt),
    ]),
  });
}

export interface RevokePermissionParams {
  /** Off-chain community id, used to derive the community account. */
  communityId: string;
  /** Raw 32-byte community id read from the permission account. */
  permissionCommunityId: Uint8Array;
  /** Raw 32-byte permission id read from the permission account. */
  permissionId: Uint8Array;
  /** The permission account being revoked. */
  permissionAccount: PublicKey;
  /** 64-char hex policy hash, kept in the instruction for auditability. */
  policyHash: string;
}

/**
 * Withdraw a permission.
 *
 * All three accounts are required even though the community account is only
 * read for its authority key: the program's account struct declares it, and
 * Anchor matches accounts positionally, so omitting it would shift the
 * authority and permission into the wrong slots and fail the signature check.
 */
export function buildRevokePermission(
  programId: PublicKey,
  authority: PublicKey,
  params: RevokePermissionParams,
): TransactionInstruction {
  const [community] = communityPda(programId, params.communityId);

  return new TransactionInstruction({
    programId,
    // Account order matches RevokePermission in the Rust program.
    keys: [
      { pubkey: community, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: params.permissionAccount, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.revokePermission,
      encodeFixed32(decodeHexHash(params.policyHash, 'policyHash')),
    ]),
  });
}

export interface RecordGovernanceDecisionParams {
  communityId: string;
  eventId: string;
  /** 64-char hex SHA-256 of the canonical decision payload. */
  decisionHash: string;
  outcome: DecisionOutcome;
}

export function buildRecordGovernanceDecision(
  programId: PublicKey,
  payer: PublicKey,
  authority: PublicKey,
  params: RecordGovernanceDecisionParams,
): TransactionInstruction {
  const [community] = communityPda(programId, params.communityId);
  const [event] = eventPda(programId, params.communityId, params.eventId);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: community, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: event, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.recordGovernanceDecision,
      encodeFixed32(deriveOnChainId('event', params.eventId)),
      encodeFixed32(decodeHexHash(params.decisionHash, 'decisionHash')),
      encodeEnum(
        params.outcome,
        [DecisionOutcome.Approved, DecisionOutcome.Rejected],
        'DecisionOutcome',
      ),
    ]),
  });
}

/**
 * The rules parameters every version shares. Kept as one interface because the
 * program takes them as one argument block on both `initialize_ruleset` and
 * `propose_ruleset`, so a rule change and a genesis differ only in version and
 * predecessor.
 */
export interface RuleSetParams {
  /** Monotonic. 1 for genesis, then exactly active + 1. */
  version: number;
  /** 64-char hex SHA-256 of the canonical off-chain ruleset JSON. */
  rulesHash: string;
  /** Approval threshold in basis points. 6000 = 60%. */
  thresholdBps: number;
  /** Participation floor in basis points. Must not exceed `thresholdBps`. */
  quorumBps: number;
  /** Active member count at which handover is due. 0 means never. */
  minActiveMembers: number;
}

/**
 * Encode the rules payload shared by initialize and propose.
 *
 * The order here must match the Rust argument list exactly. Borsh is
 * positional, so reordering these silently writes `quorum_bps` where
 * `min_active_members` belongs and the program would accept a rule nobody wrote.
 */
function encodeRuleSetArgs(params: RuleSetParams): Buffer[] {
  return [
    encodeU32(params.version),
    encodeFixed32(decodeHexHash(params.rulesHash, 'rulesHash')),
    encodeU16(params.thresholdBps),
    encodeU16(params.quorumBps),
    encodeU32(params.minActiveMembers),
  ];
}

export interface InitializeRuleSetParams extends RuleSetParams {
  communityId: string;
}

/**
 * Anchor a community's genesis ruleset and make it the version in force.
 *
 * Creates both accounts: the version itself and the `ActiveRules` pointer. This
 * is the only instruction that can establish version 1, and it does both halves
 * atomically, so a community cannot end up with a live pointer to no rules.
 */
export function buildInitializeRuleset(
  programId: PublicKey,
  payer: PublicKey,
  authority: PublicKey,
  params: InitializeRuleSetParams,
): TransactionInstruction {
  const communityIdHash = deriveOnChainId('community', params.communityId);
  const [community] = communityPda(programId, params.communityId);
  const [ruleset] = ruleSetPda(programId, params.communityId, params.version);
  const [activeRules] = activeRulesPda(programId, params.communityId);

  return new TransactionInstruction({
    programId,
    // Account order matches InitializeRuleSet in the Rust program.
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: community, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: ruleset, isSigner: false, isWritable: true },
      { pubkey: activeRules, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.initializeRuleset,
      ...encodeRuleSetArgs(params),
    ]),
  });
}

export interface ProposeRuleSetParams extends RuleSetParams {
  communityId: string;
}

/**
 * Create the next version without activating it.
 *
 * Deliberately does not touch `ActiveRules`. Splitting propose from activate is
 * what lets a version be written under one mode and take effect under another,
 * and it means a proposed-but-rejected version leaves a record of the attempt
 * rather than never existing.
 */
export function buildProposeRuleset(
  programId: PublicKey,
  payer: PublicKey,
  authority: PublicKey,
  params: ProposeRuleSetParams,
): TransactionInstruction {
  const [community] = communityPda(programId, params.communityId);
  const [ruleset] = ruleSetPda(programId, params.communityId, params.version);
  const [activeRules] = activeRulesPda(programId, params.communityId);

  return new TransactionInstruction({
    programId,
    // Account order matches ProposeRuleSet in the Rust program.
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: community, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: ruleset, isSigner: false, isWritable: true },
      { pubkey: activeRules, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.proposeRuleset,
      ...encodeRuleSetArgs(params),
    ]),
  });
}

export interface ActivateRuleSetParams {
  communityId: string;
  /** The proposed version to put in force. */
  version: number;
}

/**
 * Make a proposed version the one in force.
 *
 * Under shared governance the program requires `threshold_bps` of the active
 * member count as *distinct signers*. Those signers must be marked `isSigner`
 * here, which is what makes the runtime verify their signatures. They are
 * passed as plain signers rather than as typed accounts because a signature is
 * its own proof - there is no PDA per member to write to.
 *
 * The program cannot check that a signer is a *member* rather than any other
 * key; there is no on-chain membership registry. It enforces the number of
 * signatures, not their identity. See `count_distinct_approvers` in the program
 * for why that limitation is stated rather than hidden.
 */
export function buildActivateRuleset(
  programId: PublicKey,
  payer: PublicKey,
  authority: PublicKey,
  params: ActivateRuleSetParams,
  approvers: readonly PublicKey[] = [],
): TransactionInstruction {
  const [community] = communityPda(programId, params.communityId);
  const [ruleset] = ruleSetPda(programId, params.communityId, params.version);
  const [activeRules] = activeRulesPda(programId, params.communityId);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: community, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: ruleset, isSigner: false, isWritable: true },
      { pubkey: activeRules, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // The authority is already seeded into the approver set on-chain, so
      // repeating it here would only create a duplicate the program has to
      // collapse. Callers therefore pass only the other signers.
      ...approvers.map((pubkey) => ({
        pubkey,
        isSigner: true,
        isWritable: false,
      })),
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.activateRuleset,
      encodeU32(params.version),
    ]),
  });
}

export interface RecordMembershipDeltaParams {
  communityId: string;
  /**
   * Signed change in active member count.
   *
   * An `i32` rather than an absolute count so a correction is expressible as one
   * instruction; the program uses checked arithmetic and rejects a result below
   * zero, so a buggy delta cannot fabricate a large membership.
   */
  delta: number;
}

/** Report a membership change for the handover trigger. */
export function buildRecordMembershipDelta(
  programId: PublicKey,
  payer: PublicKey,
  authority: PublicKey,
  params: RecordMembershipDeltaParams,
): TransactionInstruction {
  const [community] = communityPda(programId, params.communityId);
  const [activeRules] = activeRulesPda(programId, params.communityId);

  return new TransactionInstruction({
    programId,
    // Account order matches RecordMembershipDelta in the Rust program.
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: community, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: activeRules, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.recordMembershipDelta,
      encodeI32(params.delta),
    ]),
  });
}

export interface HandoverToSharedGovernanceParams {
  communityId: string;
  /**
   * The version whose `min_active_members` is the trigger.
   *
   * Must be the version currently in force. The program rejects anything else,
   * because picking a version is picking the exit terms, and letting the creator
   * choose among their own historical thresholds would defeat the commitment.
   */
  version: number;
}

/**
 * Move a community from creator control to shared governance.
 *
 * Idempotency is deliberately absent: the program rejects a second call rather
 * than succeeding as a no-op, so the irreversible transition cannot be replayed
 * into a misleading success.
 */
export function buildHandoverToSharedGovernance(
  programId: PublicKey,
  payer: PublicKey,
  authority: PublicKey,
  params: HandoverToSharedGovernanceParams,
): TransactionInstruction {
  const [community] = communityPda(programId, params.communityId);
  const [ruleset] = ruleSetPda(programId, params.communityId, params.version);
  const [activeRules] = activeRulesPda(programId, params.communityId);

  return new TransactionInstruction({
    programId,
    // Account order matches HandoverToSharedGovernance in the Rust program.
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: community, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: ruleset, isSigner: false, isWritable: false },
      { pubkey: activeRules, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      INSTRUCTION_DISCRIMINATOR.handoverToSharedGovernance,
      encodeU32(params.version),
    ]),
  });
}
