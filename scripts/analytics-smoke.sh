#!/usr/bin/env bash
#
# End-to-end smoke test for per-business event tracking (B2B analytics).
#
# Proves the full path through the real Pages Functions runtime:
#   migration -> POST /api/track (view + 4 click types) -> aggregation at write time
#   -> GET /api/analytics/:placeId and /api/analytics read the counters back -> cleanup.
#
# Usage:
#   bash scripts/analytics-smoke.sh                        # local: migrate, serve, test, clean up
#   bash scripts/analytics-smoke.sh --url https://<deployment> --token <admin-token>
#   KEEP=1 bash scripts/analytics-smoke.sh                 # leave the test rows behind
#
# Requires: curl, jq, npx (wrangler). Local mode serves `dist/` on PORT via
# `wrangler pages dev`, so it exercises the same handlers Cloudflare runs.
#
# Docs: docs/business-analytics.md

set -euo pipefail

DB_NAME="barcelona-compare-registry"
PORT="${PORT:-8798}"
KEEP="${KEEP:-0}"
MODE="local"
BASE_URL=""
ADMIN_TOKEN="${ADMIN_TOKEN:-local-dev-token}"
LOG_FILE="$(mktemp -t analytics-smoke-log)"

while [ $# -gt 0 ]; do
  case "$1" in
    --url) MODE="remote"; BASE_URL="${2%/}"; shift 2 ;;
    --token) ADMIN_TOKEN="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
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

# A synthetic, well-formed place id (Google-shaped: alphanumeric, >= 10 chars) and a
# second one that must stay empty (the report has to say "0 views", not "not found").
PLACE_ID="smokeChIJeventtrack$$"
EMPTY_ID="smokeChIJnoevents$$"
MONTH="$(date +%Y-%m)"
TODAY="$(date +%Y-%m-%d)"

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
BODY_FILE="$(mktemp -t analytics-smoke-body)"
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

echo "== write path (POST /api/track), test place_id: $PLACE_ID"

req POST "/api/track" "{\"placeId\":\"$PLACE_ID\",\"type\":\"view\"}"
check "view -> 204" "204" "$STATUS"

# Same (place, day, type) again: the counter must aggregate, not duplicate.
req POST "/api/track" "{\"placeId\":\"$PLACE_ID\",\"type\":\"view\"}"
check "second view -> 204" "204" "$STATUS"

for type in click_phone click_whatsapp click_website click_directions; do
  req POST "/api/track" "{\"placeId\":\"$PLACE_ID\",\"type\":\"$type\"}"
  check "$type -> 204" "204" "$STATUS"
done

req POST "/api/track" "{\"placeId\":\"$PLACE_ID\",\"type\":\"click_bogus\"}"
check "unknown type -> 400" "400" "$STATUS"
check "unknown type -> invalid_body" "invalid_body" "$(q .error)"

req POST "/api/track" '{"placeId":"short","type":"view"}'
check "malformed placeId -> 400" "400" "$STATUS"

req POST "/api/track" '{"placeId":'
check "invalid JSON -> 400" "400" "$STATUS"

req GET "/api/track"
check "GET /api/track -> 405" "405" "$STATUS"

echo "== read path (GET /api/analytics)"

req GET "/api/analytics/$PLACE_ID?month=$MONTH"
check "read without admin token -> 401" "401" "$STATUS"

req GET "/api/analytics/$PLACE_ID?month=$MONTH" "" "$ADMIN_TOKEN"
check "per-business read -> 200" "200" "$STATUS"
check "views counted twice" "2" "$(q .views)"
check "phone clicks" "1" "$(q '.clicks.phone')"
check "whatsapp clicks" "1" "$(q '.clicks.whatsapp')"
check "website clicks" "1" "$(q '.clicks.website')"
check "directions clicks" "1" "$(q '.clicks.directions')"
check "clickTotal" "4" "$(q .clickTotal)"
check "total" "6" "$(q .total)"
check "day breakdown has one row for today" "1" "$(q '.days | map(select(.date == "'"$TODAY"'")) | length')"
check "day breakdown views for today" "2" "$(q '.days | map(select(.date == "'"$TODAY"'")) | .[0].views')"

req GET "/api/analytics/$PLACE_ID?from=$TODAY&to=$TODAY" "" "$ADMIN_TOKEN"
check "explicit from/to range -> 200" "200" "$STATUS"
check "explicit range total" "6" "$(q .total)"

req GET "/api/analytics/$EMPTY_ID?month=$MONTH" "" "$ADMIN_TOKEN"
check "business with no events -> 200" "200" "$STATUS"
check "business with no events -> 0 views" "0" "$(q .views)"

req GET "/api/analytics?month=$MONTH" "" "$ADMIN_TOKEN"
check "summary read -> 200" "200" "$STATUS"
check "summary includes the test business" "true" \
  "$(q '.places | map(.placeId) | index("'"$PLACE_ID"'") != null')"
check "summary views for the test business" "2" \
  "$(q '.places | map(select(.placeId == "'"$PLACE_ID"'")) | .[0].views')"

req GET "/api/analytics?month=not-a-month" "" "$ADMIN_TOKEN"
check "bad month -> 400" "400" "$STATUS"
check "bad month -> invalid_query" "invalid_query" "$(q .error)"

req GET "/api/analytics/$PLACE_ID?from=$TODAY" "" "$ADMIN_TOKEN"
check "from without to -> 400" "400" "$STATUS"

req GET "/api/analytics/$PLACE_ID?month=$MONTH" "" "wrong-token"
check "wrong admin token -> 401" "401" "$STATUS"

# ------------------------------------------------------------- storage shape
echo "== storage (business_events): one aggregated row per (place, day, type)"
STORED="$(npx --yes wrangler d1 execute "$DB_NAME" "$D1_TARGET" --json \
  --command "SELECT COUNT(*) AS rows, COALESCE(SUM(count), 0) AS events FROM business_events WHERE place_id = '$PLACE_ID'" 2>/dev/null \
  | jq -r '.[0].results[0] | "\(.rows) \(.events)"')"
check "5 rows / 6 events in D1" "5 6" "$STORED"

# ---------------------------------------------------------------------- cleanup
if [ "$KEEP" != 1 ]; then
  npx --yes wrangler d1 execute "$DB_NAME" "$D1_TARGET" --yes \
    --command "DELETE FROM business_events WHERE place_id IN ('$PLACE_ID', '$EMPTY_ID');" >/dev/null 2>&1 || \
    echo "  warn  could not delete the test rows from $DB_NAME"
  req GET "/api/analytics/$PLACE_ID?month=$MONTH" "" "$ADMIN_TOKEN"
  check "cleanup removed the test events" "0" "$(q .total)"
fi

echo
echo "analytics smoke test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
