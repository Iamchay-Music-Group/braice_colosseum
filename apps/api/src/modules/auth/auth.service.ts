import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { parseBooleanFlag } from '../../config/configuration';
import { NonceService } from './nonce.service';
import { SignatureService } from './signature.service';
import { PasswordService, DUMMY_HASH } from './password.service';
import { UsersService } from '../users/users.service';
import { CreateUserType } from '../users/dto/create-user.dto';
import { User } from '../users/entities/user.entity';

/**
 * How a token was obtained. Recorded as a JWT claim so an audit log can tell a
 * password session from a wallet one without correlating against the login
 * table (there is no login table — JWTs are stateless).
 */
export type AuthMethod = 'pwd' | 'wallet';

export interface JwtPayload {
  sub: string;
  email: string | null;
  userType: string;
  amr: AuthMethod;
  jti: string;
  iat: number;
  exp: number;
}

export interface AuthResult {
  token: string;
  expiresIn: number;
  user: Pick<User, 'id' | 'email' | 'displayName' | 'userType' | 'walletAddress'>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly nonceService: NonceService,
    private readonly signatureService: SignatureService,
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get domain(): string {
    return this.config.get<string>('AUTH_DOMAIN', 'BRAICE');
  }

  private get nonceTtl(): number {
    return parseInt(this.config.get<string>('NONCE_TTL_SECONDS', '300'), 10);
  }

  private get jwtTtl(): number {
    return parseInt(this.config.get<string>('JWT_TTL_SECONDS', '900'), 10);
  }

  private get walletAuthEnabled(): boolean {
    // Shares the parser with loadAuthConfig so the boot-time read and the
    // runtime read cannot disagree about whether the feature is on.
    return parseBooleanFlag(this.config.get<string>('WALLET_AUTH_ENABLED'));
  }

  private get passwordMaxAttempts(): number {
    return parseInt(this.config.get<string>('PASSWORD_MAX_ATTEMPTS', '10'), 10);
  }

  private get passwordLockoutSeconds(): number {
    return parseInt(this.config.get<string>('PASSWORD_LOCKOUT_SECONDS', '900'), 10);
  }

  // ---------------------------------------------------------------------------
  // Email + password
  // ---------------------------------------------------------------------------

  /**
   * Create an account and sign the new owner in.
   *
   * Always MEMBER. A new account governs nothing and holds no permissions
   * until a community grants it a role — privilege is never inferred from
   * anything the request supplied.
   */
  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<AuthResult> {
    const existing = await this.usersService.findByEmailOrNull(input.email);
    if (existing) {
      // Thrown before the hash is computed so a duplicate lookup does not cost
      // a scrypt round, and so the message is accurate rather than a guess.
      throw new ConflictException('Email address already registered');
    }

    const passwordHash = await this.passwordService.hash(input.password);

    let user: User;
    try {
      user = await this.usersService.createAccount({
        email: input.email,
        passwordHash,
        displayName: input.displayName.trim(),
        userType: CreateUserType.MEMBER,
      });
    } catch (err) {
      // Lost a race against a concurrent registration for the same address:
      // the unique index rejected the second writer. Report the conflict
      // rather than a 500.
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('Email address already registered');
      }
      throw err;
    }

    this.logger.log(`Registered account ${user.id}`);

