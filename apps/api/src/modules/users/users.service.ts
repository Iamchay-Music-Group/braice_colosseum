import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserType } from './dto/create-user.dto';
import { normalizeEmail } from './normalize-email';

export interface CreateAccountInput {
  email: string;
  passwordHash: string;
  displayName: string;
  /**
   * Defaults to MEMBER. Callers that need another role (seeding, an operator
   * tool) pass it explicitly; there is deliberately no HTTP route that lets a
   * caller choose their own role.
   */
  userType?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Create an account.
   *
   * The uniqueness check is a SELECT rather than a constraint violation so the
   * caller gets a clear 409 instead of a driver error. It is not the only
   * line of defence: idx_users_email_unique (migration 003) is authoritative,
   * so a race between two concurrent registrations still cannot create a
   * duplicate — the loser gets a unique-violation, which callers surface as a
   * conflict rather than a 500.
   */
  async createAccount(input: CreateAccountInput): Promise<User> {
    const email = normalizeEmail(input.email);

    const existing = await this.userRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (existing) {
      throw new ConflictException('Email address already registered');
    }

    const user = this.userRepo.create({
      email,
      displayName: input.displayName,
      userType: input.userType ?? CreateUserType.MEMBER,
      // A new account has no wallet. On-chain anchoring is skipped until the
      // user proves control of one; nothing about being wallet-less reduces
      // what they can do off-chain.
      walletAddress: null,
      passwordHash: input.passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    return this.userRepo.save(user);
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async findByWallet(walletAddress: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { walletAddress } });
    if (!user) {
      throw new NotFoundException(`User with wallet ${walletAddress} not found`);
    }
    return user;
  }

  /**
   * Like findByWallet, but returns null instead of throwing.
   */
  async findByWalletOrNull(walletAddress: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { walletAddress } });
  }

  async findByEmailOrNull(email: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', {
        email: normalizeEmail(email),
      })
      .getOne();
  }

  /**
   * Load an account for a password check, including the credential and the
   * lockout state.
   *
   * This is the only method that opts back into the `select: false` columns
   * (password_hash, failed_login_attempts, locked_until), so they are in memory
   * for exactly one call path and cannot leak through an ordinary
   * findById/findOne or a controller response.
   */
  async findByEmailForAuth(email: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('user')
      .addSelect([
        'user.passwordHash',
        'user.failedLoginAttempts',
        'user.lockedUntil',
      ])
      .where('LOWER(user.email) = LOWER(:email)', {
        email: normalizeEmail(email),
      })
      .getOne();
  }

  /**
   * Load an account by id for a password check, including the digest.
   *
   * Used by the password-change path, which knows the id (from the verified
   * token) rather than the email. Kept separate from findById so the digest is
   * only ever loaded by callers that are about to verify a password.
   */
  async findByIdForAuth(id: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
  }

  /**
   * True while the account is inside its lockout window.
   *
   * The window is read, not deleted, when it passes: clearing it lazily here
   * keeps every login path consistent without needing a background job.
   */
  isLocked(user: Pick<User, 'lockedUntil'>): boolean {
    if (!user.lockedUntil) return false;
    return user.lockedUntil.getTime() > Date.now();
  }

  /**
   * Record a failed password attempt and lock the account once the configured
   * threshold is reached.
   *
   * This is the online-guessing defence that wallet signatures did not need.
   *
   * Written as one statement rather than a read-modify-write because a
   * read-then-write loses increments under concurrency: N simultaneous guesses
   * would each read `attempts = 0` and all write `1`, so the lockout threshold
   * would never trip. The counter increment and the threshold comparison share
   * a single atomic UPDATE.
   *
   * Both SET expressions read the pre-update value of the column, so
   * `failed_login_attempts + 1` means the same thing on the left and right
   * side of the CASE. Table and column names are inlined here because Postgres
   * does not allow an alias on the left of SET; every value is a bound
   * parameter.
   */
  async recordFailedLogin(
    userId: string,
    maxAttempts: number,
    lockoutSeconds: number,
  ): Promise<{ attempts: number; lockedUntil: Date | null }> {
    const rows: Array<{ failed_login_attempts: number; locked_until: Date | null }> =
      await this.userRepo.query(
        `UPDATE users
            SET failed_login_attempts = failed_login_attempts + 1,
                locked_until = CASE
                  WHEN failed_login_attempts + 1 >= $1
                  THEN NOW() + ($2 || ' seconds')::interval
                  ELSE locked_until
                END
          WHERE id = $3
      RETURNING failed_login_attempts, locked_until`,
        [maxAttempts, String(lockoutSeconds), userId],
      );

    const row = rows[0];
    if (!row) {
      return { attempts: 0, lockedUntil: null };
    }

    return {
      attempts: Number(row.failed_login_attempts),
      lockedUntil: row.locked_until ?? null,
    };
  }

  /**
   * Clear the failure counter after a successful password check.
   *
   * Also releases an expired lock so the next attempt is not immediately
   * re-locked by a stale counter.
   */
  async recordSuccessfulLogin(userId: string): Promise<void> {
    await this.userRepo
      .createQueryBuilder()
      .update(User)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where('id = :userId', { userId })
      .execute();
  }

  /**
   * Replace the stored digest, clearing any active lockout.
   *
   * Used by registration, password change, and the cost-upgrade rehash. All
   * three want the same invariant: a known-good password is on file.
   */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.userRepo
      .createQueryBuilder()
      .update(User)
      .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null })
      .where('id = :userId', { userId })
      .execute();
  }

  /**
   * Attach a Solana wallet to an account.
   *
   * The caller must already have proven control of the private key
   * (AuthService.linkWallet). Two rules are enforced here:
   *
   *   1. A wallet belongs to exactly one account. wallet_address is UNIQUE in
   *      the schema, so this check is a friendly 409 rather than the
   *      authoritative constraint.
   *   2. Setting a wallet never touches user_type, password, or any other
   *      column. Linking a wallet is not a privilege operation.
   *
   * Returns the updated row, or throws if the wallet is already claimed.
   */
  async setWalletAddress(userId: string, walletAddress: string): Promise<User> {
    const owner = await this.userRepo.findOne({
      where: { walletAddress },
    });

    if (owner && owner.id !== userId) {
      throw new ConflictException(
        'That wallet is already linked to another account',
      );
    }

    // Targeted UPDATE rather than load-then-save: the entity does not have
    // password_hash loaded (it is select: false), and a full save() would
    // risk writing that undefined column back over a real digest.
    await this.userRepo
      .createQueryBuilder()
      .update(User)
      .set({ walletAddress })
      .where('id = :userId', { userId })
      .execute();

    return this.findById(userId);
  }

  /**
   * Set an account's role. Not exposed over HTTP.
   *
   * Roles move through governance or an operator tool, never through a field a
   * client can post to its own account. The parameter is the enum rather than
   * `string` so a typo becomes a compile error instead of a role nobody
   * recognises: the old free-text column is exactly what allowed values that
   * matched no branch.
   *
   * Promote-only in practice — callers decide what a role change means — so
   * nothing here stops a caller from demoting an account. That is the caller's
   * judgement to make, and it is why this is not a route.
   */
  async setUserType(
    userId: string,
    userType: CreateUserType,
  ): Promise<User> {
    await this.userRepo
      .createQueryBuilder()
      .update(User)
      .set({ userType })
      .where('id = :userId', { userId })
      .execute();

    return this.findById(userId);
  }

  /**
   * Accounts that have never had a password set — created by the pre-migration
   * wallet flow. They cannot log in and need a reset before they can.
   */
  async findPasswordlessAccounts(limit = 100): Promise<User[]> {
    return this.userRepo.find({
      where: { passwordHash: IsNull() },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findAll(): Promise<User[]> {
    return this.userRepo.find({ order: { createdAt: 'DESC' } });
  }
}
