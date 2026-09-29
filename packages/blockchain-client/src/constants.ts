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
} as const;

/** Account discriminators, used when decoding fetched accounts. */
export const ACCOUNT_DISCRIMINATOR = {
  communityState: Buffer.from([0x85, 0x42, 0x39, 0xeb, 0xdb, 0x94, 0x68, 0xe6]),
  permissionState: Buffer.from([0x16, 0xb7, 0x75, 0x41, 0x78, 0xc9, 0xb9, 0xec]),
  governanceEvent: Buffer.from([0x68, 0x80, 0x5f, 0x52, 0x12, 0x2c, 0x29, 0x18]),
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
} as const;

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
