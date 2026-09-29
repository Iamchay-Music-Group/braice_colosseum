/**
 * End-to-end test for the BRAICE governance program.
 *
 * Runs the real compiled program on a local validator and drives it with the
 * real TypeScript client. This is the only test that can catch a disagreement
 * between the two implementations — a wrong discriminator, a reordered account,
 * a mis-sized account, a PDA seed that does not match. Everything else in the
 * suite is happy to pass while the two halves are incompatible.
 *
 * Run against a validator with the program loaded:
 *
 *   solana-test-validator --reset \
 *     --bpf-program 5kd7y5YMtwCEggyHQahFFgmS4CeTEdGeaGBjVfuz8p2b \
 *     target/deploy/braice_governance.so
 *
 *   node tests/anchor-integration.js
 */

const assert = require('node:assert/strict');
const {
  ACCOUNT_DISCRIMINATOR,
  AnchoredPermissionStatus,
  BorshReader,
  DecisionOutcome,
  GovernanceAnchorClient,
  decodePermissionState,
  deriveOnChainId,
  communityPda,
  eventPda,
  extractProgramErrorCode,
  loadKeypair,
  permissionPda,
} = require('@braice/blockchain-client');
const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');

const RPC_URL = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
const PROGRAM_ID = process.env.SOLANA_PROGRAM_ID || '5kd7y5YMtwCEggyHQahFFgmS4CeTEdGeaGBjVfuz8p2b';
const KEYPAIR_PATH =
  process.env.SOLANA_KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`;

const COMMUNITY_ID = 'itest-community-1';
const PERMISSION_ID = 'itest-permission-1';
const RESOURCE_ID = 'itest-dataset-1';
const PURPOSE = 'campaign_planning';

const results = [];

/**
 * Simulate a transaction that is expected to fail and return the program's
 * error code.
 *
 * Simulation is used rather than submission because a rejected transaction is
 * still *included* on chain: submitting it only yields a signature plus a
 * web3.js error whose shape differs between versions, whereas simulation
 * returns the program's own `{ InstructionError: [i, { Custom }] }` payload
 * directly. Reading that through the client's exported extractor also keeps
 * this test honest about the extractor the client itself depends on.
 */
async function simulateForProgramError(connection, tx, signers) {
  const result = await connection.simulateTransaction(tx, signers);
  const err = result.value.err;
  assert.ok(err, 'expected the simulation to fail, but the program accepted it');
  return extractProgramErrorCode(err);
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

/**
 * Assert that a write is rejected, without pinning *how*.
 *
 * Duplicate anchors are refused by the System Program's account allocation
 * ("account already in use", `Custom: 0`) before the program's handler body
 * ever runs, so there is no custom error code to assert. What actually matters
 * is the security property: the rejected write must leave the existing record
 * untouched. The callers below check that explicitly.
 */
async function expectRejected(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail('expected the write to be rejected, but it succeeded');
}

async function expectProgramError(fn, expectedCode) {
  try {
    await fn();
  } catch (err) {
    const code = err?.cause?.code ?? err?.code;
    assert.equal(
      code,
      expectedCode,
      `expected program error ${expectedCode}, received ${code}: ${err.message}`,
    );
    return;
  }
  assert.fail(`expected program error ${expectedCode} but the call succeeded`);
}

async function main() {
  const authority = loadKeypair(KEYPAIR_PATH);
  const client = new GovernanceAnchorClient({
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID,
    commitment: 'confirmed',
    keypairPath: KEYPAIR_PATH,
  });

  const nowSeconds = Math.floor(Date.now() / 1000);
  const policyHash = 'b'.repeat(64);
  const decisionHash = 'c'.repeat(64);
  const decisionId = 'itest-decision-1';

  console.log(`\nBRAICE governance integration test`);
  console.log(`  program   ${PROGRAM_ID}`);
  console.log(`  authority ${authority.publicKey.toBase58()}\n`);

  // A second, unrelated key. Used to prove the program refuses writes that are
  // not signed by the community authority — the access-control property the
  // whole audit anchor rests on.
  const impostor = Keypair.generate();

  const grantee = Keypair.generate().publicKey;

  // Fund the impostor before any of the authorization checks. Without lamports
  // the transaction fails at fee payment and the program's own error is never
  // reached, so a genuine "wrong authority" failure would be indistinguishable
  // from "broke impostor".
  const funder = new Connection(RPC_URL, 'confirmed');
  const airdrop = await funder.requestAirdrop(impostor.publicKey, 1_000_000_000);
  const airdropBlockhash = await funder.getLatestBlockhash('confirmed');
  await funder.confirmTransaction(
    { signature: airdrop, ...airdropBlockhash },
    'confirmed',
  );

  console.log('community initialization');

  await check('rejects a community whose payer is not the declared authority', async () => {
    // Constructed directly rather than via the client so payer and authority can
    // differ, which the client's own API makes unrepresentable.
    const { buildInitializeCommunity } = require('@braice/blockchain-client');
    const ix = buildInitializeCommunity(
      new PublicKey(PROGRAM_ID),
      impostor.publicKey,
      {
        communityId: `${COMMUNITY_ID}-mismatch`,
        authority: authority.publicKey,
        nameHash: new Uint8Array(32),
      },
    );
    const connection = new Connection(RPC_URL, 'confirmed');
    const code = await simulateForProgramError(
      connection,
      new Transaction().add(ix),
      [impostor],
    );
    assert.equal(code, 6004, `expected AuthorityMismatch (6004), got ${code}`);
  });

  await check('initializes a community bound to the authority', async () => {
    const signature = await client.initializeCommunity({
      communityId: COMMUNITY_ID,
      authority: authority.publicKey,
      nameHash: new Uint8Array(32).fill(9),
    });
    assert.match(signature, /^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
  });

  await check('refuses to initialize the same community twice, and keeps the original', async () => {
    const nameHash = new Uint8Array(32).fill(9);
    await expectRejected(() =>
      client.initializeCommunity({
        communityId: COMMUNITY_ID,
        authority: authority.publicKey,
        // A different name: if this ever landed, it would silently rewrite the
        // community's identity.
        nameHash: new Uint8Array(32).fill(77),
      }),
    );

    // The rejected write must not have mutated the existing account.
    const connection = new Connection(RPC_URL, 'confirmed');
    const info = await connection.getAccountInfo(
      communityPda(new PublicKey(PROGRAM_ID), COMMUNITY_ID)[0],
    );
    assert.ok(info, 'the community account should still exist');
    const reader = new BorshReader(info.data);
    reader.expectDiscriminator(ACCOUNT_DISCRIMINATOR.communityState, 'CommunityState');
    reader.fixed32(); // community_id
    reader.fixed32(); // authority
    assert.equal(
      Buffer.from(reader.fixed32()).toString('hex'),
      Buffer.from(nameHash).toString('hex'),
      'the duplicate init overwrote the stored name hash',
    );
  });

  console.log('\ngovernance decisions');

  await check('records an approved decision', async () => {
    const signature = await client.recordGovernanceDecision({
      communityId: COMMUNITY_ID,
      eventId: decisionId,
      decisionHash,
      outcome: DecisionOutcome.Approved,
    });
    assert.ok(signature.length > 0);
  });

  await check('refuses to rewrite an existing decision, and keeps the original', async () => {
    await expectRejected(() =>
      client.recordGovernanceDecision({
        communityId: COMMUNITY_ID,
        eventId: decisionId,
        // A different hash and the opposite outcome: landing this would rewrite
        // the audit trail, which is the one thing the anchor must make impossible.
        decisionHash: new Uint8Array(32).fill(88),
        outcome: DecisionOutcome.Rejected,
      }),
    );

    const connection = new Connection(RPC_URL, 'confirmed');
    const info = await connection.getAccountInfo(
      eventPda(new PublicKey(PROGRAM_ID), COMMUNITY_ID, decisionId)[0],
    );
    assert.ok(info, 'the event account should still exist');
    const reader = new BorshReader(info.data);
    reader.expectDiscriminator(ACCOUNT_DISCRIMINATOR.governanceEvent, 'GovernanceEvent');
    reader.fixed32(); // event_id
    reader.fixed32(); // community_id
    assert.equal(
      Buffer.from(reader.fixed32()).toString('hex'),
      decisionHash,
      'the duplicate decision overwrote the stored decision hash',
    );
    reader.i64(); // decided_at
    assert.equal(
      reader.u8(),
      DecisionOutcome.Approved,
      'the duplicate decision flipped the recorded outcome',
    );
  });

  console.log('\npermissions');

  await check('anchors a permission', async () => {
    const signature = await client.createPermission({
      communityId: COMMUNITY_ID,
      permissionId: PERMISSION_ID,
      grantee,
      purpose: PURPOSE,
      resourceId: RESOURCE_ID,
      policyHash,
      expiresAt: nowSeconds + 3600,
    });
    assert.ok(signature.length > 0);
  });

  await check('reads the permission back with the values it was given', async () => {
    const [address] = permissionPda(
      new PublicKey(PROGRAM_ID),
      COMMUNITY_ID,
      PERMISSION_ID,
    );
    const state = await client.fetchPermission(address);
    assert.ok(state, 'permission account should exist');

    assert.deepEqual(
      state.permissionId,
      deriveOnChainId('permission', PERMISSION_ID),
      'permission_id mismatch',
    );
    assert.deepEqual(
      state.communityId,
      deriveOnChainId('community', COMMUNITY_ID),
      'community_id mismatch',
    );
    assert.deepEqual(
      state.policyHash,
      Uint8Array.from(Buffer.from(policyHash, 'hex')),
      'policy_hash mismatch — the client and program disagree on encoding',
    );
    assert.deepEqual(
      state.purposeHash,
      deriveOnChainId('purpose', PURPOSE),
      'purpose_hash mismatch',
    );
    assert.deepEqual(
      state.resourceHash,
      deriveOnChainId('resource', RESOURCE_ID),
      'resource_hash mismatch',
    );
    assert.equal(state.status, AnchoredPermissionStatus.Active);
    assert.equal(state.revokedAt, 0);
    assert.ok(
      state.expiresAt > nowSeconds,
      'expires_at should be in the future as requested',
    );
    // 255 is a legitimate canonical bump; only 0 is impossible.
    assert.ok(state.bump > 0 && state.bump <= 255, `implausible bump ${state.bump}`);
  });

  await check('stores no free text or raw identifiers', async () => {
    const [address] = permissionPda(
      new PublicKey(PROGRAM_ID),
      COMMUNITY_ID,
      PERMISSION_ID,
    );
    const raw = await new Connection(RPC_URL, 'confirmed').getAccountInfo(address);
    const asText = Buffer.from(raw.data).toString('latin1');
    assert.ok(
      !asText.includes(PURPOSE),
      'purpose text leaked on-chain',
    );
    assert.ok(
      !asText.includes(RESOURCE_ID),
      'resource id leaked on-chain',
    );
    assert.ok(
      !asText.includes(PERMISSION_ID),
      'permission id leaked on-chain',
    );
  });

  await check('refuses a permission that is already expired', async () => {
    await expectProgramError(
      () =>
        client.createPermission({
          communityId: COMMUNITY_ID,
          permissionId: 'itest-expired',
          grantee,
          purpose: PURPOSE,
          resourceId: RESOURCE_ID,
          policyHash,
          expiresAt: nowSeconds - 60,
        }),
      6001,
    );
  });

  await check('refuses a second anchor for the same permission id, and keeps the original', async () => {
    await expectRejected(() =>
      client.createPermission({
        communityId: COMMUNITY_ID,
        permissionId: PERMISSION_ID,
        grantee,
        purpose: PURPOSE,
        resourceId: RESOURCE_ID,
        // A different policy and a longer expiry: landing this would swap the
        // terms a grant was issued under while keeping the same id, which is
        // exactly the substitution the anchor has to make impossible.
        policyHash: 'd'.repeat(64),
        expiresAt: nowSeconds + 7200,
      }),
    );

    // The stored grant must still carry the terms it was created with.
    const after = await client.fetchPermission(
      permissionPda(new PublicKey(PROGRAM_ID), COMMUNITY_ID, PERMISSION_ID)[0],
    );
    assert.ok(after, 'the original permission should still exist');
    // Decode to hex before comparing: policyHash is a hex string while the
    // decoded field is a byte array, and assert.equal on those two would fail
    // on type even when the bytes match.
    assert.equal(
      Buffer.from(after.policyHash).toString('hex'),
      policyHash,
      'the duplicate anchor overwrote the stored policy hash',
    );
    assert.equal(after.expiresAt, nowSeconds + 3600, 'the duplicate anchor extended the expiry');
    assert.equal(after.status, AnchoredPermissionStatus.Active);
  });

  await check('refuses to anchor without the community authority', async () => {
    // Already funded in main(); the failure here must be about authorization.
    const connection = new Connection(RPC_URL, 'confirmed');

    const { buildCreatePermission } = require('@braice/blockchain-client');
    const ix = buildCreatePermission(
      new PublicKey(PROGRAM_ID),
      impostor.publicKey,
      impostor.publicKey, // claims to be the authority, and is not
      {
        communityId: COMMUNITY_ID,
        permissionId: 'itest-unauthorized',
        grantee,
        purpose: PURPOSE,
        resourceId: RESOURCE_ID,
        policyHash,
        expiresAt: nowSeconds + 3600,
      },
    );
    const code = await simulateForProgramError(
      connection,
      new Transaction().add(ix),
      [impostor],
    );
    assert.equal(
      code,
      6000,
      `expected NotCommunityAuthority (6000), got ${code}`,
    );
  });

  console.log('\nrevocation');

  await check('revokes a permission', async () => {
    const signature = await client.revokePermission({
      communityId: COMMUNITY_ID,
      permissionId: PERMISSION_ID,
      policyHash,
    });
    assert.ok(signature.length > 0);
  });

  await check('the revoked state is durable on-chain', async () => {
    const [address] = permissionPda(
      new PublicKey(PROGRAM_ID),
      COMMUNITY_ID,
      PERMISSION_ID,
    );
    const state = await client.fetchPermission(address);
    assert.equal(state.status, AnchoredPermissionStatus.Revoked);
    assert.ok(
      state.revokedAt > 0,
      'revoked_at should be set once the revocation lands',
    );
    // The policy hash must survive revocation untouched: it is the commitment
    // to what was granted, and a revocation must not rewrite history.
    assert.deepEqual(
      state.policyHash,
      Uint8Array.from(Buffer.from(policyHash, 'hex')),
    );
  });

  await check('refuses to revoke the same permission twice', async () => {
    await expectProgramError(
      () =>
        client.revokePermission({
          communityId: COMMUNITY_ID,
          permissionId: PERMISSION_ID,
          policyHash,
        }),
      6002,
    );
  });

  console.log('\naccount layout');

  await check('a PermissionState account is exactly the size the program allocated', async () => {
    const [address] = permissionPda(
      new PublicKey(PROGRAM_ID),
      COMMUNITY_ID,
      PERMISSION_ID,
    );
    const connection = new Connection(RPC_URL, 'confirmed');
    const account = await connection.getAccountInfo(address);
    // 8 discriminator + 32*6 + 8*3 + 1 status + 1 bump
    assert.equal(
      account.data.length,
      8 + 32 * 6 + 8 * 3 + 1 + 1,
      'account size drifted from the space constant',
    );
  });

  await check('a decoded account round-trips through the raw buffer', async () => {
    const [address] = permissionPda(
      new PublicKey(PROGRAM_ID),
      COMMUNITY_ID,
      PERMISSION_ID,
    );
    const connection = new Connection(RPC_URL, 'confirmed');
    const account = await connection.getAccountInfo(address);
    const decoded = decodePermissionState(Buffer.from(account.data));
    assert.equal(decoded.status, AnchoredPermissionStatus.Revoked);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} integration checks passed`,
  );

  if (failed.length > 0) {
    console.error('\nFailures:');
    for (const f of failed) {
      console.error(`  - ${f.name}: ${f.err.message}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nintegration test crashed:', err);
  process.exit(1);
});
