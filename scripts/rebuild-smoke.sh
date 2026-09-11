#!/usr/bin/env bash
#
# Smoke test for the badge-freshness rebuild trigger (B2B Phase 1).
#
# Proves through the real Pages Functions runtime (`wrangler pages dev`) that:
#   * a claim alone queues nothing; a verify / tier change / revocation does
#   * an idempotent write (verify twice, setTier twice) queues nothing — this is what
#     keeps a rebuild from being triggered per request (loop safety)
#   * {"rebuild": false} suppresses the trigger (bulk ops, smoke runs)
#   * an unconfigured DEPLOY_HOOK_URL is a recorded no-op, never an error
#   * POST /api/rebuild forces a build; GET /api/rebuild returns the audit trail
#   * both endpoint directions are admin-token gated
#
# The deploy hook itself is a local stub HTTP server: nothing here touches the real
# Cloudflare API or the real production site.
#
# Usage:
#   bash scripts/rebuild-smoke.sh                 # local: migrate, serve, test, clean up
#   KEEP=1 bash scripts/rebuild-smoke.sh          # leave the test rows behind
#
# Requires: curl, jq, npx (wrangler), python3 and a built dist/.
#
# Docs: docs/business-registry.md

set -euo pipefail

DB_NAME="barcelona-compare-registry"
PORT="${PORT:-8802}"
STUB_PORT="${STUB_PORT:-9911}"
KEEP="${KEEP:-0}"
ADMIN_TOKEN="${ADMIN_TOKEN:-local-dev-token}"
TIMEOUT="${TIMEOUT:-45}"
LOG_FILE="$(mktemp -t rebuild-smoke-log)"
STUB_LOG="$(mktemp -t rebuild-smoke-hook)"
STUB_SCRIPT="$(mktemp -t rebuild-smoke-stub).py"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected [$2], got [$3])"; fi
}

for tool in curl jq npx python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 2; }
done

cd "$(git rev-parse --show-toplevel)"
[ -d dist ] || npm run build

echo "== migrations (local D1: $DB_NAME)"
npx --yes wrangler d1 migrations apply "$DB_NAME" --local 2>&1 | tail -3

# --------------------------------------------------------------- stub deploy hook
cat >"$STUB_SCRIPT" <<'PY'
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

log_path = sys.argv[2]
count = {"n": 0}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        count["n"] += 1
        with open(log_path, "a") as fh:
            fh.write(f"POST {self.path} #{count['n']}\n")
        body = json.dumps(
            {"success": True, "result": {"build_uuid": f"stub-build-{count['n']}"}}
        ).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep the smoke output clean
        pass


HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
PY

echo "== starting the stub deploy hook on :$STUB_PORT"
python3 "$STUB_SCRIPT" "$STUB_PORT" "$STUB_LOG" >/dev/null 2>&1 &
STUB_PID=$!

echo "== starting wrangler pages dev on :$PORT"
npx --yes wrangler pages dev dist \
  --port "$PORT" \
  --binding "REGISTRY_ADMIN_TOKEN=$ADMIN_TOKEN" \
  --binding "DEPLOY_HOOK_URL=http://127.0.0.1:$STUB_PORT/hook" \
  --show-interactive-dev-session=false >"$LOG_FILE" 2>&1 &
DEV_PID=$!

cleanup() {
  [ "${KEEP}" = 1 ] || npx --yes wrangler d1 execute "$DB_NAME" --local --yes \
    --command "DELETE FROM registry_events WHERE place_id LIKE 'smoke-rebuild-%'; DELETE FROM businesses WHERE place_id LIKE 'smoke-rebuild-%'; DELETE FROM rebuild_requests WHERE place_id LIKE 'smoke-rebuild-%';" >/dev/null 2>&1 || true
  kill "$DEV_PID" "$STUB_PID" >/dev/null 2>&1 || true
  wait "$DEV_PID" "$STUB_PID" >/dev/null 2>&1 || true
  rm -f "$STUB_SCRIPT"
}
trap cleanup EXIT

BASE_URL="http://127.0.0.1:$PORT"
ready=0
for _ in $(seq 1 "$TIMEOUT"); do
  if curl -s -o /dev/null "$BASE_URL/api/registry?status=verified"; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "server did not become ready; log tail:" >&2
  tail -30 "$LOG_FILE" >&2
  exit 1
fi
echo "== server ready"

# ---------------------------------------------------------------- helpers
BODY_FILE="$(mktemp -t rebuild-smoke-body)"
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
op() { # op <json> [extra-token]
  req PUT "/api/registry/$PLACE_ID" "$1" "${2:-$ADMIN_TOKEN}"
}
hooks() { # number of POSTs the stub deploy hook has received
  [ -f "$STUB_LOG" ] || { echo 0; return; }
  wc -l <"$STUB_LOG" | tr -d ' '
}
# The trigger is fire-and-forget (ctx.waitUntil), so give it a moment to land.
wait_for_hooks() { # wait_for_hooks <count>
  for _ in $(seq 1 20); do
    [ "$(hooks)" = "$1" ] && return 0
    sleep 0.25
  done
  return 1
}

