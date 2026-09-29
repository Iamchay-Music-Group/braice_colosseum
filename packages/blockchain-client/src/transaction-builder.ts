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
  encodeI64,
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
