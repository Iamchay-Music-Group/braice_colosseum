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
  activeRulesPda,
  buildActivateRuleset,
  buildCreatePermission,
  buildHandoverToSharedGovernance,
  buildInitializeCommunity,
  buildInitializeRuleset,
  buildProposeRuleset,
  buildRecordGovernanceDecision,
  buildRecordMembershipDelta,
  buildRevokePermission,
  permissionPda,
  permissionPdaFromAccount,
  ruleSetPda,
  type ActivateRuleSetParams,
  type CreatePermissionParams,
  type HandoverToSharedGovernanceParams,
  type InitializeCommunityParams,
  type InitializeRuleSetParams,
  type ProposeRuleSetParams,
  type RecordGovernanceDecisionParams,
  type RecordMembershipDeltaParams,
  type RevokePermissionParams,
} from './transaction-builder';
import {
  AnchoredPermissionStatus,
  GovernanceProgramError,
  RuleMode,
  describeGovernanceError,
  type AnchoredActiveRules,
  type AnchoredPermission,
  type AnchoredRuleSet,
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

  /**
   * Read the community's live ruleset pointer.
   *
   * This is the account every access decision ultimately traces back to: it names
   * the version in force, and the mode that says who may change it. Returns null
   * before `initialize_ruleset` has run, which is the honest answer rather than a
   * default of "version 1, creator control" that was never written down.
   */
  async fetchActiveRules(
    communityId: string,
  ): Promise<AnchoredActiveRules | null> {
    const [address] = activeRulesPda(this.programId, communityId);
    return this.fetchAccount(address, decodeActiveRules);
  }

  /**
   * Read one ruleset version.
   *
   * Returns null for a version that was never created. Note that a version can
   * exist with `activatedAt === 0` - proposed but not in force - so callers that
   * care about which rules apply must read `fetchActiveRules` and not treat any
   * existing version as the live one.
   */
  async fetchRuleSet(
    communityId: string,
    version: number,
  ): Promise<AnchoredRuleSet | null> {
    const [address] = ruleSetPda(this.programId, communityId, version);
    return this.fetchAccount(address, decodeRuleSet);
  }

  /**
   * Whether a transaction signature is present on chain at this commitment.
   */
  async confirmSignature(signature: string): Promise<boolean> {
    const status = await this.connection.getSignatureStatuses([signature]);
    const first = status.value[0];
    return Boolean(first?.err === null && first?.confirmationStatus);
  }

  /**
   * Anchor a community's genesis ruleset as version 1 and make it live.
   *
   * Creates the version and the live pointer in one transaction, so a community
   * cannot end up pointing at no rules at all.
   */
  async initializeRuleset(params: InitializeRuleSetParams): Promise<string> {
    const ix = buildInitializeRuleset(
      this.programId,
      this.signer.publicKey,
      this.signer.publicKey,
      params,
    );
    return this.send([ix]);
  }

  /** Create the next ruleset version without activating it. */
  async proposeRuleset(params: ProposeRuleSetParams): Promise<string> {
    const ix = buildProposeRuleset(
      this.programId,
      this.signer.publicKey,
      this.signer.publicKey,
      params,
    );
    return this.send([ix]);
  }

  /**
   * Make a proposed version live.
   *
   * `approvers` are the other keys that must sign. The program requires
   * `threshold_bps` of the active member count in distinct signers under shared
   * governance, and collapses duplicates including the authority.
   *
   * The signing keypair for each approver is not held here - the caller has to
   * arrange for them to sign - so this method only builds the transaction shape
   * the caller needs, and `send` will fail with a missing-signature error naming
   * the account. That failure is correct behaviour, not a bug to paper over: it
   * means the threshold genuinely was not met.
   */
  async activateRuleset(
    params: ActivateRuleSetParams,
    approvers: readonly PublicKey[] = [],
  ): Promise<string> {
    const ix = buildActivateRuleset(
      this.programId,
      this.signer.publicKey,
      this.signer.publicKey,
      params,
      approvers,
    );
    return this.send([ix]);
  }

  /** Report a membership change, moving the on-chain handover trigger. */
  async recordMembershipDelta(
    params: RecordMembershipDeltaParams,
  ): Promise<string> {
    const ix = buildRecordMembershipDelta(
      this.programId,
      this.signer.publicKey,
      this.signer.publicKey,
      params,
    );
    return this.send([ix]);
  }

  /**
   * Move a community to shared governance.
   *
   * Irreversible and rejected on a second call, so the caller should have
   * verified the active member count first rather than treating this as
   * retry-safe.
   */
  async handoverToSharedGovernance(
    params: HandoverToSharedGovernanceParams,
  ): Promise<string> {
    const ix = buildHandoverToSharedGovernance(
      this.programId,
      this.signer.publicKey,
      this.signer.publicKey,
      params,
    );
    return this.send([ix]);
  }

  private async fetchAccount<T>(
    address: PublicKey,
    decode: (data: Buffer) => T,
  ): Promise<T | null> {
    const account = await this.connection.getAccountInfo(address, this.commitment);
    if (!account) {
      return null;
    }
    return decode(Buffer.from(account.data));
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
 * Decode a `RuleMode` byte.
 *
 * A `u8` on the wire rather than an enum tag the decoder has seen before. An
 * unrecognised value means the account was written by a program version that
 * added a mode this client does not know, and guessing the nearest one would
 * report the wrong authority structure for a community - the sort of error that
 * makes an access decision for the user.
 */
function decodeRuleMode(value: number): RuleMode {
  if (value === RuleMode.CreatorControl || value === RuleMode.SharedGovernance) {
    return value;
  }
  throw new Error(`Unknown RuleMode byte ${value}`);
}

/**
 * Decode a `RuleSet` account.
 *
 * Field order and widths must match `state::RuleSet`. The buffer is required to
 * be consumed exactly, so a field added or reordered in Rust turns into a loud
 * failure here instead of a plausible-looking `version` that is really a
 * `threshold_bps`.
 */
export function decodeRuleSet(data: Buffer): AnchoredRuleSet {
  const reader = new BorshReader(data);
  reader.expectDiscriminator(ACCOUNT_DISCRIMINATOR.ruleSet, 'RuleSet');

  const communityId = reader.fixed32();
  const version = reader.u32();
  const mode = decodeRuleMode(reader.u8());
  const thresholdBps = reader.u16();
  const quorumBps = reader.u16();
  const minActiveMembers = reader.u32();
  const rulesHash = reader.fixed32();
  const previousVersion = reader.u32();
  const createdAt = reader.i64();
  const activatedAt = reader.i64();
  const bump = reader.u8();
  reader.expectExhausted('RuleSet');

  return {
    communityId,
    version,
    mode,
    thresholdBps,
    quorumBps,
    minActiveMembers,
    rulesHash,
    previousVersion,
    createdAt,
    activatedAt,
    bump,
  };
}

/** Decode an `ActiveRules` account. Layout mirrors `state::ActiveRules`. */
export function decodeActiveRules(data: Buffer): AnchoredActiveRules {
  const reader = new BorshReader(data);
  reader.expectDiscriminator(ACCOUNT_DISCRIMINATOR.activeRules, 'ActiveRules');

  const communityId = reader.fixed32();
  const version = reader.u32();
  const mode = decodeRuleMode(reader.u8());
  const activeMemberCount = reader.u32();
  const activatedAt = reader.i64();
  const handedOverAt = reader.i64();
  const bump = reader.u8();
  reader.expectExhausted('ActiveRules');

  return {
    communityId,
    version,
    mode,
    activeMemberCount,
    activatedAt,
    handedOverAt,
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
