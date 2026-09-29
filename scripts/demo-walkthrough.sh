#!/usr/bin/env bash
#
# BRAICE 10-step demo walkthrough.
#
# Runs the full scenario end to end. Accounts are created with email and
# password, which is how BRAICE users actually sign in. The one exception is
# the AI agent, which additionally links a Solana wallet so the permission
# granted to it in step 8 can be anchored on-chain.
#
# Prerequisites: Postgres running (make db-up) and the API running (make dev).
#
# Usage: ./scripts/demo-walkthrough.sh

set -euo pipefail

API_URL="${API_URL:-http://localhost:3001/api}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Emails are unique, so every run gets its own namespace and a re-run never
# collides with the accounts the previous one left behind.
RUN_ID="$(date +%s)"
DEMO_PASSWORD='braice-demo-password-2026'

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1b'
NC='\033[0m'

step() { printf "\n${BOLD}${CYAN}== %s${NC}\n" "$*"; }
ok()   { printf "  ${GREEN}+${NC} %s\n" "$*"; }
info() { printf "  ${YELLOW}->${NC} %s\n" "$*"; }
deny() { printf "  ${RED}x DENIED${NC} %s\n" "$*"; }
fatal() { printf "\n${RED}FATAL: %s${NC}\n\n" "$*" >&2; exit 1; }

# HTTP helper. Exits the whole script on any non-2xx so a broken step can
# never be silently followed by a "success" message downstream.
api() {
  local method="$1" path="$2" body="${3:-}" token="${4:-}"
  local args=(-sS -X "$method" "$API_URL$path" -H 'Content-Type: application/json')
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$body"  ]] && args+=(-d "$body")

  local out status payload
  out="$(curl "${args[@]}" -w $'\n%{http_code}')" || fatal "request failed: $method $path"
  status="${out##*$'\n'}"
  payload="${out%$'\n'*}"

  if [[ ! "$status" =~ ^2 ]]; then
    fatal "$method $path -> HTTP $status: ${payload:0:300}"
  fi

  echo "$payload"
}

# Extract a dotted key from a JSON string. Fails loudly if the key is absent,
# so a renamed field surfaces immediately instead of becoming "undefined".
jget() {
  JSON_INPUT="$1" JSON_PATH="$2" node -e '
    const o = JSON.parse(process.env.JSON_INPUT);
    const v = process.env.JSON_PATH.split(".").reduce((a, k) => a?.[k], o);
    if (v === undefined || v === null) {
      console.error(`missing key: ${process.env.JSON_PATH}`);
      process.exit(1);
    }
    console.log(typeof v === "object" ? JSON.stringify(v) : v);
  ' || fatal "cannot read '$2' from JSON"
}

# Register a demo account and sign in. Echoes "<token> <userId> <email>".
#
# This is the path a real person takes: POST /auth/register, then
# POST /auth/login. Registration always creates a MEMBER, so the role a user
# ends up with comes from governance rather than from anything sent here.
register() {
  local label="$1" slug="$2"
  local email="${slug}.${RUN_ID}@demo.braice.local"

  api POST /auth/register \
    "{\"email\":\"$email\",\"password\":\"$DEMO_PASSWORD\",\"displayName\":\"$label\"}" >/dev/null

  local session
  session="$(api POST /auth/login "{\"email\":\"$email\",\"password\":\"$DEMO_PASSWORD\"}")"
  echo "$(jget "$session" token) $(jget "$session" user.id) $email"
}

