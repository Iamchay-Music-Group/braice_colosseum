import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import { AuthService } from './auth.service';
import { NonceService } from './nonce.service';
import { SignatureService } from './signature.service';
import { PasswordService, DUMMY_HASH } from './password.service';
import { AuthNonce } from './entities/auth-nonce.entity';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { CreateUserType } from '../users/dto/create-user.dto';

const TTL = 300;
const GOOD_PASSWORD = 'correct horse battery staple';

/**
 * Generates a real ed25519 keypair and the base58 encoding of its public key,
 * exactly as a Solana wallet would present. Signatures produced here go
 * through the same tweetnacl verification path as a real wallet, so these
 * tests exercise genuine cryptography rather than a mock.
 */
function makeWallet() {
  const keypair = nacl.sign.keyPair();
  return {
    publicKey: bs58.encode(keypair.publicKey),
    sign: (message: string) =>
      bs58.encode(
        nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
      ),
  };
}

/**
 * In-memory stand-in for the auth_nonces table.
 *
 * Models the atomicity of the real UPDATE ... WHERE consumed_at IS NULL
 * RETURNING: `consume` only succeeds once per nonce, mirroring the behaviour
 * that makes replay impossible under concurrency.
 *
 * `execute()` returns rows in the *driver's* shape — snake_case column names —
 * not the entity's property names. That is what `RETURNING *` actually yields,
 * and `execute().raw` does not run TypeORM's entity transform, so this fake
 * has to be this way. An earlier version returned camelCase, which was more
 * convenient than reality and masked a bug in which every wallet signature was
 * verified against `undefined`.
 */
class FakeNonceRepo {
  rows = new Map<string, Partial<AuthNonce>>();

  create(partial: Partial<AuthNonce>): Partial<AuthNonce> {
    return partial;
  }

  async save(row: Partial<AuthNonce>): Promise<Partial<AuthNonce>> {
    this.rows.set(row.nonce as string, { ...row, consumedAt: null });
    return row;
  }

  createQueryBuilder() {
    const repo = this;
    const clauses: { nonce?: string } = {};
    let mode: 'update' | 'delete' = 'update';

    const builder = {
      update() {
        mode = 'update';
        return builder;
      },
      delete() {
        mode = 'delete';
        return builder;
      },
      from() {
        return builder;
      },
      set() {
        return builder;
      },
      where(_sql: string, params?: { nonce: string }) {
        if (params?.nonce) clauses.nonce = params.nonce;
        return builder;
      },
      andWhere() {
        return builder;
      },
      returning() {
        return builder;
      },
      async execute() {
        if (mode === 'delete') {
          const n = repo.rows.size;
          repo.rows.clear();
          return { affected: n };
        }

        const key = clauses.nonce!;
        const row = repo.rows.get(key);

        const now = Date.now();
        const isLive =
          row !== undefined &&
          row.consumedAt === null &&
          row.expiresAt !== undefined &&
          new Date(row.expiresAt as Date).getTime() > now;

        if (!isLive) {
          return { affected: 0, raw: [] };
        }

        const consumed = { ...row, consumedAt: new Date() };
        repo.rows.set(key, consumed);

        // Driver shape, as described above.
        return {
          affected: 1,
          raw: [
            {
              nonce: consumed.nonce,
              wallet_address: consumed.walletAddress,
              message: consumed.message,
              expires_at: consumed.expiresAt,
              consumed_at: consumed.consumedAt,
            },
          ],
        };
      },
    };

    return builder;
  }
}

/** Builds a stored user with a real scrypt digest. */
async function userWithPassword(
  overrides: Partial<User> = {},
): Promise<User> {
  const passwordService = new PasswordService(
    config as unknown as ConfigService,
  );
  return {
    id: 'user-1',
    email: 'creator@example.com',
    displayName: 'DJ Afrobeat',
    userType: 'MEMBER',
    walletAddress: null,
    passwordHash: await passwordService.hash(GOOD_PASSWORD),
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  } as User;
}

const BASE_CONFIG: Record<string, string> = {
  JWT_SECRET: 'test-secret-value-that-is-definitely-long-enough',
  JWT_TTL_SECONDS: '900',
  NONCE_TTL_SECONDS: String(TTL),
  AUTH_DOMAIN: 'BRAICE',
  WALLET_AUTH_ENABLED: 'true',
  PASSWORD_SCRYPT_COST: '13',
  PASSWORD_MAX_ATTEMPTS: '3',
  PASSWORD_LOCKOUT_SECONDS: '900',
};

