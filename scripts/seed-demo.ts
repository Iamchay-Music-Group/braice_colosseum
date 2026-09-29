/**
 * Demo seed.
 *
 * Builds the full BRAICE scenario end to end:
 *   1. Creator, brand, AI agent, and 100 community members
 *   2. A community with CREATOR_AND_THRESHOLD governance at 60%
 *   3. 1000 individual activity records
 *   4. Aggregation into a community-level dataset (percentages only)
 *   5. A brand access request, a governance decision, and a permission
 *
 * Every step goes through the real API so the seeded state is exactly what a
 * live client would produce. Individual member identifiers are never written
 * into the dataset.
 *
 * Accounts are created with email + password, which is how BRAICE users
 * actually sign in. The one AI agent additionally links a Solana wallet, so
 * the run exercises the on-chain anchoring path: the permission granted to it
 * gets a real policy_hash and a blockchain_reference.
 *
 * Run with: pnpm seed
 */

import { createRequire } from 'module';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const BASE_URL = process.env.API_URL ?? 'http://localhost:3001/api';

const DEMO_PASSWORD = 'braice-demo-password-2026';

/**
 * Load tweetnacl and bs58 from the API workspace.
 *
 * This file lives in scripts/ but is executed by apps/api's ts-node, so bare
 * `import 'tweetnacl'` is resolved relative to this file and finds nothing —
 * pnpm's isolated store keeps those packages under apps/api. createRequire
 * with an explicit path is the same trick scripts/demo-walkthrough.sh uses.
 *
 * The base is located by walking up from the working directory rather than
 * using __dirname: ts-node reparses this file as an ES module (it has static
 * imports), and __dirname does not exist there.
 */
function loadCrypto() {
  const candidates = [
    resolve(process.cwd(), 'apps/api'),
    resolve(process.cwd()),
    resolve(process.cwd(), '..'),
    resolve(process.cwd(), '../..'),
  ];

  for (const dir of candidates) {
    if (!existsSync(join(dir, 'package.json'))) continue;
    try {
      const req = createRequire(join(dir, 'package.json'));
      return { nacl: req('tweetnacl'), bs58: req('bs58') };
    } catch {
      // Not the right workspace; try the next candidate.
    }
  }

  throw new Error(
    'Could not resolve tweetnacl/bs58. Run via `pnpm seed:demo` from the API ' +
      'workspace, or from the repo root.',
  );
}

/**
 * Scopes every seeded email to this run.
 *
 * Addresses are unique, so a second run of this script would otherwise collide
 * on the first register. A timestamp suffix keeps each run self-contained.
 */
const RUN = Date.now().toString(36);

const INTEREST_MIX: Array<[string, number]> = [
  ['streetwear', 42],
  ['music_festivals', 31],
  ['sneakers', 27],
  ['beauty', 18],
  ['gaming', 15],
  ['technology', 12],
  ['travel', 9],
];

const MEMBER_COUNT = 100;
const ACTIVITY_COUNT = 1000;

interface Seeded {
  creatorToken: string;
  brandToken: string;
  agentToken: string;
  communityId: string;
  datasetId: string;
  requestId: string;
  permissionId: string;
}

let failures = 0;

function log(step: string, message: string): void {
  console.log(`  [${step}] ${message}`);
}

