#!/usr/bin/env bash
# Regenerates the single initial migration from schema.prisma + integrity.sql.
# Only for pre-release development; once deployed, add new migrations instead.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf prisma/migrations
mkdir -p prisma/migrations/20261019000000_init
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261019000000_init/migration.sql
printf '\n' >> prisma/migrations/20261019000000_init/migration.sql
cat prisma/integrity.sql >> prisma/migrations/20261019000000_init/migration.sql
printf 'provider = "postgresql"\n' > prisma/migrations/migration_lock.toml
DB="${DB_NAME:-chamahub}"
# Local development database only: drop, recreate and apply.
dropdb --if-exists -h localhost -U chamahub "$DB"
createdb -h localhost -U chamahub "$DB"
DATABASE_URL="postgresql://chamahub:chamahub@localhost:5432/$DB" npx prisma migrate deploy
