#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/infra/.env"

command -v jq >/dev/null 2>&1 || { echo "jq is required. Install via: sudo apt-get install -y jq"; exit 1; }

API="http://localhost:${HOST_API_PORT:-3000}"

echo "1) Health check..."
curl -s "$API/health" | jq . || { echo "❌ Health endpoint failed"; exit 1; }

echo "2) Submit a test job..."
PAYLOAD=$(cat <<'JSON'
{
  "client_name": "Test Client",
  "area_name": "Test Area",
  "country": "AU",
  "buy_urls": ["https://www.realestate.com.au/buy/in-bondi,+nsw/list-1"],
  "sold_urls": ["https://www.realestate.com.au/sold/in-bondi,+nsw/list-1"]
}
JSON
)

RESP=$(curl -s -X POST "$API/jobs" \
  -H "Content-Type: application/json" \
  -H "x-job-token: ${JOB_TOKEN:-}" \
  -d "$PAYLOAD")

echo "$RESP" | jq .
JOB_ID=$(echo "$RESP" | jq -r .jobId)
if [[ -z "${JOB_ID:-}" || "${JOB_ID}" == "null" ]]; then
  echo "❌ Could not retrieve jobId (check JOB_TOKEN and API running)"
  exit 1
fi

echo "3) Poll job status ($JOB_ID)..."
for i in {1..20}; do
  STATUS=$(curl -s "$API/jobs/$JOB_ID" | jq -r .status)
  echo "   Attempt $i -> Status: $STATUS"
  [[ "$STATUS" == "completed" ]] && break
  [[ "$STATUS" == "failed" ]] && { echo "❌ Job failed"; exit 1; }
  sleep 5
done

echo "✅ End-to-end test finished"