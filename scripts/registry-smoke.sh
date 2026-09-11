#!/usr/bin/env bash
#
# End-to-end smoke test for the business registry (B2B Phase 0).
#
# Proves the full read/write path through the real Pages Functions runtime:
# migrations -> HTTP PUT (claim / conflict / verify / setTier / revoke) -> HTTP GET,
# then checks the audit trail that landed in registry_events.
#
# Usage:
#   bash scripts/registry-smoke.sh                       # local: migrate, serve, test, clean up
#   bash scripts/registry-smoke.sh --url https://<deployment> --token <admin-token>
#   KEEP=1 bash scripts/registry-smoke.sh                # leave the test rows behind
#
# Requires: curl, jq, npx (wrangler). Local mode serves `dist/` on PORT via
# `wrangler pages dev`, so it exercises the same handlers Cloudflare runs.
#
# Docs: docs/business-registry.md

set -euo pipefail

DB_NAME="barcelona-compare-registry"
PORT="${PORT:-8799}"
KEEP="${KEEP:-0}"
MODE="local"
BASE_URL=""
ADMIN_TOKEN="${ADMIN_TOKEN:-local-dev-token}"
LOG_FILE="$(mktemp -t registry-smoke-log)"

while [ $# -gt 0 ]; do
  case "$1" in
    --url) MODE="remote"; BASE_URL="${2%/}"; shift 2 ;;
    --token) ADMIN_TOKEN="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected [$2], got [$3])"; fi
}

for tool in curl jq npx; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 2; }
done

PLACE_ID="smoke-$(date +%Y%m%d%H%M%S)-$$"
OWNER_EMAIL="smoke-$$@example.com"
OWNER_EMAIL_UPPER="$(printf '%s' "$OWNER_EMAIL" | tr '[:lower:]' '[:upper:]')"
OTHER_EMAIL="hijack-$$@example.com"

if [ "$MODE" = remote ] && [ "$ADMIN_TOKEN" = "local-dev-token" ]; then
  echo "remote mode needs the real admin token: --token <token> or ADMIN_TOKEN=<token>" >&2
  exit 2
fi

# ---------------------------------------------------------------- local server
if [ "$MODE" = local ]; then
  cd "$(git rev-parse --show-toplevel)"
  [ -d dist ] || npm run build

  echo "== migrations (local D1: $DB_NAME)"
  npx --yes wrangler d1 migrations apply "$DB_NAME" --local 2>&1 | tail -3

  echo "== starting wrangler pages dev on :$PORT"
  npx --yes wrangler pages dev dist \
    --port "$PORT" \
    --binding "REGISTRY_ADMIN_TOKEN=$ADMIN_TOKEN" \
    --show-interactive-dev-session=false \
    --log-level warn >"$LOG_FILE" 2>&1 &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' EXIT

  BASE_URL="http://127.0.0.1:$PORT"
  ready=0
  for _ in $(seq 1 90); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/registry?limit=1" || true)" = "200" ]; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" != 1 ]; then
    echo "server did not become ready; log tail:" >&2
    tail -30 "$LOG_FILE" >&2
    exit 1
  fi
  echo "== server ready"
fi

D1_TARGET="--local"
[ "$MODE" = remote ] && D1_TARGET="--remote"

# ------------------------------------------------------------------ assertions
BODY_FILE="$(mktemp -t registry-smoke-body)"
STATUS=""
BODY=""

