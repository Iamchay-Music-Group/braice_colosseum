import assert from 'assert';
import { createHash } from 'crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  ACCOUNT_DISCRIMINATOR,
  AnchoredPermissionStatus,
  BorshReader,
  DecisionOutcome,
  GOVERNANCE_ERROR,
  INSTRUCTION_DISCRIMINATOR,
  SEED,
  buildCreatePermission,
  buildInitializeCommunity,
  buildRecordGovernanceDecision,
  buildRevokePermission,
  communityPda,
  decodeHexHash,
  decodePermissionState,
  deriveOnChainId,
  describeGovernanceError,
  encodeEnum,
  encodeFixed32,
  encodeI64,
  eventPda,
  extractProgramErrorCode,
  loadKeypair,
  permissionPda,
  permissionPdaFromAccount,
  toGovernanceError,
} from '@braice/blockchain-client';
import { SystemProgram } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('5kd7y5YMtwCEggyHQahFFgmS4CeTEdGeaGBjVfuz8p2b');
const POLICY_HASH = 'a'.repeat(64);

function anchorDiscriminator(scope: string, name: string): Buffer {
  // Anchor derives both instruction and account discriminators as the first 8
  // bytes of sha256("<scope>:<name>"). Recomputing them here means a drift
  // between the Rust program and this client fails a test instead of producing
  // transactions the program silently rejects.
  return createHash('sha256').update(`${scope}:${name}`).digest().subarray(0, 8);
}

describe('wire format', () => {
  it.each([
    ['initializeCommunity', 'initialize_community'],
    ['createPermission', 'create_permission'],
    ['revokePermission', 'revoke_permission'],
    ['recordGovernanceDecision', 'record_governance_decision'],
  ] as const)(
    'instruction discriminator for %s matches Anchor derivation',
    (tsName, rustName) => {
      expect(INSTRUCTION_DISCRIMINATOR[tsName]).toEqual(
        anchorDiscriminator('global', rustName),
      );
    },
  );

  it.each([
    ['communityState', 'CommunityState'],
    ['permissionState', 'PermissionState'],
    ['governanceEvent', 'GovernanceEvent'],
  ] as const)(
    'account discriminator for %s matches Anchor derivation',
    (tsName, rustName) => {
      expect(ACCOUNT_DISCRIMINATOR[tsName]).toEqual(
        anchorDiscriminator('account', rustName),
      );
    },
  );

  it('seed prefixes match the Rust byte strings', () => {
    expect(SEED.community.toString('utf8')).toBe('community');
    expect(SEED.permission.toString('utf8')).toBe('permission');
    expect(SEED.event.toString('utf8')).toBe('event');
  });

  it('encodes i64 as little-endian', () => {
    expect(encodeI64(1).toString('hex')).toBe('0100000000000000');
    expect(encodeI64(0).toString('hex')).toBe('0000000000000000');
    expect(encodeI64(-1).toString('hex')).toBe('ffffffffffffffff');
    expect(encodeI64(1_700_000_000).length).toBe(8);
  });

  it('rejects an i64 that cannot be represented exactly', () => {
    expect(() => encodeI64(1.5)).toThrow(/safe integer/);
    expect(() => encodeI64(Number.MAX_SAFE_INTEGER + 2)).toThrow(/safe integer/);
    expect(() => encodeI64(Number.NaN)).toThrow(/safe integer/);
  });

  it('rejects fixed32 of the wrong length', () => {
    expect(() => encodeFixed32(new Uint8Array(31))).toThrow(/32/);
    expect(encodeFixed32(new Uint8Array(32))).toHaveLength(32);
  });

  it('encodes a single-variant enum and rejects unknown discriminants', () => {
    expect(encodeEnum(0, [0, 1], 'Outcome')).toEqual(Buffer.from([0]));
    expect(encodeEnum(1, [0, 1], 'Outcome')).toEqual(Buffer.from([1]));
    expect(() => encodeEnum(2, [0, 1], 'Outcome')).toThrow(/Invalid Outcome/);
  });
});

