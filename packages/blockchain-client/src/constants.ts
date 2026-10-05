/**
 * Wire constants, mirrored from the Anchor program.
 *
 * Everything here is fixed by the deployed program. Changing a value on the
 * TypeScript side without changing the Rust (or vice versa) produces
 * transactions that fail at runtime with an opaque discriminator error, so each
 * value below is asserted in the Rust test suite and in the TypeScript tests.
 */

/**
 * Anchor instruction discriminators: the first 8 bytes of
 * `sha256("global:<instruction_name>")`.
 */
export const INSTRUCTION_DISCRIMINATOR = {
  initializeCommunity: Buffer.from([0xc8, 0x33, 0x84, 0x2c, 0xc0, 0x56, 0x7d, 0x29]),
  createPermission: Buffer.from([0xbe, 0xb6, 0x1a, 0xa4, 0x9c, 0xdd, 0x08, 0x00]),
  revokePermission: Buffer.from([0x74, 0x52, 0x21, 0xb5, 0x79, 0x90, 0xf9, 0xe3]),
  recordGovernanceDecision: Buffer.from([
    0x2e, 0x88, 0x01, 0x92, 0x17, 0x55, 0xca, 0x75,
  ]),
  initializeRuleset: Buffer.from([0x8c, 0x85, 0xad, 0x50, 0x0b, 0x58, 0xcb, 0x10]),
  proposeRuleset: Buffer.from([0x0e, 0xa2, 0x7a, 0xa9, 0xdf, 0x8c, 0x09, 0x24]),
  activateRuleset: Buffer.from([0x4a, 0x37, 0x57, 0x6f, 0x2c, 0xed, 0xfa, 0x67]),
  recordMembershipDelta: Buffer.from([
    0x27, 0x83, 0x34, 0x20, 0xe1, 0x20, 0x5d, 0x36,
  ]),
  handoverToSharedGovernance: Buffer.from([
    0xc4, 0x2d, 0x48, 0x71, 0x1f, 0x98, 0x11, 0x9d,
  ]),
} as const;

/** Account discriminators, used when decoding fetched accounts. */
export const ACCOUNT_DISCRIMINATOR = {
  communityState: Buffer.from([0x85, 0x42, 0x39, 0xeb, 0xdb, 0x94, 0x68, 0xe6]),
  permissionState: Buffer.from([0x16, 0xb7, 0x75, 0x41, 0x78, 0xc9, 0xb9, 0xec]),
  governanceEvent: Buffer.from([0x68, 0x80, 0x5f, 0x52, 0x12, 0x2c, 0x29, 0x18]),
  ruleSet: Buffer.from([0x39, 0x42, 0xcc, 0x80, 0x6a, 0x97, 0xaa, 0xf3]),
  activeRules: Buffer.from([0xfe, 0xeb, 0x5c, 0x5e, 0x46, 0x98, 0x55, 0x38]),
} as const;

/**
 * PDA seed prefixes.
 *
 * MUST match `constants::seeds` in the Rust program. These are part of the
 * program's public interface: a mismatch means a valid instruction fails its
 * seed constraint.
 */
export const SEED = {
  community: Buffer.from('community', 'utf8'),
  permission: Buffer.from('permission', 'utf8'),
  event: Buffer.from('event', 'utf8'),
  ruleset: Buffer.from('ruleset', 'utf8'),
  activeRules: Buffer.from('active_rules', 'utf8'),
} as const;

/**
 * Account sizes in bytes, including the 8-byte Anchor discriminator.
 *
 * Mirrors `constants::space` in Rust, field by field. A `fetch` that asked for
 * the wrong length would silently return a buffer that decodes to shifted
 * fields, so the decoder checks the exact size rather than parsing whatever it
 * was handed. The Rust side asserts the same arithmetic in its own test suite.
 */
export const ACCOUNT_SIZE = {
  // 8 + 32 (community_id) + 32 (authority) + 32 (name_hash)
  //   + 8 (permission_count) + 8 (decision_count) + 8 (created_at) + 1 (bump)
  communityState: 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1,
  // 8 + 32 (permission_id) + 32 (community_id) + 32 (grantee)
  //   + 32 (purpose_hash) + 32 (resource_hash) + 32 (policy_hash)
  //   + 8 (issued_at) + 8 (expires_at) + 8 (revoked_at) + 1 (status) + 1 (bump)
  permissionState:
    8 + 32 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1,
  // 8 + 32 (event_id) + 32 (community_id) + 32 (decision_hash)
  //   + 8 (decided_at) + 1 (outcome) + 1 (bump)
  governanceEvent: 8 + 32 + 32 + 32 + 8 + 1 + 1,
  // 8 + 32 (community_id) + 4 (version) + 1 (mode) + 2 (threshold_bps)
  //   + 2 (quorum_bps) + 4 (min_active_members) + 32 (rules_hash)
  //   + 4 (previous_version) + 8 (created_at) + 8 (activated_at) + 1 (bump)
  ruleSet:
    8 + 32 + 4 + 1 + 2 + 2 + 4 + 32 + 4 + 8 + 8 + 1,
  // 8 + 32 (community_id) + 4 (version) + 1 (mode) + 4 (active_member_count)
  //   + 8 (activated_at) + 8 (handed_over_at) + 1 (bump)
  activeRules: 8 + 32 + 4 + 1 + 4 + 8 + 8 + 1,
} as const;

/** Basis points: 100% is `BASIS_POINTS_MAX`, matching Rust's MAX_THRESHOLD_BPS. */
export const BASIS_POINTS_MAX = 10000;

/**
 * Namespace for deriving 32-byte on-chain ids from off-chain string ids.
 *
 * The off-chain database keys permissions and communities by UUID, but the
 * program takes `[u8; 32]`. Hashing a namespaced string maps one onto the other
 * deterministically, so an independent verifier can recompute the same id from
 * the same UUID.
 *
 * The namespace is included so that a community id and a permission id which
 * happen to share a UUID string still produce different on-chain ids, and so
 * that an id from some other system cannot be replayed as a BRAICE id.
 *
 * Bumping this string re-keys every account and orphans existing PDAs, so it is
 * versioned and must not be changed casually.
 */
export const ID_NAMESPACE = 'braice/governance/v1';

/** The kinds of off-chain id that get hashed into an on-chain id. */
export type IdKind = 'community' | 'permission' | 'resource' | 'purpose' | 'event';
