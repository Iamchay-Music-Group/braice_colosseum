/**
 * Deploy the BRAICE governance program to Solana devnet.
 *
 * Why this exists: `SOLANA_PROGRAM_ID` had the *deploy keypair's* address in it,
 * not a deployed program's. Nothing caught it because a well-formed base58
 * address passes every shape check the client performs — the failure only
 * appears as an opaque "Transaction simulation failed" at send time, on a chain
 * with no such account. This script derives the program id the only way that
 * cannot drift from the binary: by asking `solana program show` for the keypair
 * Anchor generated and reading its pubkey.
 *
 * Steps:
 *   1. anchor build
 *   2. Confirm the deploy authority is funded and the keypair matches declare_id!
 *   3. solana program deploy
 *   4. Verify the program account now exists and is executable
 *   5. Write SOLANA_PROGRAM_ID back to .env
 *
 * Run with: pnpm deploy:devnet
 * Flags:    --skip-build   reuse the existing .so
 *           --cluster X    devnet (default) | testnet | mainnet-beta
 *           --dry-run      build and verify the keypair, deploy nothing
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The repo root, found by walking up to `pnpm-workspace.yaml`.
 *
 * Not `resolve(process.cwd())`: this script runs under `pnpm --filter @braice/api
 * exec`, which leaves the working directory at apps/api, so the cwd is the API
 * package and every path derived from it points at apps/api/programs/... The
 * marker file is what makes the root unambiguous. `Anchor.toml` is the probe
 * rather than the generated IDL, which does not exist until `anchor build` runs.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (
      existsSync(resolve(dir, 'pnpm-workspace.yaml')) &&
      existsSync(resolve(dir, 'programs/braice-governance/Anchor.toml'))
    ) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) {
      console.error(
        'Could not locate the repo root: no pnpm-workspace.yaml with\n' +
          '  programs/braice-governance/Anchor.toml beneath it.',
      );
      process.exit(1);
    }
    dir = parent;
  }
}

const PROGRAM_DIR = resolve(repoRoot(), 'programs/braice-governance');
const PROGRAM_NAME = 'braice_governance';
const SO_PATH = resolve(PROGRAM_DIR, `target/deploy/${PROGRAM_NAME}.so`);
const IDL_PATH = resolve(PROGRAM_DIR, `target/idl/${PROGRAM_NAME}.json`);
const KEYPAIR_PATH = resolve(PROGRAM_DIR, `target/keys/${PROGRAM_NAME}-keypair.json`);

type Cluster = 'devnet' | 'testnet' | 'mainnet-beta';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const CLUSTER = (arg('cluster') ?? 'devnet') as Cluster;
const SKIP_BUILD = hasFlag('skip-build');
const DRY_RUN = hasFlag('dry-run');

const VALID_CLUSTERS: readonly Cluster[] = ['devnet', 'testnet', 'mainnet-beta'];
if (!VALID_CLUSTERS.includes(CLUSTER)) {
  console.error(
    `Unknown cluster "${CLUSTER}". Expected one of: ${VALID_CLUSTERS.join(', ')}`,
  );
  process.exit(1);
}

const RPC_URL =
  arg('url') ??
  process.env.SOLANA_RPC_URL ??
  (CLUSTER === 'devnet' ? 'https://api.devnet.solana.com' : `https://api.${CLUSTER}.solana.com`);

function step(msg: string): void {
  console.log(`\n▸ ${msg}`);
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string): never {
  console.error(`\n  ✗ ${msg}`);
  process.exit(1);
}

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; status?: number };
    const detail = (e.stderr || e.stdout || '').trim();
    fail(`${cmd} ${args.join(' ')} exited ${e.status}\n${detail}`);
  }
}

/** Run a command, echoing output live. For builds where progress matters. */
function runInherit(cmd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  try {
    execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  } catch {
    fail(`${cmd} ${args.join(' ')} failed`);
  }
}

/**
 * The program id, read from the IDL that `anchor build` just emitted.
 *
 * The IDL's `address` field is generated from `declare_id!`, so this is the one
 * value that is definitionally the program id and cannot drift. Reading the
 * keypair's pubkey instead would be equivalent here, but the IDL is also the
 * artifact a client consumes, so checking it catches an IDL built against a
 * different declare_id than the binary being deployed.
 */
function programIdFromIdl(): string {
  if (!existsSync(IDL_PATH)) {
    fail(`No IDL at ${IDL_PATH}. Run without --skip-build.`);
  }
  const idl = JSON.parse(readFileSync(IDL_PATH, 'utf8')) as { address?: string };
  if (!idl.address) {
    fail(`IDL at ${IDL_PATH} has no "address" field; refusing to guess.`);
  }
  return idl.address;
}

function keypairPubkey(path: string): string {
  if (!existsSync(path)) {
    fail(
      `No program keypair at ${path}.\n` +
        '  This keypair must be the one matching declare_id!(). It is ' +
        'gitignored, so a fresh clone has to generate it: solana-keygen new ' +
        '--no-bip39-passphrase --force --outdir target/keys --silent --program-id',
    );
  }
  return run('solana-keygen', ['pubkey', path]).trim();
}

