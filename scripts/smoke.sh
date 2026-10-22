#!/usr/bin/env bash
# End-to-end check of a running stack through the gateway, the way the website uses it.
# Usage: scripts/smoke.sh [base-url]   (default http://localhost:8080). Needs curl and jq.
set -euo pipefail
BASE=${1:-http://localhost:8080}
pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }

# Waits until a transfer reaches the wanted status, then prints it.
await() {
  local id=$1 want=$2 t
  for _ in $(seq 1 60); do
    t=$(curl -fs "$BASE/api/payments/transfers/$id") || true
    [[ $(jq -r .status <<<"$t" 2>/dev/null) == "$want" ]] && { echo "$t"; return; }
    sleep 0.5
  done
  fail "transfer $id never became $want (last: $(jq -c '{status, fraud, compliance}' <<<"$t"))"
}

send() { # from-account to-account cents memo
  curl -fs -X POST "$BASE/api/payments/transfers" -H 'content-type: application/json' \
    -d "{\"fromAccountId\":\"$1\",\"toAccountId\":\"$2\",\"amountCents\":$3,\"memo\":\"$4\"}" | jq -r .id
}

echo "Waiting for services at $BASE"
for _ in $(seq 1 90); do
  curl -fs "$BASE/api/ops/overview" | jq -e '[.services[].healthy] | all' >/dev/null 2>&1 && break
  sleep 2
done
curl -fs "$BASE/api/ops/overview" | jq -e '[.services[].healthy] | all' >/dev/null || fail "services not healthy"
pass "all three services healthy"

echo "A small transfer clears both checks"
t=$(await "$(send maya-chq liam-chq 2450 'Coffee')" COMPLETED)
pass "completed; fraud $(jq -r '.fraud.decision + " (" + (.fraud.score|tostring) + ")"' <<<"$t"), compliance $(jq -r .compliance.decision <<<"$t")"

echo "A \$12,000 transfer is held for review, then approved"
id=$(send maya-chq noah-chq 1200000 'Car down payment')
t=$(await "$id" HELD)
pass "held; fraud $(jq -r '.fraud.score' <<<"$t"): $(jq -r '.fraud.reasons | join("; ")' <<<"$t")"
pass "compliance: $(jq -r '.compliance.reason + " [" + .compliance.reportId + "]"' <<<"$t")"
curl -fs -X POST "$BASE/api/payments/transfers/$id/approve" -H 'content-type: application/json' -d '{"note":"Verified with customer"}' >/dev/null
await "$id" COMPLETED >/dev/null
pass "approved and completed"

echo "Three \$3,500 transfers in a row trip the structuring check"
for i in 1 2 3; do id=$(send noah-chq aisha-chq 350000 "Part $i"); done
t=$(await "$id" HELD)
pass "third one held: $(jq -r .compliance.reason <<<"$t")"

echo "With fraud stopped, a transfer waits instead of skipping the check"
curl -fs -X POST "$BASE/api/ops/services/fraud/pause" >/dev/null
sleep 1
id=$(send liam-chq aisha-chq 1500 'Lunch')
sleep 3
[[ $(curl -fs "$BASE/api/payments/transfers/$id" | jq -r .status) == PENDING ]] || fail "transfer moved without a fraud check"
lag=$(curl -fs "$BASE/api/ops/overview" | jq '[.streams[] | select(.name=="transfers") | .groups[] | select(.name=="fraud") | .lag + .pending] | add')
pass "still pending, fraud backlog: $lag"
curl -fs -X POST "$BASE/api/ops/services/fraud/resume" >/dev/null
await "$id" COMPLETED >/dev/null
pass "fraud restarted, backlog drained, transfer completed"

echo "The audit chain verifies"
v=$(curl -fs "$BASE/api/compliance/audit/verify")
[[ $(jq -r .valid <<<"$v") == true ]] || fail "audit chain broken: $v"
pass "$(jq -r .entries <<<"$v") entries, chain intact"

echo "Balances add up"
total=$(curl -fs "$BASE/api/payments/customers" | jq '[.[].accounts[].balanceCents] | add')
[[ $total == 8337035 ]] || fail "money was created or destroyed: total is $total, expected 8337035"
pass "total across all accounts unchanged: \$$(jq -n "$total/100")"
echo "All checks passed."
