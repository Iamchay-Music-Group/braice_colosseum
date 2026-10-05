import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { ID_NAMESPACE, type IdKind } from './constants';

/**
 * Borsh encoding for the small set of types the governance program accepts.
 *
 * Hand-rolled rather than pulled from an IDL-driven client because the
 * instruction set is four fixed instructions with primitive arguments. That
 * avoids coupling the API to a specific Anchor TS SDK version, and it keeps the
 * encoder auditable next to the Rust that has to agree with it.
 *
 * Every encoder validates its input. A silently truncated or mis-encoded
 * argument would produce a transaction that either fails opaquely on-chain or,
 * worse, succeeds while writing a different value than the caller intended.
 */

/** Encode a 32-byte value ([u8; 32] in Rust). */
export function encodeFixed32(value: Uint8Array): Buffer {
  if (value.length !== 32) {
    throw new Error(`Expected 32 bytes, received ${value.length}`);
  }
  return Buffer.from(value);
}

/**
 * Encode a signed 64-bit integer.
 *
 * Borsh writes i64 little-endian. Non-integers and values beyond
 * `Number.MAX_SAFE_INTEGER` are rejected rather than truncated: a permission
 * `expires_at` silently rounded would expire at the wrong time, which is a
 * security-relevant failure, not a cosmetic one.
 */
export function encodeI64(value: number): Buffer {
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `i64 argument must be a safe integer, received ${String(value)}`,
    );
  }
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value), 0);
  return buf;
}

/**
 * Encode an unsigned 32-bit integer.
 *
 * Borsh writes u32 little-endian. The bounds are checked rather than clipped:
 * a ruleset `version` that wrapped to zero would make the program read it as a
 * genesis version and reject the whole history, and a `min_active_members` that
 * wrapped to a huge value would satisfy the handover trigger immediately.
 */
export function encodeU32(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(
      `u32 argument must be an integer in [0, 4294967295], received ${String(value)}`,
    );
  }
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

/**
 * Encode an unsigned 16-bit integer.
 *
 * Used for basis-point thresholds. The u16 bound is what makes `threshold_bps`
 * exactly representable: 10000 fits, 10001 does not, so a value above 100% is
 * rejected at encode time instead of reaching the chain as an unsatisfiable
 * rule that could never be corrected.
 */
export function encodeU16(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(
      `u16 argument must be an integer in [0, 65535], received ${String(value)}`,
    );
  }
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

/**
 * Encode a signed 32-bit integer.
 *
 * `record_membership_delta` takes an `i32` so that a membership correction can
 * be reported as one instruction; the program uses checked arithmetic and
 * rejects a negative total.
 */
export function encodeI32(value: number): Buffer {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(
      `i32 argument must be an integer in [-2147483648, 2147483647], received ${String(value)}`,
    );
  }
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  return buf;
}

/**
 * Encode a single-variant enum.
 *
 * Rejects unknown discriminants rather than writing a value the Rust
 * `from_u8` would reject on decode, so an out-of-range outcome surfaces here
 * instead of as a corrupt account.
 */
export function encodeEnum(value: number, allowed: readonly number[], label: string): Buffer {
  if (!allowed.includes(value)) {
    throw new Error(
      `Invalid ${label} discriminant ${String(value)}; expected one of ${allowed.join(', ')}`,
    );
  }
  return Buffer.from([value]);
}

/**
 * SHA-256 of a UTF-8 string, as the raw 32 bytes the program stores.
 *
 * Plain and unnamespaced, unlike `deriveOnChainId`: this is for content that is
 * not an identifier (a community's display name, a decision payload), where the
 * point is that a verifier can recompute `sha256(name)` by hand. Namespacing it
 * would make it unrecomputable without reading this file.
 */
export function sha256Utf8(value: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(value, 'utf8').digest());
}

/**
 * Decode a base58 pubkey to its 32 raw bytes.
 */
export function decodePubkey(base58: string): Uint8Array {
  return new PublicKey(base58).toBytes();
}

/**
 * Derive the on-chain 32-byte id for an off-chain string id.
 *
 * The result is deterministic and independent of any process state, so a
 * verifier that knows the off-chain UUID and the namespace can recompute the
 * exact account address.
 */
export function deriveOnChainId(kind: IdKind, id: string): Uint8Array {
  const normalised = id.trim();
  if (normalised.length === 0) {
    throw new Error(`Cannot derive an on-chain id for an empty ${kind} id`);
  }
  return new Uint8Array(
    createHash('sha256')
      .update(`${ID_NAMESPACE}:${kind}:${normalised}`, 'utf8')
      .digest(),
  );
}

/**
 * Decode a 64-character hex SHA-256 digest into 32 bytes.
 *
 * The off-chain `policy_hash` is stored as hex by `HashService`. Anything other
 * than exactly 64 hex characters is rejected: anchoring a permission whose
 * policy hash cannot be recomputed would defeat the entire point of the anchor,
 * because there would be nothing to verify against later.
 */
export function decodeHexHash(hex: string, label: string): Uint8Array {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      `${label} must be a 64-character hex SHA-256 digest, received ${JSON.stringify(hex)}`,
    );
  }
  return new Uint8Array(Buffer.from(trimmed, 'hex'));
}

/** A cursor for reading a Borsh-serialised account buffer. */
export class BorshReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  /** Assert the account's Anchor discriminator, then skip past it. */
  expectDiscriminator(expected: Buffer, accountName: string): void {
    const actual = this.buf.subarray(0, 8);
    if (!actual.equals(expected)) {
      // No indefinite article before the type name: it would read "a ActiveRules
      // account", and a grammar bug in a diagnostic is a small sign the diagnostic
      // is not being read carefully enough to matter.
      throw new Error(
        `Not an account of type ${accountName}: discriminator ${actual.toString('hex')} ` +
          `does not match ${expected.toString('hex')}. ` +
          'The account may belong to a different program version.',
      );
    }
    this.offset = 8;
  }

  bytes(length: number): Uint8Array {
    this.assertRemaining(length);
    const out = this.buf.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new Uint8Array(out);
  }

  fixed32(): Uint8Array {
    return this.bytes(32);
  }

  u8(): number {
    this.assertRemaining(1);
    return this.buf.readUInt8(this.offset++);
  }

  u16(): number {
    this.assertRemaining(2);
    const value = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.assertRemaining(4);
    const value = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  i64(): number {
    this.assertRemaining(8);
    const value = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`i64 value ${value.toString()} exceeds the safe integer range`);
    }
    return Number(value);
  }

  /**
   * Assert the buffer was consumed exactly.
   *
   * A decoder that stops early and does not check is the one failure mode that
   * silently produces plausible wrong values: adding a field to the Rust struct
   * would leave the decoder reading the old layout, returning a `version` that
   * is really a `threshold_bps`, with no error anywhere. Requiring the offset to
   * land on the end turns layout drift into a loud failure.
   */
  expectExhausted(accountName: string): void {
    if (this.offset !== this.buf.length) {
      throw new Error(
        `Malformed ${accountName} account: ${this.buf.length - this.offset} trailing byte(s) ` +
          `after offset ${this.offset}. The account layout and the client decoder disagree.`,
      );
    }
  }

  private assertRemaining(length: number): void {
    if (this.offset + length > this.buf.length) {
      throw new Error(
        `Account buffer truncated: needed ${length} byte(s) at offset ${this.offset}, ` +
          `only ${this.buf.length - this.offset} available`,
      );
    }
  }
}
