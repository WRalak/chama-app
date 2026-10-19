#!/usr/bin/env bash
# LOCAL DEVELOPMENT ONLY: drops and recreates a local database, then applies all migrations.
# Usage: DB_NAME=chamahub ./scripts-regen.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB_NAME:-chamahub}"
dropdb --if-exists -h localhost -U chamahub "$DB"
createdb -h localhost -U chamahub "$DB"
DATABASE_URL="postgresql://chamahub:chamahub@localhost:5432/$DB" npx prisma migrate deploy
