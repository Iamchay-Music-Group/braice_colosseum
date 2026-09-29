import {
  AuthConfig,
  loadAuthConfig,
  loadAppConfig,
  loadSolanaConfig,
  validateAuthConfig,
} from './configuration';

function get(values: Record<string, string>) {
  return (key: string) => values[key];
}

const VALID: Record<string, string> = {
  JWT_SECRET: 'a-secret-value-that-is-at-least-32-characters',
};

describe('loadAuthConfig', () => {
  it('reads the account-auth settings from the environment', () => {
    const config = loadAuthConfig(
      get({
        ...VALID,
        JWT_TTL_SECONDS: '600',
        NONCE_TTL_SECONDS: '120',
        AUTH_DOMAIN: 'STAGING',
        WALLET_AUTH_ENABLED: 'true',
        PASSWORD_MAX_ATTEMPTS: '5',
        PASSWORD_LOCKOUT_SECONDS: '60',
        PASSWORD_SCRYPT_COST: '16',
      }),
    );

    expect(config).toEqual<AuthConfig>({
      jwtSecret: VALID.JWT_SECRET,
      jwtTtlSeconds: 600,
      nonceTtlSeconds: 120,
      domain: 'STAGING',
      walletAuthEnabled: true,
      passwordMaxAttempts: 5,
      passwordLockoutSeconds: 60,
      passwordScryptCost: 16,
    });
  });

  it('leaves wallet sign-in off unless it is explicitly enabled', () => {
    // People do not sign in to BRAICE with a wallet. This must not be a
    // default-on security control.
    expect(loadAuthConfig(get(VALID)).walletAuthEnabled).toBe(false);
  });

  it('treats a missing value the same as an explicit false', () => {
    expect(
      loadAuthConfig(get({ ...VALID, WALLET_AUTH_ENABLED: '' })).walletAuthEnabled,
    ).toBe(false);
  });

  it('fails closed on a value it does not understand', () => {
    // A typo like 'yes' or 'on' must not silently enable the feature.
    for (const value of ['yes', 'on', 'enabled', '2', 'maybe']) {
      expect(
        loadAuthConfig(get({ ...VALID, WALLET_AUTH_ENABLED: value }))
          .walletAuthEnabled,
      ).toBe(false);
    }
  });

  it('ignores surrounding whitespace and letter case', () => {
    // `WALLET_AUTH_ENABLED = true ` in a .env file is a formatting slip, not
    // an intent to disable a security control.
    for (const value of ['true', 'TRUE', ' true ', '1', ' 1 ']) {
      expect(
        loadAuthConfig(get({ ...VALID, WALLET_AUTH_ENABLED: value }))
          .walletAuthEnabled,
      ).toBe(true);
    }
  });

  it('accepts the explicit falsy spellings', () => {
    for (const value of ['false', 'FALSE', '0', ' 0 ']) {
      expect(
        loadAuthConfig(get({ ...VALID, WALLET_AUTH_ENABLED: value }))
          .walletAuthEnabled,
      ).toBe(false);
    }
  });
});

describe('validateAuthConfig', () => {
  it('accepts a well-formed configuration', () => {
    expect(() => validateAuthConfig(loadAuthConfig(get(VALID)))).not.toThrow();
  });

  it('rejects a missing JWT secret', () => {
    expect(() => validateAuthConfig(loadAuthConfig(get({})))).toThrow(
      /JWT_SECRET is not set/,
    );
  });

  it('rejects a JWT secret short enough to brute-force', () => {
    expect(() =>
      validateAuthConfig(loadAuthConfig(get({ JWT_SECRET: 'too-short' }))),
    ).toThrow(/too short/);
  });

  it('rejects non-positive lifetimes', () => {
    expect(() =>
      validateAuthConfig(loadAuthConfig(get({ ...VALID, JWT_TTL_SECONDS: '0' }))),
    ).toThrow(/JWT_TTL_SECONDS/);
    expect(() =>
      validateAuthConfig(
        loadAuthConfig(get({ ...VALID, NONCE_TTL_SECONDS: '-1' })),
      ),
    ).toThrow(/NONCE_TTL_SECONDS/);
  });

  it('rejects a lockout configuration that would never lock', () => {
    expect(() =>
      validateAuthConfig(
        loadAuthConfig(get({ ...VALID, PASSWORD_MAX_ATTEMPTS: '0' })),
      ),
    ).toThrow(/PASSWORD_MAX_ATTEMPTS/);
    expect(() =>
      validateAuthConfig(
        loadAuthConfig(get({ ...VALID, PASSWORD_LOCKOUT_SECONDS: '0' })),
      ),
    ).toThrow(/PASSWORD_LOCKOUT_SECONDS/);
  });

  it('rejects a scrypt cost outside the supported range', () => {
    // Too low is no longer a real defence; too high is at best a denial of
    // service. Refusing to boot beats hashing with junk parameters.
    for (const cost of ['12', '19', '0', '-1', 'abc']) {
      expect(() =>
        validateAuthConfig(
          loadAuthConfig(get({ ...VALID, PASSWORD_SCRYPT_COST: cost })),
        ),
      ).toThrow(/PASSWORD_SCRYPT_COST/);
    }
  });

  it('accepts costs at both ends of the range', () => {
    for (const cost of ['13', '18']) {
      expect(() =>
        validateAuthConfig(
          loadAuthConfig(get({ ...VALID, PASSWORD_SCRYPT_COST: cost })),
        ),
      ).not.toThrow();
    }
  });
});

describe('loadSolanaConfig / loadAppConfig', () => {
  it('defaults Solana to devnet with writes disabled', () => {
    const config = loadSolanaConfig(get({}));

    expect(config.rpcUrl).toContain('devnet');
    // A blank program id is what disables on-chain writes; anchoring then
    // degrades to a no-op instead of failing the request.
    expect(config.programId).toBe('');
  });

  it('reads app settings with development defaults', () => {
    expect(loadAppConfig(get({}))).toEqual({
      nodeEnv: 'development',
      port: 3001,
      frontendUrl: 'http://localhost:3000',
    });
  });
});