describe('on-chain id derivation', () => {
  it('is deterministic', () => {
    expect(deriveOnChainId('permission', 'perm-uuid')).toEqual(
      deriveOnChainId('permission', 'perm-uuid'),
    );
  });

  it('is 32 bytes', () => {
    expect(deriveOnChainId('community', 'any')).toHaveLength(32);
  });

  it('does not collide across id kinds', () => {
    // The same UUID used as both a community and a permission id must not
    // produce the same on-chain id, or one could be passed off as the other.
    expect(deriveOnChainId('community', 'shared-uuid')).not.toEqual(
      deriveOnChainId('permission', 'shared-uuid'),
    );
    expect(deriveOnChainId('event', 'shared-uuid')).not.toEqual(
      deriveOnChainId('community', 'shared-uuid'),
    );
  });

  it('normalises surrounding whitespace so one id maps to one account', () => {
    // Trimming is intentional: a UUID pasted with a stray space must resolve to
    // the same permission account, otherwise the same logical permission would
    // get two on-chain accounts depending on invisible whitespace.
    expect(deriveOnChainId('community', ' a ')).toEqual(
      deriveOnChainId('community', 'a'),
    );
    expect(deriveOnChainId('community', 'a')).not.toEqual(
      deriveOnChainId('community', 'ab'),
    );
  });

  it('rejects an empty id', () => {
    expect(() => deriveOnChainId('community', '   ')).toThrow(/empty/);
  });
});

describe('hex hash decoding', () => {
  it('accepts a 64-character hex digest', () => {
    expect(decodeHexHash(POLICY_HASH, 'policyHash')).toHaveLength(32);
  });

  it('accepts uppercase hex', () => {
    expect(decodeHexHash('A'.repeat(64), 'policyHash')).toHaveLength(32);
  });

  it.each([
    ['too short', 'abcd'],
    ['too long', 'a'.repeat(66)],
    ['non-hex', 'z'.repeat(64)],
    ['empty', ''],
  ])('rejects a hash that is %s', (_label, value) => {
    // Anchoring a policy hash that cannot be recomputed later would leave
    // nothing to verify against, so this is rejected rather than coerced.
    expect(() => decodeHexHash(value, 'policyHash')).toThrow(/64-character hex/);
  });
});

describe('PDA derivation', () => {
  it('is stable for the same inputs', () => {
    expect(communityPda(PROGRAM_ID, 'community-1')[0]).toEqual(
      communityPda(PROGRAM_ID, 'community-1')[0],
    );
  });

  it('differs per community', () => {
    expect(communityPda(PROGRAM_ID, 'a')[0]).not.toEqual(
      communityPda(PROGRAM_ID, 'b')[0],
    );
  });

  it('differs per permission within a community', () => {
    const a = permissionPda(PROGRAM_ID, 'c', 'p1')[0];
    const b = permissionPda(PROGRAM_ID, 'c', 'p2')[0];
    expect(a).not.toEqual(b);
  });

  it('does not collide with the community account for the same id', () => {
    expect(communityPda(PROGRAM_ID, 'x')[0]).not.toEqual(
      permissionPda(PROGRAM_ID, 'x', 'x')[0],
    );
  });

  it('differs per decision', () => {
    expect(eventPda(PROGRAM_ID, 'c', 'e1')[0]).not.toEqual(
      eventPda(PROGRAM_ID, 'c', 'e2')[0],
    );
  });

  it('re-derives the same address from an account\'s stored ids', () => {
    const [expected] = permissionPda(PROGRAM_ID, 'c', 'p');
    const [actual] = permissionPdaFromAccount(PROGRAM_ID, {
      communityId: deriveOnChainId('community', 'c'),
      permissionId: deriveOnChainId('permission', 'p'),
    });
    expect(actual).toEqual(expected);
  });
});

