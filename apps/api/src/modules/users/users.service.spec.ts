import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Repository, ObjectLiteral } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { CreateUserType } from './dto/create-user.dto';

type MockRepo<T extends ObjectLiteral = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

type FakeBuilder = Record<string, jest.Mock>;

/**
 * Stands in for the TypeORM repository surface UsersService touches.
 *
 * createQueryBuilder is a chainable no-op: these tests assert on the calls the
 * service makes (which columns it selects, which predicates it uses), not on
 * Postgres behaviour. The one query that genuinely needs database semantics is
 * the atomic failure counter, and that goes through `query()`.
 *
 * The builder is created once and returned alongside the repo so tests can
 * assert on it without calling createQueryBuilder a second time and getting a
 * different, unrecorded invocation.
 */
function mockRepo(): { repo: MockRepo; builder: FakeBuilder } {
  const builder: FakeBuilder = {};
  const chain = [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'order',
    'take',
    'update',
    'delete',
    'set',
    'from',
    'returning',
  ];
  for (const method of chain) {
    builder[method] = jest.fn().mockReturnValue(builder);
  }
  builder.getOne = jest.fn().mockResolvedValue(null);
  builder.getMany = jest.fn().mockResolvedValue([]);
  builder.execute = jest.fn().mockResolvedValue({ affected: 1 });

  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn().mockReturnValue(builder),
  } as MockRepo;

  return { repo, builder };
}