async function accountInfo(address: string): Promise<unknown> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getAccountInfo',
    params: [address, { encoding: 'jsonParsed' }],
  });
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    fail(`RPC ${RPC_URL} returned ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { result?: { value?: unknown }; error?: unknown };
  if (json.error) {
    fail(`RPC error from ${RPC_URL}: ${JSON.stringify(json.error)}`);
  }
  return json.result?.value ?? null;
}

function balanceSol(): number {
  const out = run('solana', ['balance', '--url', RPC_URL, '--output', 'json']);
  const parsed = JSON.parse(out) as Array<{ lamports: number }>;
  return (parsed[0]?.lamports ?? 0) / 1e9;
}

async function main(): Promise<void> {
  console.log(`BRAICE governance program → ${CLUSTER}`);
  console.log(`  rpc  ${RPC_URL}`);
  if (DRY_RUN) console.log('  mode dry-run');

  // 1. Build.
  if (!SKIP_BUILD) {
    step('anchor build');
    runInherit('anchor', ['build'], { ANCHOR_PROGRAM_DIR: PROGRAM_DIR });
    ok('built');
  } else {
    step('anchor build (skipped)');
  }

  if (!existsSync(SO_PATH)) {
    fail(`No compiled program at ${SO_PATH}.`);
  }
  ok(`binary: ${SO_PATH} (${readFileSync(SO_PATH).length} bytes)`);

  // 2. Program id and keypair agreement.
  step('resolve program id');
  const programId = programIdFromIdl();
  const pubkey = keypairPubkey(KEYPAIR_PATH);
  if (pubkey !== programId) {
    fail(
      'The program keypair does not match declare_id!().\n' +
        `  IDL / declare_id!: ${programId}\n` +
        `  target/keys pubkey : ${pubkey}\n` +
        '  Deploying with --program-id pointing at a keypair the binary does ' +
        'not declare would put the program at an address no client derives. ' +
        'Regenerate the keypair or fix declare_id!() so the two agree.',
    );
  }
  ok(`program id ${programId} (keypair matches declare_id!)`);

  // 3. Deploy authority funded?
  step('check deploy authority balance');
  const sol = balanceSol();
  // A program deploy closes the program account and uploads ~200 KB of BPF.
  // 3 SOL covers rent plus a buffer; below that the upload fails partway.
  if (sol < 3) {
    fail(
      `Deploy authority holds ${sol.toFixed(4)} SOL on ${CLUSTER}, need ~3.\n` +
        `  Fund it: solana airdrop 5 --url ${RPC_URL}`,
    );
  }
  ok(`${sol.toFixed(4)} SOL available`);

  // 4. Already deployed?
  step('check current chain state');
  const before = (await accountInfo(programId)) as { executable?: boolean } | null;
  if (before) {
    ok(`already deployed on ${CLUSTER} (executable=${before.executable}) — redeploying`);
  } else {
    ok(`not present on ${CLUSTER} yet`);
  }

  if (DRY_RUN) {
    console.log('\nDry run complete. Nothing deployed.');
    return;
  }

  // 5. Deploy.
  step('solana program deploy');
  runInherit(
    'solana',
    [
      'program',
      'deploy',
      SO_PATH,
      '--program-id',
      KEYPAIR_PATH,
      '--url',
      RPC_URL,
    ],
    { ANCHOR_PROGRAM_DIR: PROGRAM_DIR },
  );

  // 6. Verify. A deploy that returns 0 but leaves no account is the failure mode
  //    this script exists to catch, so it is checked rather than assumed.
  step('verify deployment');
  const after = (await accountInfo(programId)) as { executable?: boolean } | null;
  if (!after) {
    fail(
      `Deploy reported success but no account exists at ${programId} on ${CLUSTER}.\n` +
        '  The transaction is probably still unconfirmed. Re-check with:\n' +
        `    solana program show ${programId} --url ${RPC_URL}`,
    );
  }
  if (!after.executable) {
    fail(`Account exists at ${programId} but is not executable. Check the deploy logs.`);
  }
  ok(`live and executable on ${CLUSTER}`);

  // 7. Write the id back, so .env cannot keep the wrong address.
  step('write SOLANA_PROGRAM_ID to .env');
  const envPath = resolve(repoRoot(), '.env');
  if (!existsSync(envPath)) {
    console.log(`  no .env at ${envPath}; skipping (set SOLANA_PROGRAM_ID yourself)`);
    return;
  }
  const original = readFileSync(envPath, 'utf8');
  const updated = /^[^\n]*SOLANA_PROGRAM_ID=.*$/m.test(original)
    ? original.replace(/^SOLANA_PROGRAM_ID=.*$/m, `SOLANA_PROGRAM_ID=${programId}`)
    : `${original.trimEnd()}\nSOLANA_PROGRAM_ID=${programId}\n`;
  writeFileSync(envPath, updated);
  ok(`SOLANA_PROGRAM_ID=${programId}`);

  console.log(`\nDeployed. Verify with:`);
  console.log(`  solana program show ${programId} --url ${RPC_URL}`);
  if (!process.env.SOLANA_KEYPAIR_PATH) {
    console.log(
      `\nNote: SOLANA_KEYPAIR_PATH is still unset, so the API will report\n` +
        '  blockchain: disabled even though the program is live. Point it at a\n' +
        '  funded keypair that IS the community authority.',
    );
  }
}

main().catch((err) => {
  console.error('\ndeploy crashed:', err);
  process.exit(1);
});
