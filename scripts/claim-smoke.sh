#!/usr/bin/env bash
#
# End-to-end smoke test for the claim flow (B2B Phase 0).
#
# Proves through the real Pages Functions runtime that:
#   * a code can only be requested for a business that is actually listed
#     (the build catalog is what validates `placeId`)
#   * the code is single-use, HMAC-checked, throttled and attempt-limited
#   * NO registry state is written until the code is correct
#   * a correct code writes claimed + verified through claimBusiness()/verifyBusiness()
#     and lands both events in the audit trail
#
# Usage:
#   bash scripts/claim-smoke.sh                                  # local: migrate, serve, test, clean up
#   bash scripts/claim-smoke.sh --url https://<deployment> --token <admin-token>
#   SMOKE_EMAIL=you@example.com bash scripts/claim-smoke.sh ... # when an email transport is configured
#   KEEP=1 bash scripts/claim-smoke.sh                           # leave the test rows behind
#
# Requires: curl, jq, npx (wrangler) and a built dist/ (data/claim-index.json).
#
# NOTE  the claim endpoints are public, so with RESEND_API_KEY configured a run
#       sends real email. Use an address you own (SMOKE_EMAIL) and expect it.
#
# Docs: docs/claim-flow.md

set -euo pipefail

DB_NAME="barcelona-compare-registry"
PORT="${PORT:-8801}"
KEEP="${KEEP:-0}"
MODE="local"
BASE_URL=""
ADMIN_TOKEN="${ADMIN_TOKEN:-local-dev-token}"
CLAIM_SECRET="${CLAIM_CODE_SECRET:-local-dev-claim-code-secret-not-for-production}"
SMOKE_EMAIL="${SMOKE_EMAIL:-}"
LOG_FILE="$(mktemp -t claim-smoke-log)"

while [ $# -gt 0 ]; do
  case "$1" in
    --url) MODE="remote"; BASE_URL="${2%/}"; shift 2 ;;
    --token) ADMIN_TOKEN="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
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

cd "$(git rev-parse --show-toplevel)"

if [ "$MODE" = remote ] && [ "$ADMIN_TOKEN" = "local-dev-token" ]; then
  echo "remote mode needs the real admin token: --token <token> or ADMIN_TOKEN=<token>" >&2
  exit 2
fi

# ------------------------------------------------------------------ local server
if [ "$MODE" = local ]; then
  [ -d dist ] || npm run build
  [ -f dist/data/claim-index.json ] || { echo "dist/data/claim-index.json missing — run npm run build" >&2; exit 2; }

  echo "== migrations (local D1: $DB_NAME)"
  npx --yes wrangler d1 migrations apply "$DB_NAME" --local 2>&1 | tail -3

  echo "== starting wrangler pages dev on :$PORT"
  npx --yes wrangler pages dev dist \
    --port "$PORT" \
    --binding "REGISTRY_ADMIN_TOKEN=$ADMIN_TOKEN" \
    --binding "CLAIM_CODE_SECRET=$CLAIM_SECRET" \
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

BODY_FILE="$(mktemp -t claim-smoke-body)"
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

# ------------------------------------------------------- pick two clean businesses
# Real place ids straight out of the build catalog, skipping businesses that already
# carry registry state (a production run must not touch a partner's row).
CANDIDATES="$(jq -r '.businesses[0:40][] | .placeId' dist/data/claim-index.json)"
PLACE_A=""
PLACE_B=""
for candidate in $CANDIDATES; do
  req GET "/api/registry/$candidate"
  if [ "$STATUS" = "404" ]; then
    if [ -z "$PLACE_A" ]; then PLACE_A="$candidate"
    elif [ -z "$PLACE_B" ]; then PLACE_B="$candidate"; break
    fi
  fi
done
if [ -z "$PLACE_A" ] || [ -z "$PLACE_B" ]; then
  echo "could not find two unclaimed businesses in the catalog" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d%H%M%S)-$$"
EMAIL_A="claim-smoke-$$@example.com"
EMAIL_B="claim-smoke-b-$$@example.com"
if [ -n "$SMOKE_EMAIL" ]; then EMAIL_A="$SMOKE_EMAIL"; fi
OTHER_EMAIL="claim-other-$$@example.com"

echo "== claim flow ($BASE_URL)"
echo "   business A: $PLACE_A"
echo "   business B: $PLACE_B"
echo "   email A:    $EMAIL_A"

# ------------------------------------------------------- catalog validation
req POST "/api/claim/start" '{"placeId":"not-a-real-place-id","email":"a@b.com"}'
check "unlisted placeId -> 404" "404" "$STATUS"
check "unlisted placeId -> not_found" "not_found" "$(q .error)"

