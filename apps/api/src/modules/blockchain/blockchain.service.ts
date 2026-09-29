import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey } from '@solana/web3.js';
import {
  DecisionOutcome,
  GovernanceAnchorClient,
  type Commitment,
  type SolanaClientConfig,
} from '@braice/blockchain-client';
import { loadSolanaConfig } from '../../config/configuration';
import { HashService } from './hash.service';

export interface BlockchainWriteResult {
  signature: string | null;
  recorded: boolean;
  reason?: string;
}

/**
 * On-chain anchoring for governance and permission state.
 *
 * DESIGN: every write is best-effort and never throws. The chain exists to
 * make state *verifiable*, not to be the source of truth for access control —
 * Postgres remains authoritative and the permission engine reads only from
 * Postgres. If the RPC is down, the program is undeployed, or SOLANA_PROGRAM_ID
 * is blank, BRAICE keeps enforcing permissions correctly and simply records
 * no chain reference.
 *
 * This is deliberate. A governance product that stops authorising requests
 * because a validator is unreachable would be worse than one that degrades.
 *
 * AUTHORITY: the program requires the community's on-chain authority to sign
 * every permission and decision write. This service signs with the single
 * keypair at SOLANA_KEYPAIR_PATH, so that key must BE the community authority
 * for the communities being anchored. Authorization for *who may request* an
 * anchor stays off-chain: revoking still requires the caller's verified
 * identity to match the community operator, checked in PermissionsService before
 * this class is reached.
 */
@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly config;
  private client: GovernanceAnchorClient | null = null;
  private clientInitError: string | null = null;

  constructor(
    config: ConfigService,
    private readonly hashService: HashService,
  ) {
    this.config = loadSolanaConfig((k) => config.get<string>(k));
  }

  /**
   * Whether on-chain writes are possible.
   *
   * Requires a program ID, an RPC URL, and a keypair to sign with. A program
   * ID of all-zeros or all-ones is Anchor's placeholder and is treated as
   * unset.
   */
  isEnabled(): boolean {
    const { programId, rpcUrl, keypairPath } = this.config;
    if (!programId) return false;
    if (/^1+$/.test(programId) || /^0+$/.test(programId)) return false;
    if (!rpcUrl) return false;
    if (!keypairPath) return false;
    return true;
  }

  private disabledReason(): string {
    const { programId, keypairPath } = this.config;
    if (!programId) return 'SOLANA_PROGRAM_ID is not set';
    if (/^1+$/.test(programId) || /^0+$/.test(programId)) {
      return 'SOLANA_PROGRAM_ID is still the Anchor placeholder';
    }
    if (!keypairPath) return 'SOLANA_KEYPAIR_PATH is not set';
    return 'blockchain integration is not configured';
  }

  private skip(operation: string): BlockchainWriteResult {
    this.logger.warn(
      `Skipping ${operation}: ${this.disabledReason()}. ` +
        'State remains enforceable off-chain.',
    );
    return { signature: null, recorded: false, reason: this.disabledReason() };
  }

  /**
   * Build the client once and reuse it.
   *
   * Constructing it reads the keypair from disk, so this is deferred until the
   * first write rather than done in the constructor: a deployment with
   * anchoring switched off should boot without a keyfile present.
   */
  private getClient(): GovernanceAnchorClient {
    if (this.client) {
      return this.client;
    }
    if (this.clientInitError) {
      throw new Error(this.clientInitError);
    }

    const clientConfig: SolanaClientConfig = {
      rpcUrl: this.config.rpcUrl,
      programId: this.config.programId,
      commitment: this.resolveCommitment(),
      keypairPath: this.config.keypairPath,
    };

    try {
      this.client = new GovernanceAnchorClient(clientConfig);
      this.logger.log(
        `Solana anchoring active: program ${this.client.programIdBase58}, ` +
          `authority ${this.client.authority.toBase58()}`,
      );
      return this.client;
    } catch (err) {
      // Cache the failure so a bad keypair does not re-read the disk on every
      // governance action for the life of the process.
      this.clientInitError = (err as Error).message;
      throw err;
    }
  }

  /**
   * Narrow the configured commitment to one the RPC client accepts.
   *
   * An unrecognised value falls back to 'confirmed' rather than being passed
   * through: web3.js would throw deep inside a send, and a typo in an env var
   * should not look like a chain outage.
   */
  private resolveCommitment(): Commitment {
    const configured = this.config.commitment;
    if (
      configured === 'processed' ||
      configured === 'confirmed' ||
      configured === 'finalized'
    ) {
      return configured;
    }
    this.logger.warn(
      `SOLANA_COMMITMENT="${configured}" is not a valid commitment; ` +
        'falling back to "confirmed"',
    );
    return 'confirmed';
  }

  async recordPermissionCreated(input: {
    communityId: string;
    permissionId: string;
    granteeWallet: string;
    purpose: string;
    resourceId: string;
    policyHash: string;
    expiresAt: Date;
  }): Promise<string | null> {
    if (!this.isEnabled()) {
      this.skip('create_permission');
      return null;
    }

    return this.write('create_permission', input.permissionId, () =>
      this.getClient().createPermission({
        communityId: input.communityId,
        permissionId: input.permissionId,
        grantee: new PublicKey(input.granteeWallet),
        purpose: input.purpose,
        resourceId: input.resourceId,
        policyHash: input.policyHash,
        // The program takes unix seconds; the off-chain record keeps a Date.
        expiresAt: Math.floor(input.expiresAt.getTime() / 1000),
      }),
    );
  }

  async recordPermissionRevoked(input: {
    communityId: string;
    permissionId: string;
    policyHash: string;
  }): Promise<string | null> {
    if (!this.isEnabled()) {
      this.skip('revoke_permission');
      return null;
    }

    return this.write('revoke_permission', input.permissionId, () =>
      this.getClient().revokePermission({
        communityId: input.communityId,
        permissionId: input.permissionId,
        policyHash: input.policyHash,
      }),
    );
  }

  async recordGovernanceDecision(input: {
    communityId: string;
    decisionId: string;
    outcome: DecisionOutcome;
    /** Hashed before it reaches the chain; never transmitted in the clear. */
    decisionPayload: Record<string, unknown>;
  }): Promise<string | null> {
    if (!this.isEnabled()) {
      this.skip('record_governance_decision');
      return null;
    }

    return this.write('record_governance_decision', input.decisionId, () =>
      this.getClient().recordGovernanceDecision({
        communityId: input.communityId,
        eventId: input.decisionId,
        decisionHash: this.hashService.hashCanonical(input.decisionPayload),
        outcome: input.outcome,
      }),
    );
  }

  /**
   * Perform a chain write, converting every failure into a non-fatal result.
   *
   * Never throws: an unreachable RPC must not roll back a governance decision
   * that the community has already made. The error is logged with its message
   * so an operator can tell "RPC unreachable" from "program rejected this",
   * which are very different problems.
   */
  private async write(
    instruction: string,
    entityId: string,
    send: () => Promise<string>,
  ): Promise<string | null> {
    try {
      const signature = await send();
      this.logger.log(
        `${instruction} recorded on Solana for ${entityId}: ${signature}`,
      );
      return signature;
    } catch (err) {
      this.logger.error(
        `${instruction} failed for ${entityId}: ${(err as Error).message}. ` +
          'Continuing without a chain reference.',
      );
      return null;
    }
  }
}
