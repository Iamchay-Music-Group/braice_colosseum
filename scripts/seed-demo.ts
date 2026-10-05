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
import { existsSync, readFileSync } from 'fs';
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
 *
 * `keypairPath` links an existing key rather than a throwaway. That matters for
 * the creator: the program binds `community.authority` to the key that signs
 * `initialize_community`, which is whatever SOLANA_KEYPAIR_PATH holds, and then
 * rejects every later write not signed by that same key. Linking the creator to
 * a different generated keypair would put a wallet address on the community
 * operator that cannot sign anything for it — the anchor would work, but every
 * address shown in the demo would be a dead end for a verifier.
 *
 * Solana keypairs are Ed25519, so the CLI's 64-byte secret key contains the
 * 32-byte seed tweetnacl wants as its first 32 bytes.
 */
async function linkWallet(
  token: string,
  keypairPath?: string,
): Promise<{ wallet: string; linked: boolean }> {
  const { nacl, bs58 } = loadCrypto();

  let keypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  if (keypairPath) {
    const parsed = JSON.parse(readFileSync(keypairPath, 'utf8')) as
      | number[]
      | { secretKey: string };
    const secretKey = Array.isArray(parsed)
      ? Uint8Array.from(parsed)
      : Uint8Array.from(Buffer.from(parsed.secretKey, 'base64'));
    if (secretKey.length !== 64) {
      throw new Error(
        `Keypair at ${keypairPath} is ${secretKey.length} bytes; Solana keypairs are 64.`,
      );
    }
    keypair = nacl.sign.keyPair.fromSeed(secretKey.slice(0, 32));
  } else {
    keypair = nacl.sign.keyPair();
  }

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

  // The creator links the configured signing key, because that key is the
  // community's on-chain authority: `initialize_community` binds
  // community.authority to it, and every later permission or decision write
  // must carry its signature. Attaching a generated keypair here instead would
  // put a wallet address on the operator that can never sign for it.
  //
  // If no keypair is configured the creator simply has no wallet, which is a
  // supported state: grants stay fully enforceable off-chain, just unanchored.
  const authorityKeypair = process.env.SOLANA_KEYPAIR_PATH;
  let creatorWallet: string | null = null;
  if (authorityKeypair && existsSync(authorityKeypair)) {
    creatorWallet = (await linkWallet(creator.token, authorityKeypair)).wallet;
    log('wallet', `creator linked authority ${creatorWallet}`);
  } else {
    log('wallet', 'creator has no wallet (SOLANA_KEYPAIR_PATH unset) - anchoring off');
  }

  // The AI agent links a throwaway wallet so the permission issued to it below has
  // an on-chain grantee pubkey. The grantee only has to be a pubkey the grant is
  // addressed to; it never signs. The brand deliberately does not link one: its
  // grant is authorised off-chain and never anchored, which is a supported path,
  // not a gap.
  const agentWallet = await linkWallet(agent.token);
  log('wallet', `agent linked ${agentWallet.wallet} (anchoring enabled)`);

  // Ids are only needed where a route still takes one explicitly. Anything
  // that derives identity from the token (community operator, access-requester,
  // member join, activity ingestion) must NOT be passed one — that is the
  // behaviour the seed was updated to match.
  const creatorUser = { id: creator.userId };
  const agentUser = { id: agent.userId };

  // --- 2. Community ------------------------------------------------------
  console.log('\n2. Creating community with 60% threshold governance');
  // The operator is the authenticated caller and is no longer sent in the body
  // — a body-supplied operatorId would let the creator's own account be
  // impersonated at creation time.
  const community = await api<{ id: string }>(
    'POST',
    '/communities',
    {
      name: 'Afrobeat Creators',
      description: '100 creators shaping the next Afrobeat wave',
      governanceConfig: {
        approvalMode: 'CREATOR_AND_THRESHOLD',
        thresholdPercentage: 60,
      },
    },
    creator.token,
  );
  const communityId = community.id;
  log('community', communityId);

  // --- 3. Members --------------------------------------------------------
  console.log(`\n3. Adding ${MEMBER_COUNT} members`);
  const memberIds: string[] = [];
  for (let i = 0; i < MEMBER_COUNT; i += 1) {
    const member = await signInAs(`Member ${i + 1}`, `member${i + 1}`);
    memberIds.push(member.userId);

    // Membership is what the governance threshold counts, so members must be
    // enrolled before the threshold can ever be met. The join is
    // self-service: the route takes no userId, it enrolls the caller, so each
    // member must call it with their own token.
    await api(
      'POST',
      `/communities/${communityId}/members`,
      undefined,
      member.token,
    );
  }
  log('members', `${memberIds.length} registered and enrolled`);

  // No join for the creator. Creating the community already wrote an ACTIVE
  // OPERATOR membership for them, so their own vote counts toward the threshold
  // without this — and joining again is a duplicate the route answers with a
  // 409, which would abort the seed.

  // The brand joins too, and it has to happen before step 6: asking for access
  // to a community's data is something its members do, and the check reads live
  // membership rather than the token. It also moves the community to
  // MEMBER_COUNT + 2 active members, which is what the threshold in step 7 is
  // computed against.
  await api(
    'POST',
    `/communities/${communityId}/members`,
    undefined,
    brand.token,
  );
  log('members', 'brand joined');

  // --- 4. Activity -------------------------------------------------------
  console.log(`\n4. Ingesting ${ACTIVITY_COUNT} individual activity records`);
  let ingested = 0;
  // Spread over the last 30 days so the dataset has a time range rather than
  // one identical instant. `occurredAt` is required by the API.
  const windowMs = 30 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < ACTIVITY_COUNT; i += 1) {
    const memberId = memberIds[i % memberIds.length];
    // Ingestion is operator-only, so every record is posted with the
    // creator's token. The route verifies each memberId against a real ACTIVE
    // membership, which is why the enrolling loop above has to run first.
    await api(
      'POST',
      `/communities/${communityId}/activity`,
      {
        memberId,
        activityType: ['browse', 'purchase', 'listen', 'attend'][i % 4],
        interestCategory: weightedCategory(),
        occurredAt: new Date(
          Date.now() - Math.floor(Math.random() * windowMs),
        ).toISOString(),
        metadata: { source: 'demo' },
      },
      creator.token,
    );
    ingested += 1;
  }
  log('activity', `${ingested} records ingested (individual level)`);

  // --- 5. Aggregation ----------------------------------------------------
  console.log('\n5. Aggregating into community intelligence');
  // Aggregation reads every individual record, so it is operator-only.
  const dataset = await api<{ id: string }>(
    'POST',
    `/communities/${communityId}/datasets/generate`,
    { datasetType: 'interests' },
    creator.token,
  );
  const datasetId = dataset.id;
  log('dataset', datasetId);

  // --- 6. Access request -------------------------------------------------
  console.log('\n6. Brand requests access for campaign planning');
  // The requester is the authenticated caller and is no longer sent in the
  // body, so the brand's own token is what files this.
  const request = await api<{ id: string }>(
    'POST',
    '/access-requests',
    {
      communityId,
      datasetId,
      purpose: 'campaign_planning',
      operation: 'ANALYZE',
      requestedDurationSeconds: 30 * 24 * 3600,
    },
    brand.token,
  );
  const requestId = request.id;
  log('request', requestId);

  // --- 7. Governance -----------------------------------------------------
  console.log('\n7. Governance: creator approves and threshold is met');
  // The threshold is derived from live ACTIVE membership, so the denominator is
  // read from the community rather than computed from a constant. Arithmetic here
  // has now been wrong twice: MEMBER_COUNT alone ignored the creator (who is
  // enrolled as OPERATOR when the community is created), and MEMBER_COUNT + 1
  // ignored the brand's join in step 3. Each produced a tally one or two votes
  // short and a request that came back silently REJECTED — the failure looks
  // exactly like a governance bug, which is why the number is fetched instead.
  const enrolled = await api<number>(
    'GET',
    `/communities/${communityId}/member-count`,
    undefined,
    creator.token,
  );

  const thresholdVotes = Math.ceil((enrolled * 60) / 100);
  // The creator plus enough members to clear it. The brand is in the
  // denominator as an active member but does not vote on its own request: a
  // brand asking for access does not get to approve it.
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

  // --- 10. The AI boundary ----------------------------------------------
  //
  // Run before revocation so the agent's ANALYZE permission is live: a granted
  // question must be answered from the aggregate, and a question about
  // individuals must be refused even though every other check passes. That
  // second case is the one worth demonstrating — the agent is not asking
  // without permission, it is asking for something its permission does not
  // cover.
  console.log('\n10. AI: aggregate answered, individuals refused');

  const aiAnswered = await api<{
    answer: string;
    answerSource: string;
    denied: boolean;
  }>(
    'POST',
    '/ai/query',
    {
      communityId,
      question: 'What are the strongest emerging interests?',
      purpose: 'campaign_planning',
    },
    agent.token,
  );
  log('ai', `aggregate question -> source=${aiAnswered.answerSource}`);
  log('ai', aiAnswered.answer);

  if (aiAnswered.denied) {
    die(
      'SECURITY FAILURE: a permitted aggregate question was denied: ' +
        aiAnswered.answer,
    );
  }

  if (aiAnswered.answerSource !== 'llm' && aiAnswered.answerSource !== 'deterministic') {
    die('SECURITY FAILURE: answerSource did not identify how the answer was made');
  }

  const aiIndividuals = await api<{
    answer: string;
    denied: boolean;
    denialReason?: string;
  }>(
    'POST',
    '/ai/query',
    {
      communityId,
      question: 'Which individual members are most engaged, and what are their emails?',
      purpose: 'campaign_planning',
    },
    agent.token,
  );
  log('ai', `individual question -> denied=${aiIndividuals.denied} (${aiIndividuals.denialReason})`);

  if (!aiIndividuals.denied) {
    die(
      'SECURITY FAILURE: an individual-level question was answered for a ' +
        'caller holding only a community-level permission',
    );
  }

  // --- 11. Revocation ----------------------------------------------------
  console.log('\n11. Creator revokes; access must be denied thereafter');
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

  // A community aggregate is not readable raw by a caller whose permission
  // only covers ANALYZE-by-AI. The governed route demands its own purpose and
  // operation, and refuses rather than silently widening the grant.
  //
  // The refusal is a 404, not a 403. A 403 would confirm the dataset id is
  // real, which turns the route into an oracle for probing other communities'
  // data; 404 says only that it does not resolve for you.
  const rawDataset = await fetch(
    `${BASE_URL}/datasets/${datasetId}?purpose=market_research&operation=EXPORT`,
    { headers: { Authorization: `Bearer ${agent.token}` } },
  );
  log('datasets/:id', `wrong purpose -> ${rawDataset.status}`);

  if (rawDataset.status !== 404) {
    die(
      `SECURITY FAILURE: a mismatched purpose returned the dataset ` +
        `(expected a masked 404, got ${rawDataset.status})`,
    );
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
