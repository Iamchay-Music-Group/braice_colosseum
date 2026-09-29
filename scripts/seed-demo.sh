#!/usr/bin/env bash
#
# Seed BRAICE demo data.
#
# Accounts are created with email + password via POST /auth/register, which
# always produces a MEMBER. There is no endpoint that lets a caller pick its
# own role — the old public POST /api/users accepted an arbitrary userType and
# was removed for exactly that reason.
#
# The creator therefore has CREATOR's *behaviour* (it operates the community,
# and that is what the operator check in PermissionsService.revoke keys off)
# without needing to be granted a role in the users table.

set -euo pipefail

API="${API:-http://localhost:3001}"
RUN_ID="$(date +%s)"
DEMO_PASSWORD='braice-demo-password-2026'

# ── Preflight checks ──────────────────────────────────────
if ! curl -sf "$API/api/users" > /dev/null 2>&1; then
  echo "ERROR: API not running at $API"
  echo "Run 'make up' or 'make dev' first, or set API to point at it."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q braice-postgres; then
  echo "NOTE: no 'braice-postgres' container found."
  echo "Assuming Postgres is reachable another way (it answered the health check above)."
fi

echo "── Seeding BRAICE demo data ──"

# ── Creator ────────────────────────────────────────────────
echo "Creating creator..."
CREATOR_EMAIL="creator.${RUN_ID}@demo.braice.local"
CREATOR=$(curl -sf -X POST "$API/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$CREATOR_EMAIL\",\"password\":\"$DEMO_PASSWORD\",\"displayName\":\"Afrobeat King\"}" | \
  python3 -c "import sys,json;print(json.load(sys.stdin)['user']['id'])")
echo "  Creator: $CREATOR_EMAIL ($CREATOR)"

# ── Community ──────────────────────────────────────────────
echo "Creating community..."
COMMUNITY=$(curl -sf -X POST "$API/api/communities" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Afrobeat Creators\",\"description\":\"The largest afrobeat creator community\",\"operatorId\":\"$CREATOR\",\"governanceConfig\":{\"approvalMode\":\"CREATOR_AND_THRESHOLD\",\"thresholdPercentage\":60}}" | \
  python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "  Community: $COMMUNITY"

# ── Members ────────────────────────────────────────────────
echo "Creating 100 members..."
MEMBER_IDS=""
for i in $(seq 1 100); do
  MEMBER_ID=$(curl -sf -X POST "$API/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"member${i}.${RUN_ID}@demo.braice.local\",\"password\":\"$DEMO_PASSWORD\",\"displayName\":\"Member $i\"}" | \
    python3 -c "import sys,json;print(json.load(sys.stdin)['user']['id'])")
  MEMBER_IDS="$MEMBER_IDS $MEMBER_ID"
done
echo "  100 members created"

# ── Join community ─────────────────────────────────────────
echo "Joining members to community..."
for MID in $MEMBER_IDS; do
  curl -sf -X POST "$API/api/communities/$COMMUNITY/members" \
    -H 'Content-Type: application/json' \
    -d "{\"userId\":\"$MID\"}" > /dev/null
done
# The creator is enrolled too, which makes the governance denominator 101
# rather than 100.
curl -sf -X POST "$API/api/communities/$COMMUNITY/members" \
  -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$CREATOR\"}" > /dev/null
echo "  100 members + creator joined"

# ── Activity records ───────────────────────────────────────
echo "Generating 1000 activity records..."
CATS="streetwear music_festivals sneakers beauty food nightlife fitness art technology"
TYPES="clicked viewed purchased bookmarked shared"

COUNT=0
for MID in $MEMBER_IDS; do
  # Each member gets ~10 random activities
  for _ in $(seq 1 10); do
    CAT=$(echo "$CATS" | tr ' ' '\n' | shuf -n1)
    TYP=$(echo "$TYPES" | tr ' ' '\n' | shuf -n1)
    curl -sf -X POST "$API/api/communities/$COMMUNITY/activity" \
      -H 'Content-Type: application/json' \
      -d "{\"memberId\":\"$MID\",\"activityType\":\"$TYP\",\"interestCategory\":\"$CAT\",\"occurredAt\":\"2026-09-23T12:00:00Z\"}" > /dev/null
    COUNT=$((COUNT + 1))
  done
done
echo "  $COUNT activity records created"

echo ""
echo "── Seed complete ──"
echo "  Users:       $(curl -sf "$API/api/users" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")"
echo "  Members:     $(curl -sf "$API/api/communities/$COMMUNITY/member-count" | python3 -c "import sys,json;print(json.load(sys.stdin))")"
echo "  Activities:  $(curl -sf "$API/api/communities/$COMMUNITY/activity/count" | python3 -c "import sys,json;print(json.load(sys.stdin))")"
echo "  Community:   $COMMUNITY"
echo ""
echo "Sign in as the creator:"
echo "  curl -X POST $API/api/auth/login -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"$CREATOR_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}'"
echo ""
echo "Try: curl $API/api/communities/$COMMUNITY"