    return this.buildResult(user, 'pwd');
  }

  /**
   * Exchange an email + password for a JWT.
   *
   * Every failure path runs a real scrypt verification — against the stored
   * digest, or against a fixed decoy when the account does not exist. Without
   * that, "unknown email" returns in microseconds while "wrong password"
   * takes ~100ms, and the timing gap enumerates accounts.
   *
   * All rejections return the same message. Distinguishing "no such account"
   * from "wrong password" hands an attacker a free account list.
   */
  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const user = await this.usersService.findByEmailForAuth(input.email);

    if (!user) {
      await this.passwordService.verify(input.password, DUMMY_HASH);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (this.usersService.isLocked(user)) {
      // Spend the same work as a real check before rejecting, so a locked
      // account is not distinguishable by response time either.
      await this.passwordService.verify(input.password, user.passwordHash);
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await this.passwordService.verify(input.password, user.passwordHash);

    if (!ok) {
      const { attempts, lockedUntil } = await this.usersService.recordFailedLogin(
        user.id,
        this.passwordMaxAttempts,
        this.passwordLockoutSeconds,
      );

      this.logger.warn(
        `Failed password login for account ${user.id} ` +
          `(attempt ${attempts}/${this.passwordMaxAttempts}` +
          `${lockedUntil ? ', now locked' : ''})`,
      );

      throw new UnauthorizedException('Invalid email or password');
    }

    await this.usersService.recordSuccessfulLogin(user.id);

    // Opportunistic upgrade: if the configured cost was raised since this
    // digest was written, re-hash it now that we hold the plaintext. Only
    // ever moves the cost forward, so it cannot be used to weaken a hash.
    if (this.passwordService.needsRehash(user.passwordHash)) {
      const upgraded = await this.passwordService.hash(input.password);
      await this.usersService.setPasswordHash(user.id, upgraded);
    }

    this.logger.log(`Password login for account ${user.id}`);

    return this.buildResult(user, 'pwd');
  }

  /**
   * Rotate the signed-in account's password.
   *
   * Re-verifying the current password means a stolen access token alone is not
   * enough to permanently lock the real owner out.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersService.findByIdForAuth(userId);
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }

    const ok = await this.passwordService.verify(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'New password must be different from the current one',
      );
    }

    const hash = await this.passwordService.hash(newPassword);
    await this.usersService.setPasswordHash(userId, hash);

    this.logger.log(`Password changed for account ${userId}`);
  }

  // ---------------------------------------------------------------------------
  // Solana: proof of wallet ownership (not authentication)
  // ---------------------------------------------------------------------------

  /**
   * Issue a challenge a wallet must sign to be attached to the caller's
   * account.
   *
   * This is a proof-of-possession flow, not a login. The signature proves the
   * caller holds the private key; it never establishes who they are. That is
   * why it is safe to keep even though people do not sign in with a wallet.
   */
  async requestWalletChallenge(walletAddress: string) {
    if (!this.signatureService.isValidPublicKey(walletAddress)) {
      throw new BadRequestException('Invalid Solana public key');
    }

    return this.nonceService.issue(walletAddress, this.domain, this.nonceTtl);
  }

  /**
   * Attach a wallet to the caller's account once they prove they hold the key.
   *
   * The account is the caller's, taken from the verified token. Without the
   * signature check a user could claim any address, have a permission anchored
   * to a pubkey they do not control, and corrupt the on-chain audit trail.
   *
   * Nonce ordering is inherited from the sign-in flow and is load-bearing: it
   * is consumed before the signature is trusted, so one challenge cannot be
   * replayed or ground against.
   */
  async linkWallet(
    userId: string,
    input: { nonce: string; walletAddress: string; signature: string },
  ): Promise<Pick<User, 'id' | 'walletAddress'>> {
    const record = await this.nonceService.consume(input.nonce);

    if (!record) {
      throw new UnauthorizedException(
        'Challenge is invalid, already used, or expired',
      );
    }

    if (record.walletAddress !== input.walletAddress) {
      throw new UnauthorizedException('Signature does not match the challenged wallet');
    }

    const valid = this.signatureService.verify(
      record.message,
      input.signature,
      input.walletAddress,
    );

    if (!valid) {
      this.logger.warn(
        `Wallet ownership proof failed for ${input.walletAddress}`,
      );
      throw new UnauthorizedException('Signature verification failed');
    }

    const user = await this.usersService.setWalletAddress(userId, input.walletAddress);

    this.logger.log(
      `Wallet ${input.walletAddress} linked to account ${userId}`,
    );

    return { id: user.id, walletAddress: user.walletAddress };
  }

  // ---------------------------------------------------------------------------
  // Wallet sign-in (optional second credential)
  // ---------------------------------------------------------------------------

  async requestNonce(walletAddress: string) {
    this.assertWalletAuthEnabled();

    if (!this.signatureService.isValidPublicKey(walletAddress)) {
      throw new BadRequestException('Invalid Solana public key');
    }

    return this.nonceService.issue(walletAddress, this.domain, this.nonceTtl);
  }

  /**
   * Exchange a signed nonce for a JWT — only for wallets already linked to an
   * account, and only when WALLET_AUTH_ENABLED is on.
   *
   * Two behaviours changed from the pre-email-auth version of this method:
   *
   *   1. It no longer creates an account. Previously any ed25519 keypair could
   *      mint a fresh user by signing once. Now an unseen wallet is rejected,
   *      so this path cannot be used to register.
   *   2. It no longer accepts a client-supplied displayName, which was only
   *      ever used to name a newly created account.
   *
   * Everything about nonce consumption, message binding, and domain scoping is
   * unchanged.
   */
  async verifySignature(input: {
    nonce: string;
    walletAddress: string;
    signature: string;
  }): Promise<AuthResult> {
    this.assertWalletAuthEnabled();

    // The nonce is consumed BEFORE the signature is trusted for anything, so
    // it can never be retried. A wrong-wallet signature burns its nonce too,
    // which is deliberate: an attacker cannot grind signatures against one
    // challenge.
    const record = await this.nonceService.consume(input.nonce);

    if (!record) {
      throw new UnauthorizedException(
        'Nonce is invalid, already used, or expired',
      );
    }

    if (record.walletAddress !== input.walletAddress) {
      throw new UnauthorizedException('Signature does not match nonce owner');
    }

    const valid = this.signatureService.verify(
      record.message,
      input.signature,
      input.walletAddress,
    );

    if (!valid) {
      this.logger.warn(
        `Signature verification failed for ${input.walletAddress}`,
      );
      throw new UnauthorizedException('Signature verification failed');
    }

    const user = await this.usersService.findByWalletOrNull(input.walletAddress);
    if (!user) {
      // The signature was genuine, so this wallet genuinely controls its key —
      // it just is not attached to an account. Do not create one: the account
      // has to be registered with an email and a password first.
      throw new UnauthorizedException(
        'No account is linked to this wallet. Register first, then link the wallet.',
      );
    }

    return this.buildResult(user, 'wallet');
  }

  /**
   * The principal as it stands now, not as it stood at sign-in.
   *
   * Echoing the token back is wrong for any claim that describes the account
   * rather than the token. `userType` moves without the account doing anything:
   * governance promotes MEMBER to BRAND when it approves an access request, and
   * an operator can change a membership role. A token is good for
   * JWT_TTL_SECONDS, so a client reading the role off the token would show a
   * promoted user the wrong role until they happened to sign in again — and
   * would have no way to know its own view was out of date.
   *
   * So the account claims are re-read and overlaid, while the token claims are
   * passed through untouched: `sub`, `amr`, `jti`, `iat` and `exp` are facts
   * about the credential, and the database is not a better source for them than
   * the signature already verified.
   *
   * This is a correctness fix to what the client is told, not a change in what
   * the token can do. Nothing authorizes off `principal.userType`: permissions
   * key off `principal.sub` and community authority is read live from
   * `communities.operator_id`. Which is precisely why the stale value was only
   * ever a display bug — it misled the user without granting anything.
   */
  async currentPrincipal(principal: JwtPayload): Promise<JwtPayload> {
    const user = await this.usersService.findById(principal.sub);

    return {
      ...principal,
      email: user.email,
      userType: user.userType,
    };
  }

  private assertWalletAuthEnabled(): void {
    if (!this.walletAuthEnabled) {
      throw new ForbiddenException(
        'Wallet sign-in is disabled. Use POST /api/auth/login.',
      );
    }
  }

  // ---------------------------------------------------------------------------

  private async buildResult(user: User, amr: AuthMethod): Promise<AuthResult> {
    const token = await this.issueToken(user, amr);

    return {
      token,
      expiresIn: this.jwtTtl,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        userType: user.userType,
        walletAddress: user.walletAddress,
      },
    };
  }

  /**
   * Sign the access token.
   *
   * The payload carries stable identity and role only. Notably absent is
   * `walletAddress`: a token is valid for up to JWT_TTL_SECONDS, and a wallet
   * can be re-linked inside that window, so a wallet baked into the token would
   * go stale. Callers that need the current wallet read it from the database
   * (see PermissionsService.anchorPermission).
   */
  private async issueToken(user: User, amr: AuthMethod): Promise<string> {
    const issuedAt = Math.floor(Date.now() / 1000);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      userType: user.userType,
      amr,
      jti: randomUUID(),
      iat: issuedAt,
      exp: issuedAt + this.jwtTtl,
    };

    return this.jwtService.signAsync(payload);
  }

  async validateToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Postgres error code 23505 — unique violation.
   *
   * Checked by code rather than by driver-specific message text so it stays
   * correct across pg versions.
   */
  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === '23505'
    );
  }
}
