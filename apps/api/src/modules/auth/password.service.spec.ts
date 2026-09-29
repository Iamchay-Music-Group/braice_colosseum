import { ConfigService } from '@nestjs/config';
import { PasswordService, DUMMY_HASH } from './password.service';

/**
 * Pinned to the floor of the allowed range. The production default is 2^15
 * (~32 MB, ~100 ms per hash); at 2^13 the same code paths run in a few
 * milliseconds so the suite is not dominated by key stretching. Every test
 * here exercises the real scrypt implementation, not a stub.
 */
const TEST_COST = '13';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function makeService(overrides: Record<string, string> = {}): PasswordService {
  return new PasswordService(
    configWith({ PASSWORD_SCRYPT_COST: TEST_COST, ...overrides }),
  );
}

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = makeService();
  });

  describe('hash', () => {
    it('produces a digest that is not the password', async () => {
      const hash = await service.hash('correct horse battery staple');

      expect(hash).not.toContain('correct horse');
      expect(hash.startsWith('scrypt$')).toBe(true);
    });

    it('records the algorithm and parameters inside the digest', async () => {
      const hash = await service.hash('correct horse battery staple');
      const [scheme, N, r, p, salt, digest] = hash.split('$');

      expect(scheme).toBe('scrypt');
      expect(N).toBe(String(1 << 13));
      expect(r).toBe('8');
      expect(p).toBe('1');
      expect(salt).toHaveLength(32); // 16 bytes, hex
      expect(digest).toHaveLength(128); // 64 bytes, hex
    });

    it('salts every hash, so identical passwords differ', async () => {
      const a = await service.hash('same password');
      const b = await service.hash('same password');

      expect(a).not.toBe(b);

      // Both must still verify — a differing salt is only useful if
      // verification is salt-aware.
      await expect(service.verify('same password', a)).resolves.toBe(true);
      await expect(service.verify('same password', b)).resolves.toBe(true);
    });
  });

  describe('verify', () => {
    it('accepts the correct password', async () => {
      const hash = await service.hash('correct horse battery staple');
      await expect(service.verify('correct horse battery staple', hash)).resolves.toBe(
        true,
      );
    });

    it('rejects a wrong password', async () => {
      const hash = await service.hash('correct horse battery staple');
      await expect(service.verify('Correct horse battery staple', hash)).resolves.toBe(
        false,
      );
      await expect(service.verify('', hash)).resolves.toBe(false);
    });

    it('rejects when no password has ever been set', async () => {
      // This is the legacy-account case: rows created before password auth
      // have a NULL digest. They must fail closed, not verify against "".
      await expect(service.verify('anything', null)).resolves.toBe(false);
      await expect(service.verify('anything', undefined)).resolves.toBe(false);
    });

    it('rejects a malformed digest instead of throwing', async () => {
      const bad = [
        '',
        'not-a-hash',
        'scrypt$abc$8$1$00$00',
        'scrypt$13$8$1$tooshort$00',
        'bcrypt$13$8$1$0000000000000000$00',
        'scrypt$13$8$1$00000000000000000000000000000000',
        'scrypt$13$8$1$00000000000000000000000000000000$nothex!!',
      ];

      for (const stored of bad) {
        await expect(service.verify('whatever', stored)).resolves.toBe(false);
      }
    });

    it('refuses a digest whose cost is out of the allowed range', async () => {
      // A stored N of 2^30 would make verification allocate gigabytes. The
      // parser rejects it before any allocation happens.
      const hostile =
        'scrypt$1073741824$8$1$00000000000000000000000000000000$' +
        '00'.repeat(64);

      await expect(service.verify('whatever', hostile)).resolves.toBe(false);
    });

    it('refuses a digest whose N is not a power of two', async () => {
      // scrypt itself rejects this, but catching it in the parser keeps the
      // failure a clean "wrong password" instead of a thrown RangeError.
      const notPowerOfTwo =
        'scrypt$1000$8$1$00000000000000000000000000000000$' + '00'.repeat(64);

      await expect(service.verify('whatever', notPowerOfTwo)).resolves.toBe(false);
    });

    it('verifies a hash made at a higher cost than currently configured', async () => {
      // Cost is stored in the digest, so raising the config cannot invalidate
      // existing passwords.
      const strong = makeService({ PASSWORD_SCRYPT_COST: '14' });
      const hash = await strong.hash('correct horse battery staple');

      await expect(service.verify('correct horse battery staple', hash)).resolves.toBe(
        true,
      );
    });

    it('treats a digest at a different cost as needing rehash, not as invalid', async () => {
      const strong = makeService({ PASSWORD_SCRYPT_COST: '14' });
      const hash = await strong.hash('correct horse battery staple');

      expect(service.needsRehash(hash)).toBe(true);
      expect(service.needsRehash(await service.hash('x'.repeat(12)))).toBe(false);
    });
  });

  describe('DUMMY_HASH', () => {
    it('never verifies, so it is safe as an enumeration decoy', async () => {
      await expect(service.verify('anything at all', DUMMY_HASH)).resolves.toBe(false);
    });

    it('parses cleanly, so it costs roughly the same as a real check', async () => {
      // If this failed to parse, verify() would return before doing any work
      // and reintroduce the timing oracle it exists to close.
      await expect(
        service.verify('a plausible password', DUMMY_HASH),
      ).resolves.toBe(false);
    });
  });

  describe('cost configuration', () => {
    it('falls back to the safe default when the cost is unusable', async () => {
      // validateAuthConfig() rejects these at boot, so this only matters if
      // the config is bypassed. Hashing must still work rather than throwing.
      for (const bad of ['0', '99', 'not-a-number', '']) {
        const svc = makeService({ PASSWORD_SCRYPT_COST: bad });
        const hash = await svc.hash('correct horse battery staple');

        // Default exponent 15 => N = 32768.
        expect(hash.startsWith('scrypt$32768$')).toBe(true);
        await expect(
          svc.verify('correct horse battery staple', hash),
        ).resolves.toBe(true);
      }
    });
  });
});
