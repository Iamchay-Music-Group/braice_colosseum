import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NonceService } from './nonce.service';
import { AuthNonce } from './entities/auth-nonce.entity';
import { SignatureService } from './signature.service';

/**
 * A row as the pg driver actually reports it.
 *
 * This fake is deliberately snake_case. `execute().raw` on an UPDATE ...
 * RETURNING gives back the *column* names, not the entity's property names, and
 * TypeORM does not transform them. An earlier version of this spec (and of
 * AuthService's) returned camelCase, which is more convenient than reality and
 * hid a bug that broke every wallet proof: the service cast the row to
 * AuthNonce, so `record.walletAddress` and `record.message` were `undefined`
 * and verification failed with "signature does not match the challenged
 * wallet". If you add a test here, keep the fake in the driver's shape.
 */
function driverRow(overrides: Record<string, unknown> = {}) {
  return {
    nonce: 'a'.repeat(64),
    wallet_address: 'J3z2xUSwxJGDfaorLcfpq754pq8KxBuFD2mA86mQCSYF',
    message: 'BRAICE wants you to sign in with your Solana wallet:\n...',
    expires_at: new Date('2026-09-29T09:00:00.000Z'),
    consumed_at: new Date('2026-09-29T08:30:00.000Z'),
    created_at: new Date('2026-09-29T08:29:00.000Z'),
    ...overrides,
  };
}

describe('NonceService', () => {
  let service: NonceService;
  let repo: { createQueryBuilder: jest.Mock; save: jest.Mock; create: jest.Mock };
  let builder: Record<string, jest.Mock>;

  beforeEach(async () => {
    builder = {};
    for (const method of [
      'update',
      'set',
      'where',
      'andWhere',
      'returning',
      'delete',
      'from',
    ]) {
      builder[method] = jest.fn().mockReturnValue(builder);
    }
    builder.execute = jest.fn().mockResolvedValue({ affected: 0, raw: [] });

    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation(async (entity) => entity),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NonceService,
        { provide: getRepositoryToken(AuthNonce), useValue: repo },
        { provide: SignatureService, useValue: { buildMessage: jest.fn() } },
      ],
    }).compile();

    service = module.get<NonceService>(NonceService);
  });

  describe('consume', () => {
    it('returns entity property names, not driver column names', async () => {
      builder.execute.mockResolvedValue({ affected: 1, raw: [driverRow()] });

      const consumed = await service.consume('a'.repeat(64));

      // These are the fields AuthService reads. If any is undefined the
      // signature is checked against undefined and the proof always fails.
      expect(consumed).not.toBeNull();
      expect(consumed!.walletAddress).toBe(
        'J3z2xUSwxJGDfaorLcfpq754pq8KxBuFD2mA86mQCSYF',
      );
      expect(consumed!.message).toContain('BRAICE wants you to sign in');
      expect(consumed!.nonce).toBe('a'.repeat(64));
      expect(consumed!.expiresAt).toBeInstanceOf(Date);
      expect(consumed!.consumedAt).toBeInstanceOf(Date);
    });

    it('returns null when the nonce was unknown, used, or expired', async () => {
      builder.execute.mockResolvedValue({ affected: 0, raw: [] });

      await expect(service.consume('missing')).resolves.toBeNull();
    });

    it('consumes atomically rather than read-then-write', async () => {
      // The predicate that makes replay impossible under concurrency: only an
      // unconsumed, unexpired row can transition, and Postgres serialises the
      // competing UPDATEs.
      builder.execute.mockResolvedValue({ affected: 1, raw: [driverRow()] });

      await service.consume('a'.repeat(64));

      expect(builder.andWhere).toHaveBeenCalledWith('consumed_at IS NULL');
      expect(builder.andWhere).toHaveBeenCalledWith('expires_at > NOW()');
    });

    it('normalises a null consumed_at instead of leaving it undefined', async () => {
      builder.execute.mockResolvedValue({
        affected: 1,
        raw: [driverRow({ consumed_at: null })],
      });

      const consumed = await service.consume('a'.repeat(64));

      expect(consumed!.consumedAt).toBeNull();
    });
  });

  describe('issue', () => {
    it('persists the exact message it returns, and binds it to the wallet', async () => {
      const built = 'signed-message-body';
      (service as any).signatureService.buildMessage = jest
        .fn()
        .mockReturnValue(built);

      const issued = await service.issue(
        'J3z2xUSwxJGDfaorLcfpq754pq8KxBuFD2mA86mQCSYF',
        'BRAICE',
        300,
      );

      expect(issued.message).toBe(built);
      expect(issued.nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Verification later re-checks against these bytes rather than
      // recomputing a message that might have drifted.
      const persisted = repo.save.mock.calls[0][0];
      expect(persisted.message).toBe(built);
      expect(persisted.walletAddress).toBe(
        'J3z2xUSwxJGDfaorLcfpq754pq8KxBuFD2mA86mQCSYF',
      );
    });
  });
});