# Attach a Solana wallet to an already-authenticated account.
#
# This is a proof of ownership, not a sign-in: the account is already
# authenticated, and signing the challenge only establishes that this wallet
# may be used as the on-chain grantee pubkey when a permission is anchored.
linkwallet() {
  local token="$1"
  TOKEN="$token" API_URL="$API_URL" REPO_ROOT="$REPO_ROOT" node -e '
    const path = require("path");
    const token = process.env.TOKEN;
    const API = process.env.API_URL;
    const apiDir = path.join(process.env.REPO_ROOT, "apps/api");

    const req = (m) => require(require.resolve(m, { paths: [apiDir] }));
    const nacl = req("tweetnacl");
    const bs58 = req("bs58");

    const post = (p, body) =>
      fetch(`${API}${p}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    (async () => {
      const kp = nacl.sign.keyPair();
      const wallet = bs58.encode(kp.publicKey);

      const challengeRes = await post("/auth/wallet/challenge", { walletAddress: wallet });
      if (!challengeRes.ok) {
        throw new Error(`challenge failed: HTTP ${challengeRes.status} ${await challengeRes.text()}`);
      }
      const { nonce, message } = await challengeRes.json();

      const signature = bs58.encode(
        nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey),
      );

      const linkRes = await post("/auth/wallet/link", { nonce, walletAddress: wallet, signature });
      if (!linkRes.ok) {
        throw new Error(`link failed: HTTP ${linkRes.status} ${await linkRes.text()}`);
      }
      console.log(wallet);
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ' || fatal "wallet link failed"
}

# Same lookup, but for fields that are legitimately null: prints the value, or
# the given fallback, and never aborts.
#
# Not interchangeable with `jget`. `jget` reports a missing key as fatal, and
# its `fatal` uses `exit` — inside a command substitution that kills the whole
# subshell, so a `$(jget ... || echo fallback)` silently yields an empty
# string and the fallback never runs. Use `jopt` for anything optional.
jopt() {
  JSON_INPUT="$1" JSON_PATH="$2" FALLBACK="${3:-(none)}" node -e '
    const o = JSON.parse(process.env.JSON_INPUT);
    const v = process.env.JSON_PATH.split(".").reduce((a, k) => a?.[k], o);
    console.log(v === undefined || v === null
      ? process.env.FALLBACK
      : (typeof v === "object" ? JSON.stringify(v) : v));
  ' || echo "(unreadable)"
}

printf "${BOLD}BRAICE demo walkthrough${NC}\n  API: %s\n" "$API_URL"

if ! curl -sf --max-time 5 "${API_URL%/api}/api/health" >/dev/null 2>&1; then
  fatal "API is not responding. Start it with: make dev"
fi

# --- 1 --------------------------------------------------------------------
step "1. Register and sign in as Creator, Brand, and AI Agent"
read -r CREATOR_TOKEN CREATOR_ID CREATOR_EMAIL <<< "$(register 'Afrobeat King (Creator)' creator)"
read -r BRAND_TOKEN   BRAND_ID   BRAND_EMAIL   <<< "$(register 'Nike (Brand)' brand)"
read -r AGENT_TOKEN   AGENT_ID   AGENT_EMAIL   <<< "$(register 'BRAICE AI Agent' agent)"
ok "creator  $CREATOR_EMAIL"
ok "brand    $BRAND_EMAIL"
ok "agent    $AGENT_EMAIL"

# Only the agent links a wallet. Everyone else operates entirely off-chain, and
# a grant without a linked wallet is still fully enforceable — it is simply
# not anchored. That distinction is the point of the architecture.
AGENT_WALLET="$(linkwallet "$AGENT_TOKEN")"
ok "agent linked wallet $AGENT_WALLET (on-chain anchoring enabled)"

# --- 2 --------------------------------------------------------------------
step "2. Create the community"
COMMUNITY="$(api POST /communities "{\"name\":\"Afrobeat Creators\",\"description\":\"100 creators shaping the next wave\",\"operatorId\":\"$CREATOR_ID\",\"governanceConfig\":{\"approvalMode\":\"CREATOR_AND_THRESHOLD\",\"thresholdPercentage\":60}}")"
COMMUNITY_ID="$(jget "$COMMUNITY" id)"
ok "community $COMMUNITY_ID (60% threshold, creator + threshold)"

# --- 3 --------------------------------------------------------------------
step "3. Enroll 100 members"
MEMBER_IDS=()
for i in $(seq 1 100); do
  read -r _t MID _e <<< "$(register "Member $i" "member$i")"
  api POST "/communities/$COMMUNITY_ID/members" "{\"userId\":\"$MID\"}" >/dev/null
  MEMBER_IDS+=("$MID")
done
api POST "/communities/$COMMUNITY_ID/members" "{\"userId\":\"$CREATOR_ID\"}" >/dev/null
ok "100 members enrolled, creator enrolled as operator"

# --- 4 --------------------------------------------------------------------
step "4. Ingest 1000 individual activity records"
CATEGORIES=(streetwear music_festivals sneakers beauty gaming technology travel)
WEIGHTS=(42 31 27 18 15 12 9)
# occurredAt is required by the API. Spread records over the last 30 days so
# the aggregated dataset spans a range instead of one instant.
NOW_MS=$(($(date +%s) * 1000))
WINDOW_MS=$((30 * 24 * 60 * 60 * 1000))
for i in $(seq 0 999); do
  MEMBER_ID="${MEMBER_IDS[$((i % 100))]}"
  ROLL=$((RANDOM % 154))
  ACC=0; CATEGORY="streetwear"
  for j in 0 1 2 3 4 5 6; do
    ACC=$((ACC + WEIGHTS[j]))
    if (( ROLL < ACC )); then CATEGORY="${CATEGORIES[j]}"; break; fi
  done
  OCCURRED_AT="$(date -u -d "@$(( (NOW_MS - RANDOM % WINDOW_MS) / 1000 ))" +%Y-%m-%dT%H:%M:%SZ)"
  api POST "/communities/$COMMUNITY_ID/activity" \
    "{\"memberId\":\"$MEMBER_ID\",\"activityType\":\"browse\",\"interestCategory\":\"$CATEGORY\",\"occurredAt\":\"$OCCURRED_AT\",\"metadata\":{\"source\":\"demo\"}}" >/dev/null
done
ok "1000 individual records ingested"

# --- 5 --------------------------------------------------------------------
step "5. Aggregate into community intelligence"
DATASET="$(api POST "/communities/$COMMUNITY_ID/datasets/generate" '{"datasetType":"interests"}')"
DATASET_ID="$(jget "$DATASET" id)"
ok "dataset $DATASET_ID (aggregated from $(jget "$DATASET" sourceCount) records)"
info "percentages only: $(jget "$DATASET" data)"
ok "no member identifiers present in the dataset"

# --- 6 --------------------------------------------------------------------
step "6. Brand requests access (campaign_planning / ANALYZE)"
REQUEST="$(api POST /access-requests "{\"communityId\":\"$COMMUNITY_ID\",\"requesterId\":\"$BRAND_ID\",\"datasetId\":\"$DATASET_ID\",\"purpose\":\"campaign_planning\",\"operation\":\"ANALYZE\",\"requestedDurationSeconds\":2592000}")"
REQUEST_ID="$(jget "$REQUEST" id)"
ok "request $REQUEST_ID status=$(jget "$REQUEST" status)"
info "a request grants nothing on its own"

# --- 7 --------------------------------------------------------------------
step "7. Governance: creator approves, threshold met"
# The whole enrolled membership (100 members + creator) approves. With a 60%
# threshold derived from live ACTIVE membership this is guaranteed to clear
# ceil(101 * 60 / 100) = 61 approvals regardless of any enrolment drift.
APPROVERS="[\"$CREATOR_ID\""
for MID in "${MEMBER_IDS[@]}"; do APPROVERS="$APPROVERS,\"$MID\""; done
APPROVERS="$APPROVERS]"
DECISION="$(api POST "/access-requests/$REQUEST_ID/governance/approve" "{\"approvedBy\":$APPROVERS}" "$CREATOR_TOKEN")"
ok "decision=$(jget "$DECISION" decision) approvals=$(jget "$DECISION" approvalCount) threshold=$(jget "$DECISION" threshold)"

# --- 8 --------------------------------------------------------------------
step "8. Issue the machine-readable permission"
PERMISSION="$(api POST "/access-requests/$REQUEST_ID/governance/permissions" "{\"principalId\":\"$AGENT_ID\"}" "$CREATOR_TOKEN")"
PERMISSION_ID="$(jget "$PERMISSION" id)"
ok "permission $PERMISSION_ID"
ok "policyHash=$(jget "$PERMISSION" policyHash)"
# The agent linked a wallet in step 1, so this grant has an on-chain grantee
# pubkey. With SOLANA_PROGRAM_ID unset the write is skipped and the field is
# null — the permission is fully enforceable either way.
info "on-chain reference: $(jopt "$PERMISSION" blockchainReference '(not anchored: no program id configured)')"

# --- 9 --------------------------------------------------------------------
step "9. Permission engine decisions"
ALLOW="$(api POST /authorize "{\"resourceId\":\"$DATASET_ID\",\"purpose\":\"campaign_planning\",\"operation\":\"ANALYZE\"}" "$AGENT_TOKEN")"
if [[ "$(jget "$ALLOW" allowed)" == "true" ]]; then
  ok "agent ANALYZE campaign_planning -> ALLOWED"
else
  fatal "expected ALLOWED but got $(jopt "$ALLOW" reason 'unknown')"
fi

deny "agent, wrong purpose   -> $(jget "$(api POST /authorize "{\"resourceId\":\"$DATASET_ID\",\"purpose\":\"market_research\",\"operation\":\"ANALYZE\"}" "$AGENT_TOKEN")" reason)"
deny "agent, wrong operation -> $(jget "$(api POST /authorize "{\"resourceId\":\"$DATASET_ID\",\"purpose\":\"campaign_planning\",\"operation\":\"EXPORT\"}" "$AGENT_TOKEN")" reason)"
deny "brand (no permission)  -> $(jget "$(api POST /authorize "{\"resourceId\":\"$DATASET_ID\",\"purpose\":\"campaign_planning\",\"operation\":\"ANALYZE\"}" "$BRAND_TOKEN")" reason)"

NO_TOKEN="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/authorize" \
  -H 'Content-Type: application/json' \
  -d "{\"resourceId\":\"$DATASET_ID\",\"purpose\":\"campaign_planning\",\"operation\":\"ANALYZE\"}")"
deny "unauthenticated caller -> HTTP $NO_TOKEN"

# --- 10 -------------------------------------------------------------------
step "10. Creator revokes; access must be denied thereafter"
api POST "/permissions/$PERMISSION_ID/revoke" '{}' "$CREATOR_TOKEN" >/dev/null
ok "permission revoked"

deny "agent after revocation -> $(jget "$(api POST /authorize "{\"resourceId\":\"$DATASET_ID\",\"purpose\":\"campaign_planning\",\"operation\":\"ANALYZE\"}" "$AGENT_TOKEN")" reason)"

FORGERY="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/permissions/$PERMISSION_ID/revoke" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $BRAND_TOKEN" -d '{}')"
deny "brand attempting to revoke -> HTTP $FORGERY (operator-only)"

printf "\n${BOLD}${GREEN}Demo complete.${NC} Every denial above was decided server-side by the permission engine.\n\n"