describe('buildInitializeCommunity', () => {
  const payer = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;

  it('orders accounts payer, community, systemProgram', () => {
    const ix = buildInitializeCommunity(PROGRAM_ID, payer, {
      communityId: 'community-1',
      authority,
      nameHash: new Uint8Array(32).fill(7),
    });

    expect(ix.programId).toEqual(PROGRAM_ID);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      payer.toBase58(),
      communityPda(PROGRAM_ID, 'community-1')[0].toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[0]).toMatchObject({ isSigner: true, isWritable: true });
    expect(ix.keys[1]).toMatchObject({ isSigner: false, isWritable: true });
    expect(ix.keys[2]).toMatchObject({ isSigner: false, isWritable: false });
  });

  it('encodes discriminator plus three 32-byte arguments', () => {
    const ix = buildInitializeCommunity(PROGRAM_ID, payer, {
      communityId: 'community-1',
      authority,
      nameHash: new Uint8Array(32).fill(7),
    });
    expect(ix.data).toHaveLength(8 + 32 + 32 + 32);
    expect(ix.data.subarray(0, 8)).toEqual(
      INSTRUCTION_DISCRIMINATOR.initializeCommunity,
    );
  });
});

describe('buildCreatePermission', () => {
  const payer = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const grantee = Keypair.generate().publicKey;

  const params = {
    communityId: 'community-1',
    permissionId: 'permission-1',
    grantee,
    purpose: 'campaign_planning',
    resourceId: 'dataset-1',
    policyHash: POLICY_HASH,
    expiresAt: 1_900_000_000,
  };

  it('orders accounts payer, community, authority, permission, systemProgram', () => {
    const ix = buildCreatePermission(PROGRAM_ID, payer, authority, params);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      payer.toBase58(),
      communityPda(PROGRAM_ID, params.communityId)[0].toBase58(),
      authority.toBase58(),
      permissionPda(PROGRAM_ID, params.communityId, params.permissionId)[0].toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
  });

  it('marks the authority as a signer and the permission writable', () => {
    const ix = buildCreatePermission(PROGRAM_ID, payer, authority, params);
    expect(ix.keys[2]).toMatchObject({ isSigner: true, isWritable: false });
    expect(ix.keys[3]).toMatchObject({ isSigner: false, isWritable: true });
  });

  it('encodes the expiry as a trailing 8-byte little-endian i64', () => {
    const ix = buildCreatePermission(PROGRAM_ID, payer, authority, params);
    expect(ix.data).toHaveLength(8 + 32 * 5 + 8);
    const trailing = ix.data.subarray(ix.data.length - 8);
    expect(trailing.readBigInt64LE(0)).toBe(BigInt(params.expiresAt));
  });

  it('never puts the purpose or resource id in the transaction', () => {
    // The program stores hashes only. If raw ids or free text ever appeared in
    // the payload, that contract would be quietly broken.
    const ix = buildCreatePermission(PROGRAM_ID, payer, authority, params);
    const hex = ix.data.toString('hex');
    const text = Buffer.from(ix.data).toString('latin1');
    expect(text).not.toContain('campaign_planning');
    expect(text).not.toContain('dataset-1');
    expect(text).not.toContain('permission-1');
    expect(hex).toContain(POLICY_HASH);
  });

  it('encodes the purpose and resource as distinct namespaced hashes', () => {
    const ix = buildCreatePermission(PROGRAM_ID, payer, authority, params);
    // 8 disc + 32 permission_id + 32 grantee = purpose_hash at offset 72.
    const purposeHash = Buffer.from(ix.data.subarray(72, 104));
    expect(purposeHash).toEqual(Buffer.from(deriveOnChainId('purpose', params.purpose)));
  });

  it('refuses to build with a malformed policy hash', () => {
    expect(() =>
      buildCreatePermission(PROGRAM_ID, payer, authority, {
        ...params,
        policyHash: 'not-a-hash',
      }),
    ).toThrow(/64-character hex/);
  });
});

