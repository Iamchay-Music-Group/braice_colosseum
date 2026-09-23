#!/usr/bin/env bash
set -euo pipefail

API="http://localhost:3001"

# ── Preflight checks ──────────────────────────────────────
if ! curl -sf "$API/api/users" > /dev/null 2>&1; then
  echo "ERROR: API not running at $API"
  echo "Run 'make up' or 'make dev' first."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q braice-postgres; then
  echo "ERROR: Postgres container not running"
  echo "Run 'make db-up' first."
  exit 1
fi

echo "── Seeding BRAICE demo data ──"

# ── Creator ────────────────────────────────────────────────
echo "Creating creator..."
CREATOR=$(curl -sf -X POST "$API/api/users" \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"Afrobeat King","userType":"CREATOR","walletAddress":"wallet_demo_001"}' | \
  python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "  Creator: $CREATOR"

# ── Community ──────────────────────────────────────────────
echo "Creating community..."
COMMUNITY=$(curl -sf -X POST "$API/api/communities" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Afrobeat Creators\",\"description\":\"The largest afrobeat creator community\",\"operatorId\":\"$CREATOR\",\"governanceConfig\":{\"approvalMode\":\"CREATOR_AND_THRESHOLD\",\"thresholdPercentage\":60}}" | \
  python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "  Community: $COMMUNITY"

# ── Members ────────────────────────────────────────────────
echo "Creating 100 members..."
for i in $(seq 1 100); do
  curl -sf -X POST "$API/api/users" \
    -H 'Content-Type: application/json' \
    -d "{\"displayName\":\"Member $i\",\"userType\":\"MEMBER\",\"walletAddress\":\"wallet_member_$(printf '%03d' $i)\"}" > /dev/null
done
echo "  100 members created"

# ── Join community ─────────────────────────────────────────
echo "Joining members to community..."
MEMBER_IDS=$(curl -sf "$API/api/users" | \
  python3 -c "import sys,json;[print(u['id']) for u in json.load(sys.stdin) if u['userType']=='MEMBER']")
for MID in $MEMBER_IDS; do
  curl -sf -X POST "$API/api/communities/$COMMUNITY/members" \
    -H 'Content-Type: application/json' \
    -d "{\"userId\":\"$MID\"}" > /dev/null
done
echo "  100 members joined"

# ── Activity records ───────────────────────────────────────
echo "Generating 1000 activity records..."
CATS="streetwear music_festivals sneakers beauty food nightlife fitness art technology"
TYPES="clicked viewed purchased bookmarked shared"

# Build member list once
ALL_MEMBERS=$(curl -sf "$API/api/users" | \
  python3 -c "import sys,json;[print(u['id']) for u in json.load(sys.stdin) if u['userType']=='MEMBER']")

COUNT=0
for MID in $ALL_MEMBERS; do
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
echo "Try: curl http://localhost:3001/api/communities/$COMMUNITY"
