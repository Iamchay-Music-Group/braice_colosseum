import { readFileSync } from 'fs';
import {
  Connection,
  Keypair,
  PublicKey,
  SendOptions,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { ACCOUNT_DISCRIMINATOR } from './constants';
import { BorshReader, deriveOnChainId } from './encoding';
import {
  buildCreatePermission,
  buildInitializeCommunity,
  buildRecordGovernanceDecision,
  buildRevokePermission,
  permissionPda,
  permissionPdaFromAccount,
  type CreatePermissionParams,
  type InitializeCommunityParams,
  type RecordGovernanceDecisionParams,
  type RevokePermissionParams,
} from './transaction-builder';
import {
  AnchoredPermissionStatus,
  GovernanceProgramError,
  describeGovernanceError,
  type AnchoredPermission,
  type SolanaClientConfig,
} from './types';

/**
 * Client for the BRAICE governance program.
 *
 * ROLE: this client writes proof to the chain and reads it back. It is never
 * consulted to decide whether a request is allowed. Access control is decided
 * off-chain by the permission engine, which reads Postgres and fails closed.
 * Keeping the chain off the request path is deliberate: an unreachable validator
 * must not be able to deny legitimate access or, worse, fail open.
 *
 * Every method here throws on failure. Deciding what to do about a failure is
 * the caller's job — the API's BlockchainService catches everything and degrades
 * to no chain reference, so a chain outage cannot roll back governance.
 */
export class GovernanceAnchorClient {
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly signer: Keypair;
  private readonly commitment: SolanaClientConfig['commitment'];

  constructor(config: SolanaClientConfig, signer?: Keypair) {
    this.programId = new PublicKey(config.programId);
    this.commitment = config.commitment;
    this.connection = new Connection(config.rpcUrl, config.commitment);
    this.signer = signer ?? loadKeypair(config.keypairPath);
  }

  /** Base58 program id, for logging and diagnostics. */
  get programIdBase58(): string {
    return this.programId.toBase58();
  }

  /** Address of the key that signs anchoring transactions. */
  get authority(): PublicKey {
    return this.signer.publicKey;
  }

  async initializeCommunity(
    params: InitializeCommunityParams,
  ): Promise<string> {
    const ix = buildInitializeCommunity(
      this.programId,
      this.signer.publicKey,
      params,
    );
    return this.send([ix]);
  }

  async createPermission(params: CreatePermissionParams): Promise<string> {
    const ix = buildCreatePermission(
      this.programId,
      this.signer.publicKey,
      this.signer.publicKey,
      params,
    );
    return this.send([ix]);
  }

  /**
   * Revoke a permission.
   *
   * The program seeds the permission account from its own stored ids, so the
   * account is located by fetching the off-chain permission's community and
   * permission ids rather than being derived from the uuid alone.
   */
  async revokePermission(params: {
    communityId: string;
    permissionId: string;
    policyHash: string;
  }): Promise<string> {
    const [permissionAccount] = permissionPda(
      this.programId,
      params.communityId,
      params.permissionId,
    );

    const onChain = await this.fetchPermission(permissionAccount);
    if (onChain) {
      // Confirm the account we are about to mutate really is the one the
      // off-chain record claims, so a stale or wrong id cannot revoke a
      // different community's permission.
      const derived = permissionPdaFromAccount(this.programId, onChain);
      if (!derived[0].equals(permissionAccount)) {
        throw new Error(
          `Permission account ${permissionAccount.toBase58()} does not match the ` +
            `ids stored inside it (${derived[0].toBase58()})`,
        );
      }
    }

    const buildParams: RevokePermissionParams = {
      communityId: params.communityId,
      permissionCommunityId: onChain
        ? onChain.communityId
        : deriveOnChainId('community', params.communityId),
      permissionId: onChain
        ? onChain.permissionId
        : deriveOnChainId('permission', params.permissionId),
      permissionAccount,
      policyHash: params.policyHash,
    };

    return this.send([buildRevokePermission(this.programId, this.signer.publicKey, buildParams)]);
  }

  async recordGovernanceDecision(
    params: RecordGovernanceDecisionParams,
  ): Promise<string> {
    const ix = buildRecordGovernanceDecision(
      this.programId,
      this.signer.publicKey,
      this.signer.publicKey,
      params,
    );
    return this.send([ix]);
  }

  /**
   * Read a permission receipt back off the chain.
   *
   * Returns null when the account does not exist, which is the normal state for
   * a permission that was never anchored. A buffer that exists but cannot be
   * decoded throws: that means the account is real but not what we expect, and
   * silently treating it as "absent" would hide a real inconsistency.
   */
  async fetchPermission(
    address: PublicKey,
  ): Promise<AnchoredPermission | null> {
    const account = await this.connection.getAccountInfo(address, this.commitment);
    if (!account) {
      return null;
    }
    return decodePermissionState(Buffer.from(account.data));
  }

  /** Whether a transaction signature is present on chain at this commitment. */
  async confirmSignature(signature: string): Promise<boolean> {
    const status = await this.connection.getSignatureStatuses([signature]);
    const first = status.value[0];
    return Boolean(first?.err === null && first?.confirmationStatus);
  }

  private async send(instructions: TransactionInstruction[]): Promise<string> {
    const transaction = new Transaction().add(...instructions);

    const options: SendOptions = {
      preflightCommitment: this.commitment,
      // Anchoring is a background integrity record, not part of the user's
      // request. Skipping preflight lets a fee-payer with no SOL still
      // produce a clear "insufficient funds" failure at send time rather than
      // an opaque simulation error.
      skipPreflight: true,
    };

    const raw = await this.connection.sendTransaction(transaction, [this.signer], options);

    const latest = await this.connection.getLatestBlockhash(this.commitment);
    const confirmation = await this.connection.confirmTransaction(
      { signature: raw, ...latest },
      this.commitment,
    );

    // confirmTransaction resolves for a transaction that was *included* even
    // when the program rejected it, so the status has to be inspected
    // explicitly. Without this a rejected write returns a signature, the API
    // stores it as blockchain_reference, and the record claims to be anchored
    // when nothing was written — the exact failure the anchor exists to catch.
    const err = confirmation.value.err;
    if (err) {
      const code = extractProgramErrorCode(err);
      if (code !== null) {
        const message =
          describeGovernanceError(code) ??
          `Governance program rejected the instruction with code ${code}`;
        throw new GovernanceProgramError(code, message);
      }
      throw new Error(
        `Solana transaction ${raw} failed: ${JSON.stringify(err)}`,
      );
    }

    return raw;
  }
}

/**
 * Pull a custom program error code out of a Solana transaction error.
 *
 * Anchor reports its errors as `Custom: <6000 + n>`, nested inside whichever
 * instruction index failed. Returns null for failures that are not one of ours
 * — a blockhash expiry or a fee problem has no program code, and reporting it
 * as one would send an operator looking in the wrong place.
 */
export function extractProgramErrorCode(err: unknown): number | null {
  if (err === null || typeof err !== 'object') {
    return null;
  }
  const record = err as Record<string, unknown>;

  // { InstructionError: [index, { Custom: 6002 }] }
  const instructionError = record.InstructionError;
  if (Array.isArray(instructionError) && instructionError.length >= 2) {
    const detail = instructionError[1];
    if (detail && typeof detail === 'object' && 'Custom' in detail) {
      const custom = (detail as { Custom: unknown }).Custom;
      return typeof custom === 'number' ? custom : null;
    }
  }

  // { Custom: 6002 } on its own, as returned by some failure paths.
  if (typeof record.Custom === 'number') {
    return record.Custom;
  }

  return null;
}

/**
 * Decode a PermissionState account.
 *
 * Field order must match `state::PermissionState`. The discriminator is
 * checked first so a buffer from a different account type fails with a clear
 * message rather than a confusing length error partway through.
 */
export function decodePermissionState(data: Buffer): AnchoredPermission {
  const reader = new BorshReader(data);
  reader.expectDiscriminator(ACCOUNT_DISCRIMINATOR.permissionState, 'PermissionState');

  const permissionId = reader.fixed32();
  const communityId = reader.fixed32();
  const grantee = reader.fixed32();
  const purposeHash = reader.fixed32();
  const resourceHash = reader.fixed32();
  const policyHash = reader.fixed32();
  const issuedAt = reader.i64();
  const expiresAt = reader.i64();
  const revokedAt = reader.i64();
  const statusByte = reader.u8();
  const bump = reader.u8();

  const status =
    statusByte === AnchoredPermissionStatus.Active
      ? AnchoredPermissionStatus.Active
      : statusByte === AnchoredPermissionStatus.Revoked
        ? AnchoredPermissionStatus.Revoked
        : (() => {
            throw new Error(`Unknown permission status byte ${statusByte}`);
          })();

  return {
    permissionId,
    communityId,
    grantee,
    purposeHash,
    resourceHash,
    policyHash,
    issuedAt,
    expiresAt,
    revokedAt,
    status,
    bump,
  };
}

/**
 * Load a signing keypair from a JSON keyfile.
 *
 * Solana's CLI writes either an array of 64 bytes or an object with a base58
 * `secretKey`; both appear in the wild, so both are accepted. A missing or
 * malformed file throws with the path included, because "anchoring disabled" is
 * far easier to diagnose when the error names the file that could not be read.
 */
export function loadKeypair(keypairPath: string): Keypair {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(keypairPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `Unable to read Solana keypair at ${keypairPath}: ${(err as Error).message}`,
    );
  }

  if (Array.isArray(parsed)) {
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  }

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    typeof (parsed as { secretKey?: unknown }).secretKey === 'string'
  ) {
    return Keypair.fromSecretKey(
      Uint8Array.from(
        Buffer.from((parsed as { secretKey: string }).secretKey, 'base64'),
      ),
    );
  }

  throw new Error(
    `Solana keypair at ${keypairPath} is not in a recognised format ` +
      '(expected a 64-byte array or an object with a base58 "secretKey")',
  );
}

/** Surface a known program error code as a typed error, else rethrow. */
export function toGovernanceError(err: unknown): unknown {
  const candidate = err as { code?: number } | null;
  const code = candidate?.code;
  if (typeof code !== 'number' || code < 6000 || code > 6100) {
    return err;
  }
  const message = describeGovernanceError(code) ?? `Program error ${code}`;
  return new GovernanceProgramError(code, message);
}