describe('buildRevokePermission', () => {
  const authority = Keypair.generate().publicKey;
  const permissionAccount = permissionPda(
    PROGRAM_ID,
    'community-1',
    'permission-1',
  )[0];

  it('sends community, authority, then permission', () => {
    // All three are required. Anchor matches accounts positionally against the
    // Rust account struct, so omitting the community account would shift the
    // authority into the community slot and fail the signature check.
    const ix = buildRevokePermission(PROGRAM_ID, authority, {
      communityId: 'community-1',
      permissionCommunityId: deriveOnChainId('community', 'community-1'),
      permissionId: deriveOnChainId('permission', 'permission-1'),
      permissionAccount,
      policyHash: POLICY_HASH,
    });
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      communityPda(PROGRAM_ID, 'community-1')[0].toBase58(),
      authority.toBase58(),
      permissionAccount.toBase58(),
    ]);
    expect(ix.keys[0]).toMatchObject({ isSigner: false, isWritable: false });
    expect(ix.keys[1]).toMatchObject({ isSigner: true, isWritable: false });
    expect(ix.keys[2]).toMatchObject({ isSigner: false, isWritable: true });
  });

  it('encodes discriminator plus the policy hash', () => {
    const ix = buildRevokePermission(PROGRAM_ID, authority, {
      communityId: 'community-1',
      permissionCommunityId: new Uint8Array(32),
      permissionId: new Uint8Array(32),
      permissionAccount,
      policyHash: POLICY_HASH,
    });
    expect(ix.data).toHaveLength(8 + 32);
    expect(ix.data.subarray(0, 8)).toEqual(
      INSTRUCTION_DISCRIMINATOR.revokePermission,
    );
  });
});

describe('buildRecordGovernanceDecision', () => {
  const payer = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;

  it('encodes the outcome as a single discriminant byte', () => {
    for (const outcome of [DecisionOutcome.Approved, DecisionOutcome.Rejected]) {
      const ix = buildRecordGovernanceDecision(PROGRAM_ID, payer, authority, {
        communityId: 'community-1',
        eventId: 'event-1',
        decisionHash: POLICY_HASH,
        outcome,
      });
      expect(ix.data).toHaveLength(8 + 32 + 32 + 1);
      expect(ix.data[ix.data.length - 1]).toBe(outcome);
    }
  });

  it('rejects an outcome outside the program enum', () => {
    expect(() =>
      buildRecordGovernanceDecision(PROGRAM_ID, payer, authority, {
        communityId: 'community-1',
        eventId: 'event-1',
        decisionHash: POLICY_HASH,
        outcome: 7 as DecisionOutcome,
      }),
    ).toThrow(/Invalid DecisionOutcome/);
  });
});

describe('PermissionState decoding', () => {
  function buildAccount(opts: {
    status?: number;
    issuedAt?: number;
    expiresAt?: number;
    revokedAt?: number;
  }): Buffer {
    const discriminator = Buffer.alloc(8);
    ACCOUNT_DISCRIMINATOR.permissionState.copy(discriminator, 0);
    return Buffer.concat([
      discriminator,
      Buffer.alloc(32, 1), // permission_id
      Buffer.alloc(32, 2), // community_id
      Buffer.alloc(32, 3), // grantee
      Buffer.alloc(32, 4), // purpose_hash
      Buffer.alloc(32, 5), // resource_hash
      Buffer.alloc(32, 6), // policy_hash
      encodeI64(opts.issuedAt ?? 1_000),
      encodeI64(opts.expiresAt ?? 2_000),
      encodeI64(opts.revokedAt ?? 0),
      Buffer.from([opts.status ?? AnchoredPermissionStatus.Active]),
      Buffer.from([254]), // bump
    ]);
  }

  it('decodes a well-formed account', () => {
    const decoded = decodePermissionState(buildAccount({}));
    expect(decoded.permissionId).toEqual(new Uint8Array(32).fill(1));
    expect(decoded.communityId).toEqual(new Uint8Array(32).fill(2));
    expect(decoded.policyHash).toEqual(new Uint8Array(32).fill(6));
    expect(decoded.issuedAt).toBe(1_000);
    expect(decoded.expiresAt).toBe(2_000);
    expect(decoded.revokedAt).toBe(0);
    expect(decoded.status).toBe(AnchoredPermissionStatus.Active);
    expect(decoded.bump).toBe(254);
  });

  it('decodes a revoked account', () => {
    const decoded = decodePermissionState(
      buildAccount({ status: AnchoredPermissionStatus.Revoked, revokedAt: 1_500 }),
    );
    expect(decoded.status).toBe(AnchoredPermissionStatus.Revoked);
    expect(decoded.revokedAt).toBe(1_500);
  });

  it('rejects an account with the wrong discriminator', () => {
    const wrong = Buffer.alloc(200);
    wrong.write('nope', 0);
    expect(() => decodePermissionState(wrong)).toThrow(
      /Not a PermissionState account/,
    );
  });

  it('rejects a truncated account rather than reading past the end', () => {
    const full = buildAccount({});
    expect(() => decodePermissionState(full.subarray(0, full.length - 4))).toThrow(
      /truncated/,
    );
  });

  it('rejects an unknown status byte', () => {
    expect(() => decodePermissionState(buildAccount({ status: 9 }))).toThrow(
      /Unknown permission status/,
    );
  });
});

