import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { AuthNonce } from './entities/auth-nonce.entity';
import { SignatureService } from './signature.service';

export interface IssuedNonce {
  nonce: string;
  message: string;
  expiresAt: Date;
}

@Injectable()
export class NonceService {
  private readonly logger = new Logger(NonceService.name);

  constructor(
    @InjectRepository(AuthNonce)
    private readonly nonceRepo: Repository<AuthNonce>,
    private readonly signatureService: SignatureService,
  ) {}

  /**
   * Issue a single-use nonce bound to a wallet address.
   *
   * The message is persisted alongside the nonce so that verification later
   * re-checks against exactly the bytes we issued, rather than recomputing a
   * message that might have drifted.
   */
  async issue(
    walletAddress: string,
    domain: string,
    ttlSeconds: number,
  ): Promise<IssuedNonce> {
    const nonce = randomBytes(32).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);

    const message = this.signatureService.buildMessage({
      walletAddress,
      nonce,
      domain,
      issuedAt,
    });

    await this.nonceRepo.save(
      this.nonceRepo.create({
        nonce,
        walletAddress,
        message,
        expiresAt,
        consumedAt: null,
      }),
    );

    return { nonce, message, expiresAt };
  }

  /**
   * Atomically consume a nonce.
   *
   * The UPDATE ... WHERE consumed_at IS NULL form is what makes replay
   * impossible under concurrency: two simultaneous verifications of the same
   * nonce both issue an UPDATE, but Postgres serialises them, and only the
   * first sees a row transition. A read-then-write would let both succeed.
   *
   * @returns the consumed row, or null if the nonce is unknown, already used,
   *          or expired.
   */
  async consume(nonce: string): Promise<AuthNonce | null> {
    const result = await this.nonceRepo
      .createQueryBuilder()
      .update(AuthNonce)
      .set({ consumedAt: new Date() })
      .where('nonce = :nonce', { nonce })
      .andWhere('consumed_at IS NULL')
      .andWhere('expires_at > NOW()')
      .returning('*')
      .execute();

    if (!result.raw || result.raw.length === 0) {
      return null;
    }

    return this.toEntity(result.raw[0] as Record<string, unknown>);
  }

  /**
   * Map a returned row onto the entity's property names.
   *
   * `RETURNING *` yields the *column* names the driver reports — snake_case —
   * and `execute().raw` deliberately bypasses TypeORM's entity transform. A
   * bare `as AuthNonce` therefore hands callers an object whose snake_case
   * fields are silently `undefined`, so the signature gets verified against
   * `undefined` and every wallet proof fails with "signature does not match".
   * Mapping explicitly keeps the rest of the code in entity terms.
   */
  private toEntity(row: Record<string, unknown>): AuthNonce {
    return {
      nonce: row.nonce as string,
      walletAddress: row.wallet_address as string,
      message: row.message as string,
      expiresAt: row.expires_at as Date,
      consumedAt: (row.consumed_at as Date | null) ?? null,
      createdAt: row.created_at as Date,
    };
  }

  /**
   * Best-effort cleanup of nonces that can no longer be used. Safe to call on
   * a schedule; a failed prune is never fatal.
   */
  async pruneExpired(): Promise<number> {
    try {
      const result = await this.nonceRepo
        .createQueryBuilder()
        .delete()
        .from(AuthNonce)
        .where('expires_at < NOW()', {})
        .execute();

      if (result.affected && result.affected > 0) {
        this.logger.log(`Pruned ${result.affected} expired nonce(s)`);
      }
      return result.affected ?? 0;
    } catch (err) {
      this.logger.warn(`Nonce prune failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
