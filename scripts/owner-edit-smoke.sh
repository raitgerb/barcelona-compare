#!/usr/bin/env bash
#
# End-to-end smoke test for B2B Phase 1 self-service profile edits.
#
# Proves the whole owner path through the real Pages Functions runtime:
#   claim (registry) -> request login code -> 6-digit verify -> session token ->
#   PUT services/prices/hours/photos -> public override API -> the LISTING PAGE
#   served with the owner content injected -> operator takedown -> owner reset.
#
# The injection assertions read the real listing HTML, so this is the test that
# says "an owner edit is live on a profile", not just "a row changed".
#
# Usage:
#   bash scripts/owner-edit-smoke.sh                      # local: migrate, serve, test, clean up
#   bash scripts/owner-edit-smoke.sh --url https://barcelonacompare.com --token <admin token>
#   SLUG=mi-salon CATEGORY=nails bash scripts/owner-edit-smoke.sh
#   PORT=8899 bash scripts/owner-edit-smoke.sh            # this machine runs several agents: 8799 may be taken
#   KEEP=1 bash scripts/owner-edit-smoke.sh               # leave the test rows behind
#
# Requires: curl, jq, npx (wrangler). Local mode serves `dist/` on PORT via
# `wrangler pages dev`, so it exercises the same handlers Cloudflare runs.
# A test place id is claimed and then deleted; on `--url` the writes land in the
# production D1 (preview and production share it) and are removed at the end.
#
# Docs: docs/owner-profile-edits.md

set -euo pipefail

DB_NAME="barcelona-compare-registry"
PORT="${PORT:-8799}"
KEEP="${KEEP:-0}"
MODE="local"
BASE_URL=""
ADMIN_TOKEN="${ADMIN_TOKEN:-local-dev-token}"
SLUG="${SLUG:-acuarela-nails}"
CATEGORY="${CATEGORY:-nails}"
LOG_FILE="$(mktemp -t owner-edit-smoke-log)"
BODY_FILE="$(mktemp -t owner-edit-smoke-body)"

while [ $# -gt 0 ]; do
  case "$1" in
    --url) MODE="remote"; BASE_URL="${2%/}"; shift 2 ;;
    --token) ADMIN_TOKEN="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --category) CATEGORY="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
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
contains() { # contains <label> <needle> <haystack>
  case "$3" in
    *"$2"*) pass "$1" ;;
    *) fail "$1 (missing [$2])" ;;
  esac
}
missing() { # missing <label> <needle> <haystack>
  case "$3" in
    *"$2"*) fail "$1 (unexpected [$2])" ;;
    *) pass "$1" ;;
  esac
}

for tool in curl jq npx; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 2; }
done

PLACE_ID="ChIJsmoke$(date +%Y%m%d%H%M%S)$$"
EMAIL="owner-smoke-$$@example.com"
SERVICE_NAME="Servicio de prueba $RANDOM"
SERVICE_PRICE="23 €"
HOURS_VALUE="09:30-21:15"
PRICE_NOTE="Precios orientativos de prueba"
# Owner-typed in local Spanish format on purpose: the API must store wa.me digits.
WA_INPUT="+34 611 22 33 44"
WA_STORED="34611223344"
SITE="${BASE_URL:-https://barcelonacompare.com}"
# Photo URLs must be public https, so the validation checks always talk to the real
# site even when the API under test is the local dev server.
PUBLIC_SITE="https://barcelonacompare.com"
OWNER_PHOTO="$PUBLIC_SITE/og-default.png"
NOT_AN_IMAGE="$PUBLIC_SITE/robots.txt"

STATUS=""
BODY=""

