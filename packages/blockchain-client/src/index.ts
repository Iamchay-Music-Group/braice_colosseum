/**
 * @braice/blockchain-client
 *
 * Writes governance decisions and permissions to the BRAICE Solana program as a
 * verifiable audit anchor, and reads them back.
 *
 * This package is not on the authorization request path. Postgres is
 * authoritative and the permission engine decides access fail-closed; the chain
 * makes those decisions provable after the fact.
 */
export {
  ACCOUNT_DISCRIMINATOR,
  ID_NAMESPACE,
  INSTRUCTION_DISCRIMINATOR,
  SEED,
  type IdKind,
} from './constants';

export {
  BorshReader,
  decodeHexHash,
  decodePubkey,
  deriveOnChainId,
  encodeEnum,
  encodeFixed32,
  encodeI64,
} from './encoding';

export {
  buildCreatePermission,
  buildInitializeCommunity,
  buildRecordGovernanceDecision,
  buildRevokePermission,
  communityPda,
  eventPda,
  permissionPda,
  permissionPdaFromAccount,
  type CreatePermissionParams,
  type InitializeCommunityParams,
  type RecordGovernanceDecisionParams,
  type RevokePermissionParams,
} from './transaction-builder';

export {
  GovernanceAnchorClient,
  decodePermissionState,
  extractProgramErrorCode,
  loadKeypair,
  toGovernanceError,
} from './solana-client';

export {
  AnchoredPermissionStatus,
  DecisionOutcome,
  GOVERNANCE_ERROR,
  GovernanceProgramError,
  describeGovernanceError,
  type AnchoredPermission,
  type Commitment,
  type SolanaClientConfig,
} from './types';
