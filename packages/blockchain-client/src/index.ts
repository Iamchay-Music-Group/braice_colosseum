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
  ACCOUNT_SIZE,
  BASIS_POINTS_MAX,
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
  encodeI32,
  encodeI64,
  encodeU16,
  encodeU32,
  sha256Utf8,
} from './encoding';

export {
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
  communityPda,
  eventPda,
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
  type RuleSetParams,
} from './transaction-builder';

export {
  GovernanceAnchorClient,
  decodeActiveRules,
  decodePermissionState,
  decodeRuleSet,
  extractProgramErrorCode,
  loadKeypair,
  toGovernanceError,
} from './solana-client';

export {
  AnchoredPermissionStatus,
  DecisionOutcome,
  GOVERNANCE_ERROR,
  GovernanceProgramError,
  RuleMode,
  describeGovernanceError,
  type AnchoredActiveRules,
  type AnchoredPermission,
  type AnchoredRuleSet,
  type Commitment,
  type SolanaClientConfig,
} from './types';