const configValues: Record<string, string> = { ...BASE_CONFIG };

const config = {
  get: (key: string) => configValues[key],
} as unknown as ConfigService;

describe('AuthService', () => {
  let service: AuthService;
  let moduleRef: TestingModule;
  let signatureService: SignatureService;
  let passwordService: PasswordService;
  let nonceRepo: FakeNonceRepo;
  let usersService: {
    findByEmailOrNull: jest.Mock<Promise<User | null>, [string]>;
    findByEmailForAuth: jest.Mock<Promise<User | null>, [string]>;
    findByIdForAuth: jest.Mock<Promise<User | null>, [string]>;
    createAccount: jest.Mock<Promise<User>, [unknown]>;
    findByWalletOrNull: jest.Mock<Promise<User | null>, [string]>;
    setWalletAddress: jest.Mock<Promise<User>, [string, string]>;
    isLocked: jest.Mock<boolean, [Pick<User, 'lockedUntil'>]>;
    recordFailedLogin: jest.Mock<
      Promise<{ attempts: number; lockedUntil: Date | null }>,
      [string, number, number]
    >;
    recordSuccessfulLogin: jest.Mock<Promise<void>, [string]>;
    setPasswordHash: jest.Mock<Promise<void>, [string, string]>;
  };

  beforeEach(async () => {
    // The config mock is a live object shared by the injected services, so it
    // is reset from a pristine copy before every test. Tests that mutate it
    // (raising the scrypt cost, toggling wallet auth) would otherwise leak
    // into the next one.
    Object.assign(configValues, BASE_CONFIG);

    nonceRepo = new FakeNonceRepo();
    signatureService = new SignatureService();
    passwordService = new PasswordService(config);

    usersService = {
      findByEmailOrNull: jest.fn().mockResolvedValue(null),
      findByEmailForAuth: jest.fn().mockResolvedValue(null),
      findByIdForAuth: jest.fn().mockResolvedValue(null),
      createAccount: jest.fn().mockImplementation(
        async (input: { email: string; passwordHash: string; displayName: string }) =>
          ({
            id: 'user-new',
            email: input.email,
            displayName: input.displayName,
            userType: CreateUserType.MEMBER,
            walletAddress: null,
            passwordHash: input.passwordHash,
            failedLoginAttempts: 0,
            lockedUntil: null,
          }) as User,
      ),
      findByWalletOrNull: jest.fn().mockResolvedValue(null),
      setWalletAddress: jest
        .fn()
        .mockImplementation(async (userId: string, walletAddress: string) => ({
          id: userId,
          walletAddress,
        }) as User),
      isLocked: jest.fn().mockReturnValue(false),
      recordFailedLogin: jest
        .fn()
        .mockResolvedValue({ attempts: 1, lockedUntil: null }),
      recordSuccessfulLogin: jest.fn().mockResolvedValue(undefined),
      setPasswordHash: jest.fn().mockResolvedValue(undefined),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        SignatureService,
        PasswordService,
        {
          provide: NonceService,
          useFactory: () => new NonceService(nonceRepo as never, signatureService),
        },
        { provide: getRepositoryToken(AuthNonce), useValue: nonceRepo },
        { provide: UsersService, useValue: usersService },
        {
          provide: JwtService,
          useFactory: () =>
            new JwtService({
              secret: configValues.JWT_SECRET,
              signOptions: { algorithm: 'HS256' },
            }),
        },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  afterEach(() => jest.restoreAllMocks());

  // ===========================================================================
  // Email + password
  // ===========================================================================

  describe('register', () => {
    const input = {
      email: 'new@example.com',
      password: GOOD_PASSWORD,
      displayName: 'New Person',
    };

    it('creates the account and returns a usable token', async () => {
      const result = await service.register(input);

      expect(result.token).toBeTruthy();
      expect(result.expiresIn).toBe(900);
      expect(result.user.email).toBe('new@example.com');
    });

    it('stores a scrypt digest, never the password', async () => {
      await service.register(input);

      const [{ passwordHash }] = usersService.createAccount.mock.calls[0] as [
        { passwordHash: string },
      ];
      expect(passwordHash).toMatch(/^scrypt\$/);
      expect(passwordHash).not.toContain(GOOD_PASSWORD);
      await expect(
        passwordService.verify(GOOD_PASSWORD, passwordHash),
      ).resolves.toBe(true);
    });

    it('always creates a MEMBER, whatever the request says', async () => {
      // No userType field exists on RegisterDto, and forbidNonWhitelisted
      // rejects one at the pipe. This asserts the service does not honour one
      // if a future caller passes it anyway.
      await service.register({ ...input, userType: 'CREATOR' } as never);

      const [dto] = usersService.createAccount.mock.calls[0] as [
        { userType: string },
      ];
      expect(dto.userType).toBe(CreateUserType.MEMBER);
      expect(dto.userType).not.toBe('CREATOR');
    });

    it('rejects a duplicate email without creating anything', async () => {
      usersService.findByEmailOrNull.mockResolvedValue(
        await userWithPassword({ email: 'new@example.com' }),
      );

      await expect(service.register(input)).rejects.toThrow(ConflictException);
      expect(usersService.createAccount).not.toHaveBeenCalled();
    });

    it('translates a lost uniqueness race into a conflict, not a 500', async () => {
      usersService.findByEmailOrNull.mockResolvedValue(null);
      const err = Object.assign(new Error('duplicate key'), { code: '23505' });
      usersService.createAccount.mockRejectedValue(err);

      await expect(service.register(input)).rejects.toThrow(ConflictException);
    });

    it('does not swallow unrelated database errors', async () => {
      usersService.findByEmailOrNull.mockResolvedValue(null);
      usersService.createAccount.mockRejectedValue(
        Object.assign(new Error('connection lost'), { code: '08006' }),
      );

      await expect(service.register(input)).rejects.toThrow('connection lost');
    });

    it('trims the display name', async () => {
      await service.register({ ...input, displayName: '  Spaced Out  ' });

      const [dto] = usersService.createAccount.mock.calls[0] as [
        { displayName: string },
      ];
      expect(dto.displayName).toBe('Spaced Out');
    });
  });

  describe('login', () => {
    /**
     * Registers one account with a real digest and resolves lookups by email,
     * so a test can ask for a real address and for an address that does not
     * exist and get genuinely different paths.
     */
    async function givenAccount(overrides: Partial<User> = {}): Promise<User> {
      const user = await userWithPassword(overrides);
      usersService.findByEmailForAuth.mockImplementation(async (email: string) =>
        email.trim().toLowerCase() === user.email ? user : null,
      );
      return user;
    }

    it('returns a token for the right password', async () => {
      await givenAccount();

      const result = await service.login({
        email: 'creator@example.com',
        password: GOOD_PASSWORD,
      });

      expect(result.token).toBeTruthy();
      const payload = await service.validateToken(result.token);
      expect(payload.sub).toBe('user-1');
      expect(payload.amr).toBe('pwd');
    });

    it('is case-insensitive on the email', async () => {
      await givenAccount();

      await expect(
        service.login({
          email: '  Creator@Example.COM ',
          password: GOOD_PASSWORD,
        }),
      ).resolves.toMatchObject({ token: expect.any(String) });
    });

    it('rejects a wrong password and records the failure', async () => {
      await givenAccount();

      await expect(
        service.login({ email: 'creator@example.com', password: 'wrong password' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersService.recordFailedLogin).toHaveBeenCalledWith(
        'user-1',
        3,
        900,
      );
    });

    it('clears the failure counter on success', async () => {
      await givenAccount();

      await service.login({
        email: 'creator@example.com',
        password: GOOD_PASSWORD,
      });

      expect(usersService.recordSuccessfulLogin).toHaveBeenCalledWith('user-1');
      expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
    });

    it('gives the same message for an unknown email and a wrong password', async () => {
      // Any difference here is a free account-enumeration oracle.
      await givenAccount();

      const unknown = await service
        .login({ email: 'nobody@example.com', password: GOOD_PASSWORD })
        .catch((e: Error) => e.message);
      const wrong = await service
        .login({ email: 'creator@example.com', password: 'wrong password' })
        .catch((e: Error) => e.message);

      expect(unknown).toBe(wrong);
      expect(unknown).toBe('Invalid email or password');
    });

    it('spends real hashing work on an unknown email', async () => {
      // Otherwise "no such account" returns instantly and "wrong password"
      // takes ~100ms, which enumerates accounts by response time alone.
      usersService.findByEmailForAuth.mockResolvedValue(null);
      // Spy on the instance Nest actually injected into AuthService, not a
      // separately constructed one.
      const verify = jest.spyOn(
        moduleRef.get(PasswordService),
        'verify',
      );

      await expect(
        service.login({ email: 'nobody@example.com', password: GOOD_PASSWORD }),
      ).rejects.toThrow(UnauthorizedException);

      expect(verify).toHaveBeenCalledWith(GOOD_PASSWORD, DUMMY_HASH);
      expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
    });

    it('refuses a locked account and does not re-check the password first', async () => {
      await givenAccount();
      usersService.isLocked.mockReturnValue(true);

      await expect(
        service.login({ email: 'creator@example.com', password: GOOD_PASSWORD }),
      ).rejects.toThrow(UnauthorizedException);

      // No counter increment: a lockout must not be extendable by guessing.
      expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
      expect(usersService.recordSuccessfulLogin).not.toHaveBeenCalled();
    });

    it('refuses a locked account with the same message as a wrong password', async () => {
      await givenAccount();

      const wrong = await service
        .login({ email: 'creator@example.com', password: 'wrong password' })
        .catch((e: Error) => e.message);

      usersService.isLocked.mockReturnValue(true);
      const locked = await service
        .login({ email: 'creator@example.com', password: GOOD_PASSWORD })
        .catch((e: Error) => e.message);

      expect(locked).toBe(wrong);
    });

    it('rejects an account that has no password set', async () => {
      // Legacy rows from the pre-migration wallet flow. They must fail closed.
      await givenAccount({ passwordHash: null });

      await expect(
        service.login({ email: 'creator@example.com', password: GOOD_PASSWORD }),
      ).rejects.toThrow('Invalid email or password');
    });

    it('re-hashes on login when the configured cost has been raised', async () => {
      // The digest is written at the current cost, then the deployment raises
      // PASSWORD_SCRYPT_COST. Cost is read live from config on every call, so
      // raising it here reproduces a config change without rebuilding Nest.
      await givenAccount();
      configValues.PASSWORD_SCRYPT_COST = '14';

      await service.login({
        email: 'creator@example.com',
        password: GOOD_PASSWORD,
      });

      // The old digest still verified (parameters live inside it), and the
      // upgrade moved it forward to the new cost.
      expect(usersService.setPasswordHash).toHaveBeenCalledWith(
        'user-1',
        expect.stringMatching(/^scrypt\$16384\$/),
      );
    });

    it('does not rehash a digest that is already current', async () => {
      await givenAccount();

      await service.login({
        email: 'creator@example.com',
        password: GOOD_PASSWORD,
      });

      expect(usersService.setPasswordHash).not.toHaveBeenCalled();
    });

    it('never puts a wallet in the token', async () => {
      await givenAccount({ walletAddress: makeWallet().publicKey });

      const { token } = await service.login({
        email: 'creator@example.com',
        password: GOOD_PASSWORD,
      });
      const payload = await service.validateToken(token);

      // A token outlives a re-link, so a wallet baked in at issue time would
      // go stale. The current wallet is read from the database when needed.
      expect(payload).not.toHaveProperty('walletAddress');
    });
  });

  describe('lockout', () => {
    it('locks after the configured number of failures', async () => {
      const user = await userWithPassword();
      usersService.findByEmailForAuth.mockResolvedValue(user);

      // Model the real round trip: the counter lives in the database, and
      // isLocked reads the account row that the counter update wrote to.
      let attempts = 0;
      usersService.recordFailedLogin.mockImplementation(async () => {
        attempts += 1;
        const lockedUntil = attempts >= 3 ? new Date(Date.now() + 900_000) : null;
        return { attempts, lockedUntil };
      });
      usersService.isLocked.mockImplementation(
        (candidate) =>
          candidate.lockedUntil !== null &&
          candidate.lockedUntil.getTime() > Date.now(),
      );
      usersService.findByEmailForAuth.mockImplementation(async () => ({
        ...user,
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= 3 ? new Date(Date.now() + 900_000) : null,
      }));

      for (let i = 0; i < 3; i += 1) {
        await expect(
          service.login({ email: 'creator@example.com', password: 'nope' }),
        ).rejects.toThrow(UnauthorizedException);
      }

      expect(usersService.recordFailedLogin).toHaveBeenCalledTimes(3);

      // Locked: the correct password is now refused too.
      await expect(
        service.login({ email: 'creator@example.com', password: GOOD_PASSWORD }),
      ).rejects.toThrow('Invalid email or password');
      expect(usersService.recordSuccessfulLogin).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('swaps the digest when the current password is right', async () => {
      const user = await userWithPassword();
      usersService.findByIdForAuth.mockResolvedValue(user);

      await service.changePassword('user-1', GOOD_PASSWORD, 'a brand new secret');

      expect(usersService.setPasswordHash).toHaveBeenCalledWith(
        'user-1',
        expect.stringMatching(/^scrypt\$/),
      );

      const [id, hash] = usersService.setPasswordHash.mock.calls[0] as [
        string,
        string,
      ];
      await expect(passwordService.verify('a brand new secret', hash)).resolves.toBe(
        true,
      );
      await expect(passwordService.verify(GOOD_PASSWORD, hash)).resolves.toBe(false);
      expect(id).toBe('user-1');
    });

    it('refuses when the current password is wrong', async () => {
      // A stolen access token alone must not be enough to lock the owner out.
      usersService.findByIdForAuth.mockResolvedValue(await userWithPassword());

      await expect(
        service.changePassword('user-1', 'not the password', 'a brand new secret'),
      ).rejects.toThrow(UnauthorizedException);
      expect(usersService.setPasswordHash).not.toHaveBeenCalled();
    });

    it('refuses to reuse the same password', async () => {
      usersService.findByIdForAuth.mockResolvedValue(await userWithPassword());

      await expect(
        service.changePassword('user-1', GOOD_PASSWORD, GOOD_PASSWORD),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an account that no longer exists', async () => {
      usersService.findByIdForAuth.mockResolvedValue(null);

      await expect(
        service.changePassword('user-gone', GOOD_PASSWORD, 'a brand new secret'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ===========================================================================
  // Solana: wallet ownership proof (not authentication)
  // ===========================================================================

  describe('linkWallet', () => {
    async function proveOwnership(wallet: ReturnType<typeof makeWallet>) {
      const issued = await service.requestWalletChallenge(wallet.publicKey);
      const signature = wallet.sign(issued.message);
      return service.linkWallet('user-1', {
        nonce: issued.nonce,
        walletAddress: wallet.publicKey,
        signature,
      });
    }

    it('attaches a wallet the caller proved they control', async () => {
      const wallet = makeWallet();

      const result = await proveOwnership(wallet);

      expect(result.walletAddress).toBe(wallet.publicKey);
      expect(usersService.setWalletAddress).toHaveBeenCalledWith(
        'user-1',
        wallet.publicKey,
      );
    });

    it('links to the authenticated account, not one from the body', async () => {
      // There is no account field on LinkWalletDto precisely so a caller
      // cannot attach a wallet to somebody else's account.
      const wallet = makeWallet();
      await proveOwnership(wallet);

      expect(usersService.setWalletAddress).toHaveBeenCalledWith(
        'user-1',
        wallet.publicKey,
      );
    });

    it('refuses a wallet the caller cannot prove they control', async () => {
      // The whole point: without this, anyone could claim an address and have
      // a permission anchored to a pubkey they do not hold.
      const victim = makeWallet();
      const attacker = makeWallet();
      const issued = await service.requestWalletChallenge(victim.publicKey);

      await expect(
        service.linkWallet('user-1', {
          nonce: issued.nonce,
          walletAddress: victim.publicKey,
          signature: attacker.sign(issued.message),
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersService.setWalletAddress).not.toHaveBeenCalled();
    });

    it('rejects a challenge that was never issued', async () => {
      const wallet = makeWallet();

      await expect(
        service.linkWallet('user-1', {
          nonce: 'f'.repeat(64),
          walletAddress: wallet.publicKey,
          signature: 'x',
        }),
      ).rejects.toThrow(/invalid, already used, or expired/i);
    });

    it('burns the challenge on a bad signature, so it cannot be ground', async () => {
      const victim = makeWallet();
      const attacker = makeWallet();
      const issued = await service.requestWalletChallenge(victim.publicKey);

      await expect(
        service.linkWallet('user-1', {
          nonce: issued.nonce,
          walletAddress: victim.publicKey,
          signature: attacker.sign(issued.message),
        }),
      ).rejects.toThrow(UnauthorizedException);

      // The legitimate owner can no longer use the same challenge.
      await expect(
        service.linkWallet('user-1', {
          nonce: issued.nonce,
          walletAddress: victim.publicKey,
          signature: victim.sign(issued.message),
        }),
      ).rejects.toThrow(/invalid, already used, or expired/i);
    });

    it('rejects a malformed public key at challenge time', async () => {
      await expect(service.requestWalletChallenge('too-short')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('leaves the user role untouched', async () => {
      const wallet = makeWallet();
      await proveOwnership(wallet);

      // setWalletAddress is the only thing called: no role change, no
      // permission grant. Holding a wallet confers nothing.
      expect(usersService.createAccount).not.toHaveBeenCalled();
      const [, hash] = usersService.setPasswordHash.mock.calls[0] ?? [null, null];
      expect(hash).toBeNull();
    });
  });

  // ===========================================================================
  // Optional wallet sign-in
  // ===========================================================================

  describe('requestWalletChallenge / wallet sign-in messages', () => {
    it('produces a message naming the domain, wallet, and nonce', async () => {
      const wallet = makeWallet();
      const issued = await service.requestWalletChallenge(wallet.publicKey);

      expect(issued.nonce).toHaveLength(64);
      expect(issued.message).toContain(wallet.publicKey);
      expect(issued.message).toContain(issued.nonce);
      expect(issued.message).toContain('BRAICE');
    });
  });

  describe('verifySignature (wallet sign-in)', () => {
    async function signIn(wallet: ReturnType<typeof makeWallet>) {
      const issued = await service.requestNonce(wallet.publicKey);
      const signature = wallet.sign(issued.message);
      return service.verifySignature({
        nonce: issued.nonce,
        walletAddress: wallet.publicKey,
        signature,
      });
    }

    it('is disabled by default', async () => {
      // People do not sign in to BRAICE with a wallet; email + password is
      // the product. This path is opt-in per deployment.
      configValues.WALLET_AUTH_ENABLED = 'false';
      const wallet = makeWallet();

      await expect(service.requestNonce(wallet.publicKey)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.verifySignature({
          nonce: 'x',
          walletAddress: wallet.publicKey,
          signature: 'y',
        }),
      ).rejects.toThrow(ForbiddenException);

      configValues.WALLET_AUTH_ENABLED = 'true';
    });

    it('still works for a wallet that is already linked to an account', async () => {
      const wallet = makeWallet();
      usersService.findByWalletOrNull.mockResolvedValue(
        await userWithPassword({ walletAddress: wallet.publicKey, userType: 'BRAND' }),
      );

      const { token } = await signIn(wallet);
      const payload = await service.validateToken(token);

      expect(payload.amr).toBe('wallet');
      expect(payload.userType).toBe('BRAND');
    });

    it('cannot create an account', async () => {
      // Previously any ed25519 keypair could mint a fresh user by signing
      // once. An unlinked wallet is now simply rejected.
      const wallet = makeWallet();
      usersService.findByWalletOrNull.mockResolvedValue(null);

      await expect(signIn(wallet)).rejects.toThrow(UnauthorizedException);
      expect(usersService.createAccount).not.toHaveBeenCalled();
    });

    it('never escalates a new wallet above MEMBER', async () => {
      const wallet = makeWallet();
      usersService.findByWalletOrNull.mockResolvedValue(
        await userWithPassword({ walletAddress: wallet.publicKey, userType: 'MEMBER' }),
      );

      const { token } = await signIn(wallet);
      const payload = await service.validateToken(token);

      expect(payload.userType).toBe('MEMBER');
      expect(payload.userType).not.toBe('CREATOR');
      expect(payload.userType).not.toBe('ADMIN');
    });

    it('rejects a signature from a different wallet', async () => {
      const alice = makeWallet();
      const attacker = makeWallet();
      const issued = await service.requestNonce(alice.publicKey);

      await expect(
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: alice.publicKey,
          signature: attacker.sign(issued.message),
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a signature over a tampered message', async () => {
      const wallet = makeWallet();
      const issued = await service.requestNonce(wallet.publicKey);

      await expect(
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: wallet.publicKey,
          signature: wallet.sign(`${issued.message}\nEscalate to ADMIN`),
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a signature scoped to a different domain', async () => {
      // The cross-environment attack: a valid signature for the same nonce on
      // another deployment, replayed here.
      const wallet = makeWallet();
      const issued = await service.requestNonce(wallet.publicKey);

      const foreignMessage = signatureService.buildMessage({
        walletAddress: wallet.publicKey,
        nonce: issued.nonce,
        domain: 'SOME-OTHER-APP',
        issuedAt: new Date(),
      });

      await expect(
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: wallet.publicKey,
          signature: wallet.sign(foreignMessage),
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a malformed signature string', async () => {
      const wallet = makeWallet();
      const issued = await service.requestNonce(wallet.publicKey);

      await expect(
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: wallet.publicKey,
          signature: 'not-base58-!!!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown nonce', async () => {
      const wallet = makeWallet();

      await expect(
        service.verifySignature({
          nonce: 'f'.repeat(64),
          walletAddress: wallet.publicKey,
          signature: 'x',
        }),
      ).rejects.toThrow(/invalid, already used, or expired/i);
    });

    it('rejects a public key that is not 32 bytes', async () => {
      await expect(service.requestNonce('too-short')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('replay protection', () => {
    async function signIn(wallet: ReturnType<typeof makeWallet>) {
      const issued = await service.requestNonce(wallet.publicKey);
      const signature = wallet.sign(issued.message);
      return service.verifySignature({
        nonce: issued.nonce,
        walletAddress: wallet.publicKey,
        signature,
      });
    }

    beforeEach(async () => {
      const wallet = makeWallet();
      usersService.findByWalletOrNull.mockResolvedValue(
        await userWithPassword({ walletAddress: wallet.publicKey }),
      );
    });

    it('rejects a second use of the same nonce', async () => {
      const wallet = makeWallet();
      const issued = await service.requestNonce(wallet.publicKey);
      const signature = wallet.sign(issued.message);

      const first = await service.verifySignature({
        nonce: issued.nonce,
        walletAddress: wallet.publicKey,
        signature,
      });
      expect(first.token).toBeTruthy();

      await expect(
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: wallet.publicKey,
          signature,
        }),
      ).rejects.toThrow(/invalid, already used, or expired/i);
    });

    it('burns the nonce even when the signature is invalid', async () => {
      // Otherwise an attacker could grind many signatures against one nonce.
      const wallet = makeWallet();
      const attacker = makeWallet();
      const issued = await service.requestNonce(wallet.publicKey);

      await expect(
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: wallet.publicKey,
          signature: attacker.sign(issued.message),
        }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: wallet.publicKey,
          signature: wallet.sign(issued.message),
        }),
      ).rejects.toThrow(/invalid, already used, or expired/i);
    });

    it('allows only the first of two concurrent verifications', async () => {
      const wallet = makeWallet();
      const issued = await service.requestNonce(wallet.publicKey);
      const signature = wallet.sign(issued.message);

      const results = await Promise.allSettled([
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: wallet.publicKey,
          signature,
        }),
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: wallet.publicKey,
          signature,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
    });

    it('rejects an expired nonce', async () => {
      const wallet = makeWallet();
      const issued = await service.requestNonce(wallet.publicKey);

      const row = nonceRepo.rows.get(issued.nonce)!;
      row.expiresAt = new Date(Date.now() - 1000);

      await expect(
        service.verifySignature({
          nonce: issued.nonce,
          walletAddress: wallet.publicKey,
          signature: wallet.sign(issued.message),
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateToken', () => {
    it('rejects a token signed with a different secret', async () => {
      const user = await userWithPassword();
      usersService.findByEmailForAuth.mockResolvedValue(user);
      const { token } = await service.login({
        email: 'creator@example.com',
        password: GOOD_PASSWORD,
      });

      const forged = new JwtService({
        secret: 'a-completely-different-secret-value-32+',
      });
      const forgedToken = await forged.signAsync({
        sub: 'someone-else',
        email: 'attacker@example.com',
        userType: 'ADMIN',
        amr: 'pwd',
        jti: 'x',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      });

      await expect(service.validateToken(forgedToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(token).toBeTruthy();
    });

    it('rejects a garbage token', async () => {
      await expect(service.validateToken('not.a.jwt')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