describe('UsersService', () => {
  let service: UsersService;
  let repo: MockRepo<User>;
  let builder: FakeBuilder;

  beforeEach(async () => {
    const created = mockRepo();
    repo = created.repo;
    builder = created.builder;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createAccount', () => {
    const account = {
      email: 'Creator@Example.com',
      passwordHash: 'scrypt$32768$8$1$aa$bb',
      displayName: 'DJ Afrobeat',
    };

    it('normalises the email before storing it', async () => {
      const saved = { id: 'uuid-1', email: 'creator@example.com' };
      repo.create!.mockReturnValue(saved);
      repo.save!.mockResolvedValue(saved);

      await service.createAccount(account);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'creator@example.com' }),
      );
    });

    it('defaults to MEMBER so registration cannot grant a role', async () => {
      repo.create!.mockReturnValue({ id: 'uuid-1' });
      repo.save!.mockResolvedValue({ id: 'uuid-1' });

      await service.createAccount(account);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userType: CreateUserType.MEMBER }),
      );
    });

    it('starts the account with no wallet and no lockout', async () => {
      repo.create!.mockReturnValue({ id: 'uuid-1' });
      repo.save!.mockResolvedValue({ id: 'uuid-1' });

      await service.createAccount(account);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          walletAddress: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      );
    });

    it('compares emails case-insensitively when checking for duplicates', async () => {
      // A plain equality check would let Creator@example.com and
      // creator@example.com register as two accounts.
      builder.getOne.mockResolvedValue(null);
      repo.create!.mockReturnValue({ id: 'uuid-1' });
      repo.save!.mockResolvedValue({ id: 'uuid-1' });

      await service.createAccount(account);

      expect(builder.where).toHaveBeenCalledWith(
        'LOWER(user.email) = LOWER(:email)',
        { email: 'creator@example.com' },
      );
    });

    it('throws ConflictException on a duplicate email', async () => {
      builder.getOne.mockResolvedValue({ id: 'existing' });

      await expect(service.createAccount(account)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findByEmailForAuth', () => {
    it('opts back into the columns the entity hides by default', async () => {
      // password_hash, failed_login_attempts and locked_until are all
      // `select: false`. Without these addSelects the login path would see a
      // null digest and reject every password, and isLocked() would always
      // report false so lockouts would never be honoured.
      builder.getOne.mockResolvedValue(null);

      await service.findByEmailForAuth('Creator@Example.com');

      expect(builder.addSelect).toHaveBeenCalledWith([
        'user.passwordHash',
        'user.failedLoginAttempts',
        'user.lockedUntil',
      ]);
    });

    it('keeps the credential out of every non-auth lookup', async () => {
      // The public /api/users routes return raw rows, so anything not listed
      // above must stay hidden by the entity. This is the guard against a
      // digest or the lockout counter being serialized to an anonymous caller.
      repo.findOne!.mockResolvedValue({ id: 'uuid-1' });
      repo.find!.mockResolvedValue([]);

      await service.findByEmailOrNull('creator@example.com');
      await service.findById('uuid-1');
      await service.findByWallet('wallet-1');
      await service.findAll();

      expect(builder.addSelect).not.toHaveBeenCalled();
      expect(repo.findOne).not.toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.anything() }),
      );
    });

    it('looks the account up case-insensitively', async () => {
      builder.getOne.mockResolvedValue(null);

      await service.findByEmailForAuth('  CREATOR@EXAMPLE.COM ');

      expect(builder.where).toHaveBeenCalledWith(
        'LOWER(user.email) = LOWER(:email)',
        { email: 'creator@example.com' },
      );
    });

    it('returns null for an unknown address', async () => {
      builder.getOne.mockResolvedValue(null);

      await expect(service.findByEmailForAuth('nobody@example.com')).resolves.toBeNull();
    });
  });

  describe('findById', () => {
    it('should return a user by id', async () => {
      const user = { id: 'uuid-1', displayName: 'Test' };
      repo.findOne!.mockResolvedValue(user);

      const result = await service.findById('uuid-1');

      expect(result).toEqual(user);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
    });

    it('should throw NotFoundException for missing user', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByWallet', () => {
    it('should return a user by wallet address', async () => {
      const user = { id: 'uuid-1', walletAddress: 'wallet_abc' };
      repo.findOne!.mockResolvedValue(user);

      const result = await service.findByWallet('wallet_abc');

      expect(result).toEqual(user);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { walletAddress: 'wallet_abc' },
      });
    });

    it('should throw NotFoundException for unknown wallet', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.findByWallet('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('findByWalletOrNull returns null rather than throwing', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.findByWalletOrNull('unknown')).resolves.toBeNull();
    });
  });

  describe('isLocked', () => {
    it('is false when no lock is set', () => {
      expect(service.isLocked({ lockedUntil: null })).toBe(false);
    });

    it('is true while the window is still open', () => {
      const lockedUntil = new Date(Date.now() + 60_000);
      expect(service.isLocked({ lockedUntil })).toBe(true);
    });

    it('is false once the window has passed', () => {
      const lockedUntil = new Date(Date.now() - 1000);
      expect(service.isLocked({ lockedUntil })).toBe(false);
    });
  });

  describe('recordFailedLogin', () => {
    it('increments and locks in one parameterised statement', async () => {
      // A read-then-write would lose increments under concurrency and the
      // lockout threshold would never trip.
      repo.query!.mockResolvedValue([
        { failed_login_attempts: 10, locked_until: new Date() },
      ]);

      const result = await service.recordFailedLogin('uuid-1', 10, 900);

      expect(result.attempts).toBe(10);
      expect(result.lockedUntil).toBeInstanceOf(Date);

      const [sql, params] = repo.query!.mock.calls[0];
      expect(sql).toMatch(/UPDATE users/i);
      expect(params).toEqual([10, '900', 'uuid-1']);
      // Values must be bound, never interpolated.
      expect(sql).not.toContain('uuid-1');
      expect(sql).not.toContain('900');
    });

    it('returns a zeroed result when the account vanished mid-request', async () => {
      repo.query!.mockResolvedValue([]);

      await expect(
        service.recordFailedLogin('uuid-gone', 10, 900),
      ).resolves.toEqual({ attempts: 0, lockedUntil: null });
    });
  });

  describe('setWalletAddress', () => {
    it('attaches the wallet to the account', async () => {
      // First findOne: is the wallet already claimed? Second: reload the
      // account to return it.
      repo.findOne!.mockResolvedValueOnce(null);
      repo.findOne!.mockResolvedValueOnce({ id: 'uuid-1', walletAddress: 'W1' });

      const result = await service.setWalletAddress('uuid-1', 'W1');

      expect(result.walletAddress).toBe('W1');
    });

    it('refuses a wallet already linked to a different account', async () => {
      // Otherwise a user could claim someone else's address and have a
      // permission anchored to a pubkey they do not control.
      repo.findOne!.mockResolvedValueOnce({ id: 'someone-else' });

      await expect(service.setWalletAddress('uuid-1', 'W1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('is idempotent when re-linking your own wallet', async () => {
      repo.findOne!.mockResolvedValueOnce({ id: 'uuid-1' });
      repo.findOne!.mockResolvedValueOnce({ id: 'uuid-1', walletAddress: 'W1' });

      await expect(service.setWalletAddress('uuid-1', 'W1')).resolves.toMatchObject({
        walletAddress: 'W1',
      });
    });
  });

  describe('findAll', () => {
    it('should return all users ordered by createdAt DESC', async () => {
      const users = [
        { id: '2', createdAt: new Date('2026-09-24') },
        { id: '1', createdAt: new Date('2026-09-23') },
      ];
      repo.find!.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toEqual(users);
      expect(repo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });
  });
});