req() { # req <METHOD> <path> [json-body] [admin-token]
  local method="$1" path="$2" data="${3:-}" token="${4:-}"
  local args=(-s -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  if [ -n "$data" ]; then args+=(-H 'content-type: application/json' -d "$data"); fi
  if [ -n "$token" ]; then args+=(-H "x-registry-admin-token: $token"); fi
  STATUS="$(curl "${args[@]}")"
  BODY="$(cat "$BODY_FILE")"
}
q() { jq -r "$1" <<<"$BODY"; }

echo "== read/write path ($BASE_URL), test place_id: $PLACE_ID"

req GET "/api/registry/$PLACE_ID"
check "unknown place_id -> 404" "404" "$STATUS"
check "unknown place_id -> not_found" "not_found" "$(q .error)"

req PUT "/api/registry/$PLACE_ID" "{\"op\":\"claim\",\"ownerEmail\":\"$OWNER_EMAIL\"}"
check "write without admin token -> 401" "401" "$STATUS"

req PUT "/api/registry/$PLACE_ID" "{\"op\":\"claim\",\"ownerEmail\":\"$OWNER_EMAIL\"}" "$ADMIN_TOKEN"
check "claim -> 200" "200" "$STATUS"
check "claim sets claimed=true" "true" "$(q .business.claimed)"
check "claim sets ownerEmail (normalized)" "$OWNER_EMAIL" "$(q .business.ownerEmail)"
check "claim leaves verified=false" "false" "$(q .business.verified)"
check "claim leaves tier=free" "free" "$(q .business.tier)"
CLAIMED_AT="$(q .business.claimedAt)"
if [ -n "$CLAIMED_AT" ] && [ "$CLAIMED_AT" != "null" ]; then pass "claim sets claimedAt"; else fail "claim sets claimedAt (got [$CLAIMED_AT])"; fi

req PUT "/api/registry/$PLACE_ID" "{\"op\":\"claim\",\"ownerEmail\":\"$OTHER_EMAIL\"}" "$ADMIN_TOKEN"
check "claim by a different owner -> 409" "409" "$STATUS"
check "claim by a different owner -> already_claimed" "already_claimed" "$(q .error)"

req PUT "/api/registry/$PLACE_ID" "{\"op\":\"claim\",\"ownerEmail\":\"$OWNER_EMAIL_UPPER\"}" "$ADMIN_TOKEN"
check "re-claim by the same owner -> 200 (idempotent)" "200" "$STATUS"
check "re-claim keeps original claimedAt" "$CLAIMED_AT" "$(q .business.claimedAt)"

req PUT "/api/registry/$PLACE_ID" '{"op":"claim","ownerEmail":"not-an-email"}' "$ADMIN_TOKEN"
check "invalid owner email -> 400" "400" "$STATUS"
check "invalid owner email -> invalid_email" "invalid_email" "$(q .error)"

req PUT "/api/registry/$PLACE_ID" '{"op":"verify"}' "$ADMIN_TOKEN"
check "verify -> 200" "200" "$STATUS"
check "verify sets verified=true" "true" "$(q .business.verified)"
VERIFIED_AT="$(q .business.verifiedAt)"
if [ -n "$VERIFIED_AT" ] && [ "$VERIFIED_AT" != "null" ]; then pass "verify sets verifiedAt"; else fail "verify sets verifiedAt (got [$VERIFIED_AT])"; fi

req PUT "/api/registry/$PLACE_ID" '{"op":"verify"}' "$ADMIN_TOKEN"
check "verify twice -> 200 (idempotent)" "200" "$STATUS"
check "verify twice keeps verifiedAt" "$VERIFIED_AT" "$(q .business.verifiedAt)"

req PUT "/api/registry/$PLACE_ID" '{"op":"setTier","tier":"bogus"}' "$ADMIN_TOKEN"
check "unknown tier -> 400" "400" "$STATUS"
check "unknown tier -> invalid_tier" "invalid_tier" "$(q .error)"

req PUT "/api/registry/$PLACE_ID" '{"op":"setTier","tier":"pro"}' "$ADMIN_TOKEN"
check "setTier pro -> 200" "200" "$STATUS"
check "setTier sets tier=pro" "pro" "$(q .business.tier)"

req GET "/api/registry/$PLACE_ID"
check "public GET -> 200" "200" "$STATUS"
check "public GET hides ownerEmail (PII)" "false" "$(q '.business | has("ownerEmail")')"
check "public GET hides notes (PII)" "false" "$(q '.business | has("notes")')"
check "public GET exposes verified" "true" "$(q .business.verified)"
check "public GET exposes tier" "pro" "$(q .business.tier)"

req GET "/api/registry/$PLACE_ID?events=1" "" "$ADMIN_TOKEN"
check "admin GET exposes ownerEmail" "$OWNER_EMAIL" "$(q .business.ownerEmail)"

req GET "/api/registry?status=verified"
check "list verified -> 200" "200" "$STATUS"
check "list verified includes the business" "true" "$(q '.businesses | map(.placeId) | index("'"$PLACE_ID"'") != null')"

req GET "/api/registry?status=all"
check "list status=all without token -> 401" "401" "$STATUS"

req PUT "/api/registry/$PLACE_ID" '{"op":"revoke","reason":"smoke test"}' "$ADMIN_TOKEN"
check "revoke -> 200" "200" "$STATUS"
check "revoke clears claimed" "false" "$(q .business.claimed)"
check "revoke clears verified" "false" "$(q .business.verified)"
check "revoke clears ownerEmail" "null" "$(q .business.ownerEmail)"
check "revoke resets tier" "free" "$(q .business.tier)"

req PUT "/api/registry/$PLACE_ID" '{"op":"verify"}' "$ADMIN_TOKEN"
check "verify after revoke -> 409" "409" "$STATUS"
check "verify after revoke -> not_claimed" "not_claimed" "$(q .error)"

# ------------------------------------------------------------------ audit trail
echo "== audit trail (registry_events)"
EVENTS="$(npx --yes wrangler d1 execute "$DB_NAME" "$D1_TARGET" --json \
  --command "SELECT event, actor FROM registry_events WHERE place_id = '$PLACE_ID' ORDER BY id" 2>/dev/null \
  | jq -r '.[0].results | map(.event) | join(",")')"
check "events recorded in order" "claim,verify,tier_change,revoke" "$EVENTS"

# ---------------------------------------------------------------------- cleanup
if [ "$KEEP" != 1 ]; then
  npx --yes wrangler d1 execute "$DB_NAME" "$D1_TARGET" --yes \
    --command "DELETE FROM registry_events WHERE place_id = '$PLACE_ID'; DELETE FROM businesses WHERE place_id = '$PLACE_ID';" >/dev/null 2>&1 || \
    echo "  warn  could not delete the test rows from $DB_NAME"
  req GET "/api/registry/$PLACE_ID"
  check "cleanup removed the test business" "404" "$STATUS"
fi

echo
echo "registry smoke test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