req POST "/api/claim/start" "{\"placeId\":\"$PLACE_A\",\"email\":\"not-an-email\"}"
check "invalid email -> 400" "400" "$STATUS"
check "invalid email -> invalid_email" "invalid_email" "$(q .error)"

req POST "/api/claim/start" "{\"placeId\":\"$PLACE_A\",\"email\":\"$EMAIL_A\"}"
check "start -> 200" "200" "$STATUS"
check "start state=code_sent" "code_sent" "$(q .state)"
check "start echoes the listed business" "$PLACE_A" "$(q .business.placeId)"
case "$(q .delivery)" in
  resend) pass "delivery via resend (edge transport configured)" ;;
  none)   pass "delivery=none (no transport configured, operator handover)" ;;
  *)      fail "delivery reported something unexpected ($(q .delivery))" ;;
esac
if [ -n "$(q '.expiresAt // empty')" ]; then pass "start returns an expiry"; else fail "start returns an expiry"; fi
if [ "$(q '.resendInSeconds >= 30')" = "true" ]; then pass "start returns a resend cooldown"; else fail "start returns a resend cooldown"; fi

# One code request never touches the registry.
req GET "/api/registry/$PLACE_A"
check "pending code leaves registry untouched -> 404" "404" "$STATUS"

req POST "/api/claim/start" "{\"placeId\":\"$PLACE_A\",\"email\":\"$EMAIL_A\"}"
check "second code within the cooldown -> 429" "429" "$STATUS"
check "second code within the cooldown -> rate_limited" "rate_limited" "$(q .error)"

# ------------------------------------------------------- operator outbox
req GET "/api/claim/outbox"
check "outbox without token -> 401" "401" "$STATUS"

req GET "/api/claim/outbox" "" "$ADMIN_TOKEN"
check "outbox with token -> 200" "200" "$STATUS"
PENDING_ID="$(q ".pending[] | select(.placeId == \"$PLACE_A\") | .id")"
CODE="$(q ".pending[] | select(.placeId == \"$PLACE_A\") | .code")"
if [ -n "$PENDING_ID" ]; then pass "outbox lists the pending request"; else fail "outbox lists the pending request"; fi
check "outbox code is 6 digits" "6" "${#CODE}"
check "outbox carries the business name" "$(jq -r --arg id "$PLACE_A" '.businesses[] | select(.placeId == $id) | .name' dist/data/claim-index.json)" \
  "$(q ".pending[] | select(.placeId == \"$PLACE_A\") | .businessName")"
check "outbox carries the owner email" "$EMAIL_A" "$(q ".pending[] | select(.placeId == \"$PLACE_A\") | .email")"

req POST "/api/claim/outbox/$PENDING_ID" '{"provider":"smoke-test"}' "$ADMIN_TOKEN"
check "mark delivered -> 200" "200" "$STATUS"
req GET "/api/claim/outbox" "" "$ADMIN_TOKEN"
check "delivered request leaves the outbox" "" "$(q ".pending[] | select(.id == \"$PENDING_ID\") | .id")"

# ------------------------------------------------------- wrong code, then the right one
req POST "/api/claim/verify" "{\"placeId\":\"$PLACE_A\",\"email\":\"$EMAIL_A\",\"code\":\"000000\"}"
WRONG_STATUS="$STATUS"
if [ "$WRONG_STATUS" = "400" ] && [ "$(q .error)" = "invalid_code" ]; then
  pass "wrong code -> 400 invalid_code"
elif [ "$CODE" = "000000" ]; then
  pass "generated code happened to be 000000 (skipped wrong-code check)"
else
  fail "wrong code -> 400 invalid_code (got [$WRONG_STATUS] [$(q .error)])"
fi

req POST "/api/claim/verify" "{\"placeId\":\"$PLACE_B\",\"email\":\"$EMAIL_A\",\"code\":\"$CODE\"}"
check "code for another business -> 400" "400" "$STATUS"
check "code for another business -> invalid_code" "invalid_code" "$(q .error)"

req POST "/api/claim/verify" "{\"placeId\":\"$PLACE_A\",\"email\":\"$EMAIL_A\",\"code\":\"$CODE\"}"
check "correct code -> 200" "200" "$STATUS"
check "correct code -> state=verified" "verified" "$(q .state)"
check "correct code -> claimed" "true" "$(q .business.claimed)"
check "correct code -> verified" "true" "$(q .business.verified)"
check "correct code -> tier free" "free" "$(q .business.tier)"
check "correct code -> PII stripped from the response" "false" "$(q '.business | has("ownerEmail")')"
if [ -n "$(q .listingUrl)" ] && [ "$(q .listingUrl)" != "null" ]; then pass "listing url is present"; else fail "listing url is present"; fi
if [ -n "$(q .business.claimedAt)" ] && [ "$(q .business.claimedAt)" != "null" ]; then pass "claimedAt is set"; else fail "claimedAt is set"; fi
if [ -n "$(q .business.verifiedAt)" ] && [ "$(q .business.verifiedAt)" != "null" ]; then pass "verifiedAt is set"; else fail "verifiedAt is set"; fi

