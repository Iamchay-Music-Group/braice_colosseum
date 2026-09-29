/**
 * Environment configuration.
 *
 * Values are read with defaults suitable for local development. Anything
 * security-sensitive (JWT_SECRET) has no usable default and must be set
 * explicitly — see validateAuthConfig() below.
 *
 * Two separate concerns live here and must not be confused:
 *
 *   - Account authentication: email + password, signed JWTs. This is the only
 *     way a person signs in to BRAICE.
 *   - On-chain anchoring: Solana, used to make governance grants tamper
 *     evident. Never an authority (see blockchain.service.ts).
 *
 * A user's Solana wallet is an OPTIONAL account attribute. It is used solely as
 * the on-chain grantee pubkey when a permission is anchored. Holding one grants
 * no access and confers no role.
 */

export interface AuthConfig {
  jwtSecret: string;
  jwtTtlSeconds: number;
  nonceTtlSeconds: number;
  domain: string;
  walletAuthEnabled: boolean;
  passwordMaxAttempts: number;
  passwordLockoutSeconds: number;
  passwordScryptCost: number;
}

export interface SolanaConfig {
  rpcUrl: string;
  programId: string;
  commitment: string;
  keypairPath: string;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  frontendUrl: string;
}

/**
 * Parse a boolean-ish environment string.
 *
 * Only 'true' or '1' enables a feature. Surrounding whitespace and letter case
 * are ignored, because `WALLET_AUTH_ENABLED = true ` in a .env file is a
 * formatting slip, not an intent to disable a feature. Anything else — a typo
 * like 'yes' or 'on' — leaves it off. Failing closed matters for a security
 * toggle: a mis-parse must never silently turn one on.
 *
 * Exported because AuthService reads the same flag and the two must not
 * disagree about what "enabled" means.
 */
export function parseBooleanFlag(
  raw: string | undefined,
  fallback = false,
): boolean {
  if (raw === undefined || raw === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

export function loadAuthConfig(
  get: (key: string) => string | undefined,
): AuthConfig {
  return {
    jwtSecret: get('JWT_SECRET') ?? '',
    jwtTtlSeconds: parseInt(get('JWT_TTL_SECONDS') ?? '900', 10),
    nonceTtlSeconds: parseInt(get('NONCE_TTL_SECONDS') ?? '300', 10),
    domain: get('AUTH_DOMAIN') ?? 'BRAICE',
    // Off by default: wallet sign-in is an optional convenience for accounts
    // that have linked a wallet. Email + password is always the primary path.
    walletAuthEnabled: parseBooleanFlag(get('WALLET_AUTH_ENABLED')),
    passwordMaxAttempts: parseInt(get('PASSWORD_MAX_ATTEMPTS') ?? '10', 10),
    passwordLockoutSeconds: parseInt(
      get('PASSWORD_LOCKOUT_SECONDS') ?? '900',
      10,
    ),
    // scrypt CPU cost as a power of two: 2^15 => N = 32768 (~32 MB working
    // set). Lower it in CI so the test suite is not dominated by hashing.
    passwordScryptCost: parseInt(get('PASSWORD_SCRYPT_COST') ?? '15', 10),
  };
}

export function loadSolanaConfig(
  get: (key: string) => string | undefined,
): SolanaConfig {
  return {
    rpcUrl: get('SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com',
    programId: get('SOLANA_PROGRAM_ID') ?? '',
    commitment: get('SOLANA_COMMITMENT') ?? 'confirmed',
    keypairPath: get('SOLANA_KEYPAIR_PATH') ?? '',
  };
}

export function loadAppConfig(
  get: (key: string) => string | undefined,
): AppConfig {
  return {
    nodeEnv: get('NODE_ENV') ?? 'development',
    port: parseInt(get('PORT') ?? '3001', 10),
    frontendUrl: get('FRONTEND_URL') ?? 'http://localhost:3000',
  };
}

/**
 * Fail fast on a missing or weak JWT signing key.
 *
 * A default secret would let anyone mint a token for any account, which defeats
 * the entire permission model. This throws at boot rather than silently
 * running insecure.
 */
export function validateAuthConfig(config: AuthConfig): void {
  if (!config.jwtSecret) {
    throw new Error(
      'JWT_SECRET is not set. Generate one with: openssl rand -base64 48',
    );
  }

  if (config.jwtSecret.length < 32) {
    throw new Error(
      `JWT_SECRET is too short (${config.jwtSecret.length} chars, need >= 32).`,
    );
  }

  if (config.jwtTtlSeconds <= 0) {
    throw new Error('JWT_TTL_SECONDS must be a positive integer.');
  }

  if (config.nonceTtlSeconds <= 0) {
    throw new Error('NONCE_TTL_SECONDS must be a positive integer.');
  }

  if (config.passwordMaxAttempts <= 0) {
    throw new Error('PASSWORD_MAX_ATTEMPTS must be a positive integer.');
  }

  if (config.passwordLockoutSeconds <= 0) {
    throw new Error('PASSWORD_LOCKOUT_SECONDS must be a positive integer.');
  }

  // Node rejects N > 2^31 for scrypt, and a cost below 2^13 is no longer a
  // meaningful defence against offline cracking. Refuse to boot rather than
  // silently hashing with weak parameters.
  if (
    !Number.isInteger(config.passwordScryptCost) ||
    config.passwordScryptCost < 13 ||
    config.passwordScryptCost > 18
  ) {
    throw new Error(
      'PASSWORD_SCRYPT_COST must be an integer between 13 and 18 (2^13..2^18).',
    );
  }
}
