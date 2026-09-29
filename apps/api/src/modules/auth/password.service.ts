import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCHEME = 'scrypt';
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

/**
 * Bounds on the cost EXPONENT, not on N itself.
 *
 * Configuration stores the exponent (2^15) because that is what is
 * meaningful to an operator. scrypt wants the derived N, so `2 ** exponent`
 * is applied in exactly one place — costToN() — to keep the two from drifting.
 */
const MIN_COST = 13;
const MAX_COST = 18;

/** Absolute ceiling on the memory a single hash may allocate. */
const MAX_HASH_MEMORY = 512 * 1024 * 1024;

function costToN(cost: number): number {
  return 2 ** cost;
}

/**
 * A digest that is guaranteed to verify cheaply enough to use as a decoy.
 *
 * When a login names an account that does not exist, AuthService verifies the
 * submitted password against this instead of returning early. Without it,
 * "unknown email" responds in microseconds and "wrong password" takes ~100ms,
 * which is an account-enumeration oracle.
 *
 * The parameters are pinned rather than read from config so this stays cheap
 * no matter how the real cost is tuned.
 */
export const DUMMY_HASH = (() => {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  return `${SCHEME}$${costToN(MIN_COST)}$${BLOCK_SIZE}$${PARALLELISM}$${salt}$${'0'.repeat(
    KEY_LENGTH * 2,
  )}`;
})();

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  digest: Buffer;
}

/**
 * Password hashing with scrypt from Node's core crypto module.
 *
 * Why scrypt over bcrypt/argon2: this project ships no native dependencies
 * (tweetnacl and bs58 are pure JS), and adding one would put a node-gyp or
 * prebuild download on the critical path of every install. scrypt is
 * memory-hard, in the NIST SP 800-63B recommended set, and needs no build step.
 *
 * Parameters are stored inside the digest rather than assumed, so the cost can
 * be raised later without invalidating existing passwords: each hash verifies
 * with the parameters it was created under, and re-hashing on next successful
 * login migrates it forward.
 */
@Injectable()
export class PasswordService {
  constructor(private readonly config: ConfigService) {}

  private get cost(): number {
    const configured = parseInt(
      this.config.get<string>('PASSWORD_SCRYPT_COST') ?? '15',
      10,
    );

    if (
      !Number.isInteger(configured) ||
      configured < MIN_COST ||
      configured > MAX_COST
    ) {
      // validateAuthConfig() already rejects this at boot, so reaching here
      // means the config was bypassed. Fall back to the safe default rather
      // than hashing with parameters Node would reject.
      return 15;
    }

    return configured;
  }

  /**
   * Memory ceiling for a single scrypt call, in bytes.
   *
   * Node's default maxmem is 32 MB, which is exactly the working set at
   * N = 2^15 / r = 8 (128 * N * r bytes). We allow double that as headroom and
   * clamp at MAX_HASH_MEMORY so raising the cost cannot exhaust the host.
   */
  private maxmemFor(N: number): number {
    return Math.min(128 * N * BLOCK_SIZE * 2, MAX_HASH_MEMORY);
  }

  async hash(plaintext: string): Promise<string> {
    const N = costToN(this.cost);
    const salt = randomBytes(SALT_LENGTH);
    const digest = await scrypt(plaintext.normalize('NFKC'), salt, KEY_LENGTH, {
      N,
      r: BLOCK_SIZE,
      p: PARALLELISM,
      maxmem: this.maxmemFor(N),
    });

    return [
      SCHEME,
      N,
      BLOCK_SIZE,
      PARALLELISM,
      salt.toString('hex'),
      digest.toString('hex'),
    ].join('$');
  }

  /**
   * Compare a candidate password against a stored digest.
   *
   * Returns false rather than throwing for a malformed or absent digest: an
   * account with no password set is a failed login, not a server error. This is
   * what makes legacy pre-migration rows (password_hash IS NULL) fail closed.
   */
  async verify(plaintext: string, stored: string | null | undefined): Promise<boolean> {
    if (!stored) return false;

    const parsed = this.parse(stored);
    if (!parsed) return false;

    let derived: Buffer;
    try {
      derived = await scrypt(plaintext.normalize('NFKC'), parsed.salt, KEY_LENGTH, {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p,
        maxmem: this.maxmemFor(parsed.N),
      });
    } catch {
      // A digest with absurd parameters (corrupt row, hand-edited value) must
      // not be able to crash the login path.
      return false;
    }

    if (derived.length !== parsed.digest.length) return false;

    return timingSafeEqual(derived, parsed.digest);
  }

  /**
   * True when a stored digest predates the current cost and should be upgraded.
   *
   * Callers re-hash after a successful login so raising PASSWORD_SCRYPT_COST
   * migrates the population gradually instead of all at once.
   */
  needsRehash(stored: string | null | undefined): boolean {
    if (!stored) return false;
    const parsed = this.parse(stored);
    if (!parsed) return true;
    return parsed.N !== costToN(this.cost);
  }

  private parse(stored: string): ParsedHash | null {
    const parts = stored.split('$');
    if (parts.length !== 6) return null;
    if (parts[0] !== SCHEME) return null;

    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);

    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return null;
    }
    // scrypt additionally requires N to be a power of two; rejecting anything
    // else here keeps a corrupt or hostile row from reaching the allocator.
    // The bounds are on N itself, guarding against a stored value that would
    // make us allocate unbounded memory during verification.
    if (N < costToN(MIN_COST) || N > costToN(MAX_COST)) return null;
    if ((N & (N - 1)) !== 0) return null;
    if (r < 1 || p < 1) return null;

    let salt: Buffer;
    let digest: Buffer;
    try {
      salt = Buffer.from(parts[4], 'hex');
      digest = Buffer.from(parts[5], 'hex');
    } catch {
      return null;
    }

    if (salt.length !== SALT_LENGTH) return null;
    if (digest.length !== KEY_LENGTH) return null;

    return { N, r, p, salt, digest };
  }
}