req POST "/api/claim/verify" "{\"placeId\":\"$PLACE_A\",\"email\":\"$EMAIL_A\",\"code\":\"$CODE\"}"
check "replaying a used code -> 400" "400" "$STATUS"
check "replaying a used code -> invalid_code" "invalid_code" "$(q .error)"

req GET "/api/registry/$PLACE_A"
check "registry GET shows claimed" "true" "$(q .business.claimed)"
check "registry GET shows verified" "true" "$(q .business.verified)"
check "registry GET still hides ownerEmail" "false" "$(q '.business | has("ownerEmail")')"

req POST "/api/claim/start" "{\"placeId\":\"$PLACE_A\",\"email\":\"$EMAIL_A\"}"
check "re-claim by the verified owner -> already_verified" "already_verified" "$(q .state)"

req POST "/api/claim/start" "{\"placeId\":\"$PLACE_A\",\"email\":\"$OTHER_EMAIL\"}"
check "claim by a different email -> 409" "409" "$STATUS"
check "claim by a different email -> already_claimed" "already_claimed" "$(q .error)"

req GET "/api/registry/$PLACE_A?events=1" "" "$ADMIN_TOKEN"
check "audit trail records claim then verify" "claim,verify" "$(q '[.events[].event] | join(",")')"
check "audit trail actor is the claim flow" "claim-flow" "$(q '[.events[].actor] | unique | join(",")')"

# ------------------------------------------------------- attempt limits (business B)
req POST "/api/claim/start" "{\"placeId\":\"$PLACE_B\",\"email\":\"$EMAIL_B\"}"
check "start (business B) -> 200" "200" "$STATUS"

req POST "/api/claim/verify" "{\"placeId\":\"$PLACE_B\",\"email\":\"$OTHER_EMAIL\",\"code\":\"111111\"}"
check "verify with no pending code for that pair -> 400" "400" "$STATUS"
check "verify with no pending code for that pair -> invalid_code" "invalid_code" "$(q .error)"

WRONG_CODE="000000"
if [ "$CODE" = "000000" ]; then WRONG_CODE="111111"; fi
for _ in 1 2 3 4 5; do
  req POST "/api/claim/verify" "{\"placeId\":\"$PLACE_B\",\"email\":\"$EMAIL_B\",\"code\":\"$WRONG_CODE\"}"
done
check "5 wrong attempts -> 400 each" "400" "$STATUS"
check "5 wrong attempts -> invalid_code" "invalid_code" "$(q .error)"

req POST "/api/claim/verify" "{\"placeId\":\"$PLACE_B\",\"email\":\"$EMAIL_B\",\"code\":\"$WRONG_CODE\"}"
check "6th attempt -> 429" "429" "$STATUS"
check "6th attempt -> too_many_attempts" "too_many_attempts" "$(q .error)"

req GET "/api/registry/$PLACE_B"
check "failed verifications never touch the registry -> 404" "404" "$STATUS"

req POST "/api/claim/start" "{\"placeId\":\"$PLACE_B\",\"email\":\"$EMAIL_B\"}"
if [ "$STATUS" = "429" ]; then pass "burnt code cannot be replaced inside the cooldown"; else fail "burnt code cannot be replaced inside the cooldown (got [$STATUS])"; fi

# ---------------------------------------------------------------------- cleanup
if [ "$KEEP" != 1 ]; then
  echo "== cleanup"
  req PUT "/api/registry/$PLACE_A" '{"op":"revoke","reason":"claim smoke test"}' "$ADMIN_TOKEN"
  check "cleanup revokes the test claim" "false" "$(q .business.claimed)"
  npx --yes wrangler d1 execute "$DB_NAME" "$D1_TARGET" --yes \
    --command "DELETE FROM registry_events WHERE place_id IN ('$PLACE_A','$PLACE_B'); DELETE FROM businesses WHERE place_id IN ('$PLACE_A','$PLACE_B'); DELETE FROM claim_requests WHERE place_id IN ('$PLACE_A','$PLACE_B');" >/dev/null 2>&1 || \
    echo "  warn  could not delete the test rows from $DB_NAME"
  req GET "/api/registry/$PLACE_A"
  check "cleanup removed the test business" "404" "$STATUS"
fi

echo
echo "claim smoke test ($STAMP): $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
