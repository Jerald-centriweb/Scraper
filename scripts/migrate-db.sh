#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/infra/.env"

CONN="postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}?sslmode=require"

echo "🗄️  Running database migrations..."
psql "$CONN" -c "SELECT version();" >/dev/null
echo "✅ Database connection OK"

psql "$CONN" -f "$ROOT_DIR/db/migrations/001_complete_schema.sql"
echo "✅ Schema applied"

COUNT=$(psql "$CONN" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" | xargs)
echo "📊 Public tables count: $COUNT"
echo "✅ Migrations complete"