call() { # call <METHOD> <PATH> [JSON_BODY] [SESSION_TOKEN] [ADMIN_TOKEN]
  local method="$1" path="$2" body="${3:-}" session="${4:-}" admin="${5:-}"
  local args=(-sS -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$BASE_URL$path" -H 'content-type: application/json')
  [ -n "$session" ] && args+=(-H "x-owner-session: $session")
  [ -n "$admin" ] && args+=(-H "x-registry-admin-token: $admin")
  [ -n "$body" ] && args+=(-d "$body")
  STATUS="$(curl "${args[@]}")"
  BODY="$(cat "$BODY_FILE")"
}

jqr() { printf '%s' "$BODY" | jq -r "$1" 2>/dev/null || echo ""; }

remote_d1() { # remote_d1 <sql>
  npx --yes wrangler d1 execute "$DB_NAME" --remote --yes --command "$1" >>"$LOG_FILE" 2>&1
}
local_d1() { # local_d1 <sql>
  npx --yes wrangler d1 execute "$DB_NAME" --local --yes --command "$1" >>"$LOG_FILE" 2>&1
}

cleanup() {
  if [ "$KEEP" = "1" ]; then
    echo "KEEP=1: leaving test rows for place_id $PLACE_ID"
    return
  fi
  local sql
  sql="DELETE FROM profile_edit_events WHERE place_id = '$PLACE_ID'; DELETE FROM profile_overrides WHERE place_id = '$PLACE_ID'; DELETE FROM owner_sessions WHERE place_id = '$PLACE_ID'; DELETE FROM businesses WHERE place_id = '$PLACE_ID';"
  if [ "$MODE" = "remote" ]; then
    remote_d1 "$sql" || echo "warning: remote cleanup failed, remove $PLACE_ID by hand" >&2
  else
    local_d1 "$sql" || echo "warning: local cleanup failed" >&2
  fi
  echo "cleaned up test rows for $PLACE_ID"
}

SERVER_PID=""
if [ "$MODE" = "local" ]; then
  BASE_URL="http://127.0.0.1:$PORT"
  if [ ! -d dist ]; then
    echo "dist/ is missing — run 'npm run build' first (wrangler pages dev serves it)" >&2
    exit 2
  fi
  if command -v lsof >/dev/null 2>&1 && [ -n "$(lsof -ti tcp:"$PORT" 2>/dev/null)" ]; then
    echo "port $PORT is already in use — another Pages dev server is running." >&2
    echo "Re-run with PORT=<free port> (this machine runs several agents at once)." >&2
    exit 2
  fi
  echo "applying migrations to the local D1"
  npm run --silent db:migrate:local >>"$LOG_FILE" 2>&1
  echo "starting wrangler pages dev on port $PORT"
  npx --yes wrangler pages dev dist --port "$PORT" --ip 127.0.0.1 >>"$LOG_FILE" 2>&1 &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true; cleanup' EXIT
  ready=0
  for _ in $(seq 1 60); do
    if curl -sS -o /dev/null "$BASE_URL/" 2>/dev/null; then ready=1; break; fi
    sleep 1
  done
  [ "$ready" = "1" ] || { echo "local server never came up (log: $LOG_FILE)" >&2; exit 2; }
else
  echo "testing the deployed functions at $BASE_URL"
  trap 'cleanup' EXIT
fi

echo
echo "1. baseline: no published overrides for the test slug"
call GET "/api/profile-overrides/$SLUG"
check "public override is 404 before any edit" "404" "$STATUS"

call GET "/api/registry/$PLACE_ID" "" "" "$ADMIN_TOKEN"
check "test business is not in the registry yet" "404" "$STATUS"

echo
echo "2. operator claims the test business (Phase 0 path)"
call PUT "/api/registry/$PLACE_ID" "{\"op\":\"claim\",\"ownerEmail\":\"$EMAIL\",\"slug\":\"$SLUG\",\"name\":\"Smoke Test Salon\",\"category\":\"$CATEGORY\"}" "" "$ADMIN_TOKEN"
check "claim accepted" "200" "$STATUS"
check "registry says claimed" "true" "$(jqr '.business.claimed')"
check "registry says not verified" "false" "$(jqr '.business.verified')"

echo
echo "3. login code: never returned anonymously, always returned to the operator"
call POST "/api/owner/session" "{\"business\":\"$SLUG\",\"email\":\"$EMAIL\"}"
check "code request accepted" "200" "$STATUS"
check "anonymous caller gets no code" "null" "$(jqr '.code')"

call POST "/api/owner/session" "{\"business\":\"$SLUG\",\"email\":\"$EMAIL\"}" "" "$ADMIN_TOKEN"
check "operator code request accepted" "200" "$STATUS"
CODE="$(jqr '.code')"
check "operator gets a 6-digit code" "6" "${#CODE}"
check "session response carries the canonical place id" "$PLACE_ID" "$(jqr '.business.placeId')"

call POST "/api/owner/session" "{\"business\":\"$SLUG\",\"email\":\"wrong-owner@example.com\"}"
check "wrong email cannot request a code" "403" "$STATUS"

echo
echo "4. session: wrong code refused, right code mints a token"
call POST "/api/owner/session/verify" "{\"business\":\"$PLACE_ID\",\"code\":\"000000\"}"
check "wrong code refused" "401" "$STATUS"
check "wrong code error is invalid_code" "invalid_code" "$(jqr '.error')"

call POST "/api/owner/session/verify" "{\"business\":\"$PLACE_ID\",\"code\":\"$CODE\"}"
check "right code accepted" "200" "$STATUS"
TOKEN="$(jqr '.token')"
[ "${#TOKEN}" -ge 32 ] && pass "session token is long enough" || fail "session token too short (${#TOKEN})"
check "session is bound to the test business" "$PLACE_ID" "$(jqr '.business.placeId')"

call POST "/api/owner/session/verify" "{\"business\":\"$PLACE_ID\",\"code\":\"$CODE\"}"
check "a used code cannot be replayed" "401" "$STATUS"

echo
echo "5. writes need the session token"
call GET "/api/owner/profile/$PLACE_ID"
check "read without a token is 401" "401" "$STATUS"
call PUT "/api/owner/profile/$PLACE_ID" "{\"priceNote\":\"nope\"}"
check "write without a token is 401" "401" "$STATUS"
call PUT "/api/owner/profile/$PLACE_ID" "{\"services\":[{\"name\":\"x\"}]}" "0123456789abcdef0123456789abcdef"
check "bogus token is 401" "401" "$STATUS"

echo
echo "6. saving services, prices, hours, photos and the WhatsApp number"
call PUT "/api/owner/profile/$PLACE_ID" "{\"services\":[{\"name\":\"$SERVICE_NAME\",\"price\":\"$SERVICE_PRICE\"},{\"name\":\"Manicura\"}],\"priceNote\":\"$PRICE_NOTE\",\"whatsapp\":\"$WA_INPUT\",\"hours\":{\"monday\":\"$HOURS_VALUE\",\"tuesday\":\"\",\"sunday\":\"10:00-14:00\"},\"hiddenPhotos\":[4],\"addedPhotos\":[\"$OWNER_PHOTO\"]}" "$TOKEN"
check "save accepted" "200" "$STATUS"
check "services stored" "2" "$(jqr '.override.services | length')"
check "price stored" "$SERVICE_PRICE" "$(jqr '.override.services[0].price')"
check "monday hours stored" "$HOURS_VALUE" "$(jqr '.override.hours.monday')"
check "whatsapp stored as wa.me digits" "$WA_STORED" "$(jqr '.override.whatsapp')"
check "hidden photo stored" "4" "$(jqr '.override.hiddenPhotos[0]')"
check "own photo stored" "$OWNER_PHOTO" "$(jqr '.override.addedPhotos[0]')"
check "updatedAt is an ISO timestamp" "20" "$(jqr '.override.updatedAt' | cut -c1-2)"

echo
echo "7. validation rejects bad input"
call PUT "/api/owner/profile/$PLACE_ID" '{"hours":{"monday":"9am-5pm"}}' "$TOKEN"
check "bad hours refused" "400" "$STATUS"
check "bad hours error" "invalid_hours" "$(jqr '.error')"
call PUT "/api/owner/profile/$PLACE_ID" '{"addedPhotos":["http://example.com/a.jpg"]}' "$TOKEN"
check "http photo refused" "400" "$STATUS"
check "http photo error" "invalid_photos" "$(jqr '.error')"
call PUT "/api/owner/profile/$PLACE_ID" "{\"addedPhotos\":[\"$NOT_AN_IMAGE\"]}" "$TOKEN"
check "non-image URL refused" "400" "$STATUS"
check "non-image error" "photo_unreachable" "$(jqr '.error')"
call PUT "/api/owner/profile/$PLACE_ID" '{"services":[{"name":""}]}' "$TOKEN"
check "nameless service refused" "400" "$STATUS"
check "nameless service error" "invalid_services" "$(jqr '.error')"
call PUT "/api/owner/profile/$PLACE_ID" '{"whatsapp":"not-a-phone"}' "$TOKEN"
check "unusable whatsapp refused" "400" "$STATUS"
check "whatsapp error" "invalid_whatsapp" "$(jqr '.error')"

echo
echo "8. the owner sees their own live state"
call GET "/api/owner/profile/$PLACE_ID" "" "$TOKEN"
check "owner read accepted" "200" "$STATUS"
check "owner read shows the saved service" "$SERVICE_NAME" "$(jqr '.override.services[0].name')"
[ "$(jqr '.events | length')" -ge 1 ] && pass "audit trail has entries" || fail "audit trail is empty"

echo
echo "9. public read path"
call GET "/api/profile-overrides/$SLUG"
check "public read of the slug" "200" "$STATUS"
check "public read carries the service" "$SERVICE_NAME" "$(jqr '.override.services[0].name')"
missing "owner email is not exposed" "$EMAIL" "$BODY"

call GET "/api/profile-overrides"
check "public list accepted" "200" "$STATUS"
contains "public list contains the slug" "$SLUG" "$BODY"

echo
echo "10. the listing page is served with the owner content injected"
PAGE_PATH="/$CATEGORY/$SLUG/"
call GET "$PAGE_PATH"
check "listing page responds" "200" "$STATUS"
PAGE="$BODY"
contains "injected service name" "$SERVICE_NAME" "$PAGE"
contains "injected price" "$SERVICE_PRICE" "$PAGE"
contains "injected price note" "$PRICE_NOTE" "$PAGE"
contains "injected hours" "$HOURS_VALUE" "$PAGE"
contains "hidden photo is display:none" "-4.jpg\" style=\"display:none\"" "$PAGE"
contains "own photo block" "$OWNER_PHOTO" "$PAGE"
contains "owner attribution in Spanish" "actualizado el" "$PAGE"
contains "injected WhatsApp CTA uses wa.me digits" "wa.me/$WA_STORED" "$PAGE"
contains "injected WhatsApp CTA label (ES)" "Reservar por WhatsApp" "$PAGE"
contains "WhatsApp CTA is click-tracked" "data-track-event=\"click_whatsapp\"" "$PAGE"
contains "WhatsApp link carries the attribution message" "text=Hola%2C%20os%20escribo%20desde%20barcelonacompare.com" "$PAGE"

call GET "/en/$CATEGORY/$SLUG/"
EN_PAGE="$BODY"
contains "EN page carries the service" "$SERVICE_NAME" "$EN_PAGE"
contains "EN page uses EN labels" "Opening Hours" "$EN_PAGE"
contains "EN page carries the WhatsApp CTA" "Book on WhatsApp" "$EN_PAGE"

echo
echo "10b. a Google-sourced number renders as a working wa.me link"
# The frontmatter stores local format ("640 79 36 74"), which used to produce the
# dead link wa.me/640793674. Angel Nails is one of the 9 listings with a number.
call GET "/nails/%C3%A0ngel-nails/"
check "listing page responds" "200" "$STATUS"
contains "local number is normalised to international" "wa.me/34640793674" "$BODY"
missing "the dead national-only link is gone" "wa.me/640793674" "$BODY"

echo
echo "11. operator takedown and restore"
call PUT "/api/profile-overrides/$SLUG" '{"op":"unpublish"}' "" "$ADMIN_TOKEN"
check "takedown accepted" "200" "$STATUS"
call GET "/api/profile-overrides/$SLUG"
check "unpublished override is not public" "404" "$STATUS"
call GET "$PAGE_PATH"
missing "listing page is back to Google data" "$SERVICE_NAME" "$BODY"

call PUT "/api/profile-overrides/$SLUG" '{"op":"publish"}' "" "$ADMIN_TOKEN"
check "restore accepted" "200" "$STATUS"
call GET "$PAGE_PATH"
check "listing page responds after restore" "200" "$STATUS"
contains "listing page shows the edit again" "$SERVICE_NAME" "$BODY"

echo
echo "12. owner reset returns the profile to its Google data"
call DELETE "/api/owner/profile/$PLACE_ID" "" "$TOKEN"
check "reset accepted" "200" "$STATUS"
check "reset action" "reset" "$(jqr '.action')"
call GET "$PAGE_PATH"
missing "listing page back to defaults after reset" "$SERVICE_NAME" "$BODY"
missing "injected WhatsApp CTA is gone after reset" "wa.me/$WA_STORED" "$BODY"
call GET "/api/owner/profile/$PLACE_ID" "" "$TOKEN"
check "override is gone" "null" "$(jqr '.override')"

echo
echo "13. cleanup"
kill "$SERVER_PID" 2>/dev/null || true
cleanup
trap - EXIT

echo
printf 'owner-edit smoke: %d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" != "0" ]; then
  echo "server log: $LOG_FILE"
  exit 1
fi