describe('BorshReader', () => {
  it('reports how much data was missing when truncated', () => {
    const reader = new BorshReader(Buffer.alloc(2));
    expect(() => reader.fixed32()).toThrow(/truncated/);
  });
});

describe('program error mapping', () => {
  it('pins the full code table, since codes are positional in the Rust enum', () => {
    // Anchor assigns 6000 + the variant's position in GovernanceError, so this
    // table can only be maintained by hand and is the only thing standing
    // between a reordered Rust enum and a client that reports the wrong reason
    // for a real failure. Assert the whole table, not a sample.
    expect(GOVERNANCE_ERROR).toEqual({
      NotCommunityAuthority: 6000,
      PermissionAlreadyExpired: 6001,
      PermissionAlreadyRevoked: 6002,
      InvalidTimestamp: 6003,
      AuthorityMismatch: 6004,
    });
  });

  it('maps every known code to a non-empty reason', () => {
    for (const [name, code] of Object.entries(GOVERNANCE_ERROR)) {
      const message = describeGovernanceError(code);
      assert.ok(message, `${name} (${code}) has no message`);
      assert.notEqual(message, String(code), `${name} (${code}) has no description`);
    }
  });

  it('maps known codes to their Rust message', () => {
    expect(describeGovernanceError(GOVERNANCE_ERROR.NotCommunityAuthority)).toBe(
      'Signer is not the community authority',
    );
    expect(describeGovernanceError(GOVERNANCE_ERROR.AuthorityMismatch)).toBe(
      'Payer does not match the declared community authority',
    );
  });

  it('returns null for an unknown code rather than guessing', () => {
    // A program upgrade that adds an error must be visible as unknown, not
    // mislabelled as something it is not.
    expect(describeGovernanceError(6099)).toBeNull();
  });

  it('wraps a known program code in a typed error', () => {
    const wrapped = toGovernanceError({ code: 6000 });
    expect(wrapped).toBeInstanceOf(Error);
    expect((wrapped as Error).message).toBe('Signer is not the community authority');
  });

  it('leaves unrelated errors untouched', () => {
    const original = new Error('socket hang up');
    expect(toGovernanceError(original)).toBe(original);
    expect(toGovernanceError({ code: 429 })).toEqual({ code: 429 });
  });
});

describe('program error extraction', () => {
  it('reads a custom code out of an InstructionError', () => {
    expect(
      extractProgramErrorCode({ InstructionError: [0, { Custom: 6002 }] }),
    ).toBe(6002);
    // The failing instruction index varies; the code is what matters.
    expect(
      extractProgramErrorCode({ InstructionError: [3, { Custom: 6004 }] }),
    ).toBe(6004);
  });

  it('reads a bare custom code', () => {
    expect(extractProgramErrorCode({ Custom: 6003 })).toBe(6003);
  });

  it('returns null for failures that are not program errors', () => {
    // A blockhash expiry or a fee problem carries no program code. Reporting
    // one would send an operator looking at the wrong subsystem.
    expect(extractProgramErrorCode({ BlockhashNotFound: 'expired' })).toBeNull();
    expect(extractProgramErrorCode({ InstructionError: [0, 'InvalidAccountData'] })).toBeNull();
    expect(extractProgramErrorCode(null)).toBeNull();
    expect(extractProgramErrorCode('boom')).toBeNull();
  });
});

describe('loadKeypair', () => {
  it('reports the path it could not read', () => {
    expect(() => loadKeypair('/nonexistent/keypair.json')).toThrow(
      /\/nonexistent\/keypair.json/,
    );
  });
});
