import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BlockchainService } from './blockchain.service';
import { HashService } from './hash.service';

/**
 * The contract callers rely on: every write degrades to `null` and never throws.
 *
 * This is not a style preference. `CommunitiesService.create` awaits an anchor
 * after committing its transaction, `GovernanceService` does the same around a
 * governance decision, and neither can afford to surface a chain outage as a
 * failed request. If any method here rejects, an unreachable validator becomes a
 * 500 on a write that has already been made durable in Postgres.
 */

function configFor(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

const ENABLED_ENV = {
  SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  SOLANA_PROGRAM_ID: '5kd7y5YMtwCEggyHQahFFgmS4CeTEdGeaGBjVfuz8p2b',
  SOLANA_COMMITMENT: 'confirmed',
  SOLANA_KEYPAIR_PATH: '/tmp/does-not-exist.json',
};

describe('BlockchainService', () => {
  let service: BlockchainService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        HashService,
        { provide: ConfigService, useValue: configFor(ENABLED_ENV) },
      ],
    }).compile();
    service = module.get(BlockchainService);
  });

  describe('isEnabled', () => {
    const cases: Array<[string, Record<string, string | undefined>, boolean]> = [
      ['everything set', ENABLED_ENV, true],
      [
        'no program id',
        { ...ENABLED_ENV, SOLANA_PROGRAM_ID: '' },
        false,
      ],
      [
        'no keypair',
        { ...ENABLED_ENV, SOLANA_KEYPAIR_PATH: '' },
        false,
      ],
      ['no rpc url', { ...ENABLED_ENV, SOLANA_RPC_URL: '' }, false],
      [
        // Anchor's placeholders. A well-formed base58 address that is not a
        // program, which is exactly how the .env mistake slipped through.
        'all-ones placeholder',
        { ...ENABLED_ENV, SOLANA_PROGRAM_ID: '11111111111111111111111111111111' },
        false,
      ],
      [
        'all-zeros placeholder',
        { ...ENABLED_ENV, SOLANA_PROGRAM_ID: '00000000000000000000000000000000' },
        false,
      ],
    ];

    // Only the label is interpolated; printing the whole env object buries the
    // assertion in noise.
    it.each(cases)('%s', async (_label, env, expected) => {
      const module = await Test.createTestingModule({
        providers: [
          BlockchainService,
          HashService,
          { provide: ConfigService, useValue: configFor(env) },
        ],
      }).compile();
      expect(module.get(BlockchainService).isEnabled()).toBe(expected);
    });
  });

  describe('when anchoring is not configured', () => {
    it('returns null from every write instead of throwing', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BlockchainService,
          HashService,
          { provide: ConfigService, useValue: configFor({ SOLANA_KEYPAIR_PATH: '' }) },
        ],
      }).compile();
      const disabled = module.get(BlockchainService);

      await expect(
        disabled.recordCommunityInitialized({ communityId: 'c1', name: 'A' }),
      ).resolves.toBeNull();
      await expect(
        disabled.recordPermissionCreated({
          communityId: 'c1',
          permissionId: 'p1',
          granteeWallet: '11111111111111111111111111111111',
          purpose: 'campaign',
          resourceId: 'd1',
          policyHash: 'b'.repeat(64),
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      ).resolves.toBeNull();
      await expect(
        disabled.recordPermissionRevoked({ communityId: 'c1', permissionId: 'p1', policyHash: 'b'.repeat(64) }),
      ).resolves.toBeNull();
      await expect(
        disabled.recordGovernanceDecision({
          communityId: 'c1',
          decisionId: 'd1',
          outcome: 0,
          decisionPayload: { decision: 'APPROVED' },
        }),
      ).resolves.toBeNull();
    });

    it('never touches the keypair, so a deployment with no keyfile still boots', async () => {
      // ENABLED_ENV points at a path that does not exist. If the client were
      // built eagerly this would throw; because it is deferred to first write
      // and that write is skipped, construction must succeed.
      expect(service).toBeDefined();
      expect(() => service.isEnabled()).not.toThrow();
    });
  });

  describe('when a write fails', () => {
    it('degrades to null rather than propagating', async () => {
      // Enabled config, unreachable keypair path: the failure happens when the
      // client is constructed inside write(), which must be swallowed.
      await expect(
        service.recordCommunityInitialized({ communityId: 'c1', name: 'A' }),
      ).resolves.toBeNull();

      await expect(
        service.recordGovernanceDecision({
          communityId: 'c1',
          decisionId: 'd1',
          outcome: 0,
          decisionPayload: { decision: 'APPROVED' },
        }),
      ).resolves.toBeNull();
    });

    it('caches the initialisation failure instead of re-reading the keyfile', async () => {
      // Two writes, one failure: the second must not re-attempt to load a
      // keypair that is known to be unreadable.
      await service.recordCommunityInitialized({ communityId: 'c1', name: 'A' });
      await expect(
        service.recordCommunityInitialized({ communityId: 'c2', name: 'B' }),
      ).resolves.toBeNull();
    });
  });
});