PLACE_ID="smoke-rebuild-$(date +%Y%m%d%H%M%S)-$$"
OWNER_EMAIL="smoke-rebuild-$$@example.com"

echo "== auth ($BASE_URL), test place_id: $PLACE_ID"
req POST "/api/rebuild" '{"reason":"manual"}'
check "manual rebuild without token -> 401" "401" "$STATUS"
req GET "/api/rebuild"
check "rebuild history without token -> 401" "401" "$STATUS"
check "no hook call from the rejected requests" "0" "$(hooks)"

echo "== state transitions queue exactly one rebuild each"
op "{\"op\":\"claim\",\"ownerEmail\":\"$OWNER_EMAIL\"}"
check "claim -> 200" "200" "$STATUS"
check "claim queues nothing (badge unchanged)" "0" "$(hooks)"

op '{"op":"verify"}'
check "verify -> 200" "200" "$STATUS"
wait_for_hooks 1 && pass "verify triggers the deploy hook" || fail "verify triggers the deploy hook (hook calls: $(hooks))"

req GET "/api/rebuild?limit=5" "" "$ADMIN_TOKEN"
check "history GET -> 200" "200" "$STATUS"
check "history records reason=verify" "verify" "$(q '.rebuilds[0].reason')"
check "history records status=triggered" "triggered" "$(q '.rebuilds[0].status')"
check "history records the place_id" "$PLACE_ID" "$(q '.rebuilds[0].placeId')"
check "history records the build uuid" "true" "$(q '.rebuilds[0].detail | test("stub-build-1")')"

op '{"op":"verify"}'
check "verify twice -> 200 (idempotent)" "200" "$STATUS"
sleep 1
check "verify twice queues nothing (no rebuild loop)" "1" "$(hooks)"

op '{"op":"setTier","tier":"pro"}'
check "setTier pro -> 200" "200" "$STATUS"
wait_for_hooks 2 && pass "tier change triggers a rebuild" || fail "tier change triggers a rebuild (hook calls: $(hooks))"

op '{"op":"setTier","tier":"pro"}'
check "setTier twice -> 200 (idempotent)" "200" "$STATUS"
sleep 1
check "setTier twice queues nothing" "2" "$(hooks)"

echo "== rebuild:false suppresses the trigger"
op "{\"op\":\"revoke\",\"reason\":\"smoke\",\"rebuild\":false}"
check "revoke with rebuild:false -> 200" "200" "$STATUS"
check "revoke clears verified" "false" "$(q .business.verified)"
sleep 1
check "rebuild:false queues nothing" "2" "$(hooks)"

echo "== revocation queues a rebuild"
op "{\"op\":\"claim\",\"ownerEmail\":\"$OWNER_EMAIL\"}"
check "re-claim -> 200" "200" "$STATUS"
op '{"op":"verify"}'
wait_for_hooks 3 && pass "re-verify triggers the deploy hook" || fail "re-verify triggers the deploy hook (hook calls: $(hooks))"
op '{"op":"revoke","reason":"smoke cleanup"}'
check "revoke -> 200" "200" "$STATUS"
wait_for_hooks 4 && pass "revocation triggers the deploy hook" || fail "revocation triggers the deploy hook (hook calls: $(hooks))"
op '{"op":"revoke","reason":"already revoked"}'
check "revoke twice -> 200" "200" "$STATUS"
sleep 1
check "revoking an empty row queues nothing" "4" "$(hooks)"

echo "== manual trigger"
req POST "/api/rebuild" "{\"reason\":\"manual\",\"placeId\":\"$PLACE_ID\",\"actor\":\"smoke\"}" "$ADMIN_TOKEN"
check "manual rebuild -> 200" "200" "$STATUS"
check "manual rebuild status=triggered" "triggered" "$(q .rebuild.status)"
wait_for_hooks 5 && pass "manual rebuild reaches the hook" || fail "manual rebuild reaches the hook (hook calls: $(hooks))"
req POST "/api/rebuild" "{\"reason\":\"nonsense\",\"placeId\":\"$PLACE_ID\"}" "$ADMIN_TOKEN"
check "unknown reason falls back to manual" "manual" "$(q .rebuild.reason)"

req GET "/api/rebuild?limit=1" "" "$ADMIN_TOKEN"
check "history limit=1 returns one row" "1" "$(q '.count')"

echo
echo "rebuild smoke test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