function die(message: string): never {
  failures += 1;
  console.error(`\n  FATAL: ${message}\n`);
  process.exit(1);
}

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${JSON.stringify(parsed).slice(0, 400)}`,
    );
  }

  return parsed as T;
}

/**
 * Create (or sign in to) a demo account and return its access token.
 *
 * This is the same path a person uses: POST /auth/register then
 * POST /auth/login. No wallet is involved, because holding one is not how
 * BRAICE works.
 */
async function signInAs(
  label: string,
  slug: string,
): Promise<{ token: string; userId: string; email: string }> {
  const email = `${slug}.${RUN}@demo.braice.local`;

  await api('POST', '/auth/register', {
    email,
    password: DEMO_PASSWORD,
    displayName: label,
  });

  const { token, user } = await api<{
    token: string;
    user: { id: string; email: string };
  }>('POST', '/auth/login', { email, password: DEMO_PASSWORD });

  return { token, userId: user.id, email };
}

/**
 * Attach a Solana wallet to the signed-in account.
 *
 * Proves control of the private key by signing a server-issued challenge. This
 * is not a login: the account is already authenticated, and the only thing the
 * signature establishes is that this wallet may be used as the on-chain
 * grantee pubkey when a permission is anchored.
 */
async function linkWallet(
  token: string,
): Promise<{ wallet: string; linked: boolean }> {
  const { nacl, bs58 } = loadCrypto();

  const keypair = nacl.sign.keyPair();
  const wallet = bs58.encode(keypair.publicKey);

  const { nonce, message } = await api<{ nonce: string; message: string }>(
    'POST',
    '/auth/wallet/challenge',
    { walletAddress: wallet },
    token,
  );

  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
  );

  await api('POST', '/auth/wallet/link', { nonce, walletAddress: wallet, signature }, token);

  return { wallet, linked: true };
}

function weightedCategory(): string {
  const total = INTEREST_MIX.reduce((sum, [, pct]) => sum + pct, 0);
  let roll = Math.random() * total;

  for (const [category, pct] of INTEREST_MIX) {
    roll -= pct;
    if (roll <= 0) return category;
  }

  return INTEREST_MIX[0][0];
}

async function main(): Promise<void> {
  console.log(`\nBRAICE demo seed against ${BASE_URL}\n`);

  // --- 1. Identities -----------------------------------------------------
  console.log('1. Registering creator, brand, and AI agent');
  const creator = await signInAs('Afrobeat King (Creator)', 'creator');
  const brand = await signInAs('Nike (Brand)', 'brand');
  const agent = await signInAs('BRAICE AI Agent', 'agent');
  log('auth', `creator  ${creator.email}`);
  log('auth', `brand    ${brand.email}`);
  log('auth', `agent    ${agent.email}`);

  // The AI agent links a wallet so the permission issued to it below has an
  // on-chain grantee pubkey. The creator and brand deliberately do not: their
  // grants are authorised off-chain and never anchored, which is a supported
  // path, not a gap.
  const agentWallet = await linkWallet(agent.token);
  log('wallet', `agent linked ${agentWallet.wallet} (anchoring enabled)`);

  const creatorUser = { id: creator.userId };
  const brandUser = { id: brand.userId };
  const agentUser = { id: agent.userId };

  // --- 2. Community ------------------------------------------------------
  console.log('\n2. Creating community with 60% threshold governance');
  const community = await api<{ id: string }>('POST', '/communities', {
    name: 'Afrobeat Creators',
    description: '100 creators shaping the next Afrobeat wave',
    operatorId: creatorUser.id,
    governanceConfig: {
      approvalMode: 'CREATOR_AND_THRESHOLD',
      thresholdPercentage: 60,
    },
  });
  const communityId = community.id;
  log('community', communityId);

  // --- 3. Members --------------------------------------------------------
  console.log(`\n3. Adding ${MEMBER_COUNT} members`);
  const memberIds: string[] = [];
  for (let i = 0; i < MEMBER_COUNT; i += 1) {
    const member = await signInAs(`Member ${i + 1}`, `member${i + 1}`);
    memberIds.push(member.userId);

    // Membership is what the governance threshold counts, so members must be
    // enrolled before the threshold can ever be met.
    await api('POST', `/communities/${communityId}/members`, {
      userId: member.userId,
    });
  }
  log('members', `${memberIds.length} registered and enrolled`);

  // The creator operates the community and must be an ACTIVE member for the
  // creator's own vote to count toward the threshold.
  await api('POST', `/communities/${communityId}/members`, {
    userId: creatorUser.id,
  });

  // --- 4. Activity -------------------------------------------------------
  console.log(`\n4. Ingesting ${ACTIVITY_COUNT} individual activity records`);
  let ingested = 0;
  // Spread over the last 30 days so the dataset has a time range rather than
  // one identical instant. `occurredAt` is required by the API.
  const windowMs = 30 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < ACTIVITY_COUNT; i += 1) {
    const memberId = memberIds[i % memberIds.length];
    await api('POST', `/communities/${communityId}/activity`, {
      memberId,
      activityType: ['browse', 'purchase', 'listen', 'attend'][i % 4],
      interestCategory: weightedCategory(),
      occurredAt: new Date(Date.now() - Math.floor(Math.random() * windowMs)).toISOString(),
      metadata: { source: 'demo' },
    });
    ingested += 1;
  }
  log('activity', `${ingested} records ingested (individual level)`);

  // --- 5. Aggregation ----------------------------------------------------
  console.log('\n5. Aggregating into community intelligence');
  const dataset = await api<{ id: string }>(
    'POST',
    `/communities/${communityId}/datasets/generate`,
    { datasetType: 'interests' },
  );
  const datasetId = dataset.id;
  log('dataset', datasetId);

  // --- 6. Access request -------------------------------------------------
  console.log('\n6. Brand requests access for campaign planning');
  const request = await api<{ id: string }>('POST', '/access-requests', {
    communityId,
    requesterId: brandUser.id,
    datasetId,
    purpose: 'campaign_planning',
    operation: 'ANALYZE',
    requestedDurationSeconds: 30 * 24 * 3600,
  });
  const requestId = request.id;
  log('request', requestId);

  // --- 7. Governance -----------------------------------------------------
  console.log('\n7. Governance: creator approves and threshold is met');
  // The threshold is derived from live ACTIVE membership, and the creator is
  // enrolled above, so the denominator is 101, not 100. Computing it from
  // MEMBER_COUNT alone produced 60 approvals against a threshold of 61 and the
  // request was silently REJECTED.
  const enrolled = MEMBER_COUNT + 1;
  const thresholdVotes = Math.ceil((enrolled * 60) / 100);
  const approvers = [creatorUser.id, ...memberIds.slice(0, thresholdVotes - 1)];

  const decision = await api<{ decision: string; approvalCount: number; threshold: number }>(
    'POST',
    `/access-requests/${requestId}/governance/approve`,
    { approvedBy: approvers },
    creator.token,
  );

  if (decision.decision !== 'APPROVED') {
    die(
      `Governance did not approve: ${decision.approvalCount}/${enrolled} votes, ` +
        `threshold ${decision.threshold}`,
    );
  }

  log(
    'governance',
    `${decision.approvalCount}/${enrolled} approved (threshold ${decision.threshold})`,
  );

  // --- 8. Permission -----------------------------------------------------
  console.log('\n8. Creating machine-readable permission');
  const permission = await api<{
    id: string;
    policyHash: string | null;
    blockchainReference: string | null;
  }>('POST', `/access-requests/${requestId}/governance/permissions`, {
    principalId: agentUser.id,
  }, creator.token);
  const permissionId = permission.id;
  log('permission', permissionId);
  log('policyHash', permission.policyHash ?? '(none)');
  // The agent linked a wallet, so this grant has an on-chain grantee pubkey.
  // If SOLANA_PROGRAM_ID is blank the write is skipped and this is null —
  // the permission is fully enforceable either way.
  log(
    'on-chain',
    permission.blockchainReference ?? '(not anchored: no program id configured)',
  );

  if (!permission.policyHash) {
    die('SECURITY FAILURE: permission was issued without a policy hash');
  }

  // --- 9. Verify ---------------------------------------------------------
  console.log('\n9. Verifying the permission engine decides correctly');

  const allowed = await api<{ allowed: boolean }>('POST', '/authorize', {
    resourceId: datasetId,
    purpose: 'campaign_planning',
    operation: 'ANALYZE',
  }, agent.token);
  log('authorize', `agent ANALYZE -> allowed=${allowed.allowed}`);

  const wrongPurpose = await api<{ allowed: boolean; reason?: string }>(
    'POST',
    '/authorize',
    { resourceId: datasetId, purpose: 'market_research', operation: 'ANALYZE' },
    agent.token,
  );
  log('authorize', `agent wrong purpose -> allowed=${wrongPurpose.allowed} (${wrongPurpose.reason})`);

  const brandTry = await api<{ allowed: boolean; reason?: string }>(
    'POST',
    '/authorize',
    { resourceId: datasetId, purpose: 'campaign_planning', operation: 'ANALYZE' },
    brand.token,
  );
  log('authorize', `brand (no permission) -> allowed=${brandTry.allowed} (${brandTry.reason})`);

  // --- 10. Revocation ----------------------------------------------------
  console.log('\n10. Creator revokes; access must be denied thereafter');
  await api('POST', `/permissions/${permissionId}/revoke`, {}, creator.token);
  log('revoke', 'permission revoked');

  const afterRevoke = await api<{ allowed: boolean; reason?: string }>(
    'POST',
    '/authorize',
    { resourceId: datasetId, purpose: 'campaign_planning', operation: 'ANALYZE' },
    agent.token,
  );
  log(
    'authorize',
    `agent after revoke -> allowed=${afterRevoke.allowed} (${afterRevoke.reason})`,
  );

  if (afterRevoke.allowed) {
    die('SECURITY FAILURE: revoked permission still grants access');
  }

  const seeded: Seeded = {
    creatorToken: creator.token,
    brandToken: brand.token,
    agentToken: agent.token,
    communityId,
    datasetId,
    requestId,
    permissionId,
  };

  console.log('\n--- Seed complete ---');
  console.log(JSON.stringify(seeded, null, 2));
  console.log('\nRevocation is final in this run. Re-run the seed for a fresh scenario.\n');
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err));
});
