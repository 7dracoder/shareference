#!/usr/bin/env bash
# End-to-end smoke test through the real HTTP UI + API.
# Usage: scripts/smoke.sh http://localhost:3000
set -uo pipefail
BASE="${1:-http://localhost:3000}"
JAR="$(mktemp)"
TAG="$(date +%s)"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }

for p in / /marketplace /marketplace/lst_pool /verify /login /signup /playground; do
  check "GET $p" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")" 200
done
check "GET /dashboard (logged out) redirects" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/dashboard")" 307

# Server actions need their action id; grab it from the signup form.
ACTION=$(curl -s "$BASE/signup" | grep -oE 'name="\$ACTION_ID_[a-f0-9]+"' | head -1 | sed -E 's/name="\$ACTION_ID_([a-f0-9]+)"/\1/')
check "signup action id found" "$([ -n "$ACTION" ] && echo yes)" yes
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" -X POST "$BASE/signup" \
  -H "Next-Action: $ACTION" -F "1_\$ACTION_ID_$ACTION=" -F "1_email=smoke-$TAG@test.dev" -F "1_name=Smoke" -F "1_password=password1234" -F '0=["$K1"]')
check "signup via server action" "$(grep -q shr_session "$JAR" && echo yes)" yes
check "GET /dashboard (logged in)" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/dashboard")" 200

check "API rejects bad key" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/chat/completions" -H 'Authorization: Bearer nope' -d '{}')" 401
rm -f "$JAR"
echo "---- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
