#!/usr/bin/env bash
# Proves a ChamaHub backup can actually be restored. A backup is not considered reliable until
# this passes.
#
#   SOURCE_URL   database to back up, read-only use: a read replica, a PITR clone, or the
#                production database itself. Only pg_dump (reads) is run against it.
#   SCRATCH_URL  an EMPTY server/database URL where the restore goes. The database name must
#                start with "restore_check_" so this can never overwrite a real database.
#   DUMP_FILE    optional: verify an existing dump (pg_dump -Fc) instead of taking a new one.
#
#   SOURCE_URL=... SCRATCH_URL=postgresql://user:pass@host:5432/restore_check_2026_10 \
#     bash backend/scripts/verify-restore.sh
#
# Checks after restoring: migration history, the same row count in every table, every journal
# entry balanced, append-only triggers present, row level security still on. Exit code 0 only if
# all pass. Prints counts, never row contents.
set -euo pipefail

: "${SOURCE_URL:?Set SOURCE_URL (the database to back up)}"
: "${SCRATCH_URL:?Set SCRATCH_URL (an empty restore_check_* database)}"
scratch_db="${SCRATCH_URL##*/}"
scratch_db="${scratch_db%%\?*}"
if [[ "$scratch_db" != restore_check_* ]]; then
  echo "Refusing: the scratch database name must start with restore_check_ (got '$scratch_db')." >&2
  exit 2
fi
if [[ "$SCRATCH_URL" == "$SOURCE_URL" ]]; then
  echo "Refusing: SCRATCH_URL and SOURCE_URL are the same." >&2
  exit 2
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
dump="${DUMP_FILE:-$workdir/chamahub.dump}"
started=$(date +%s)

if [[ -z "${DUMP_FILE:-}" ]]; then
  echo "1/4 Taking a backup of the source (pg_dump, read-only)..."
  pg_dump --format=custom --no-owner --no-privileges --dbname="$SOURCE_URL" --file="$dump"
else
  echo "1/4 Using existing dump $DUMP_FILE"
fi

# The scratch database must exist and be empty: refuse rather than mix data.
existing=$(psql "$SCRATCH_URL" -tAX -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [[ "$existing" != "0" ]]; then
  echo "Refusing: $scratch_db is not empty ($existing tables). Create a fresh restore_check_* database." >&2
  exit 2
fi

echo "2/4 Restoring into $scratch_db..."
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$SCRATCH_URL" "$dump"

echo "3/4 Comparing row counts..."
count_sql="SELECT string_agg(format('%s=%s', tablename, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text), ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'"
if [[ -z "${DUMP_FILE:-}" ]]; then
  src_counts=$(psql "$SOURCE_URL" -tAX -c "$count_sql")
  dst_counts=$(psql "$SCRATCH_URL" -tAX -c "$count_sql")
  if [[ "$src_counts" != "$dst_counts" ]]; then
    echo "FAIL: row counts differ between source and restore (rows written during the dump can explain small differences on a live database; use a replica or PITR clone)." >&2
    diff <(tr ',' '\n' <<<"$src_counts") <(tr ',' '\n' <<<"$dst_counts") >&2 || true
    exit 1
  fi
  echo "    $(tr ',' '\n' <<<"$dst_counts" | wc -l) tables, counts identical"
fi

echo "4/4 Checking financial and security invariants in the restore..."
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -tAX <<'SQL'
DO $$
DECLARE
  unbalanced int;
  missing_triggers text;
  no_rls text;
  migrations int;
BEGIN
  SELECT count(*) INTO migrations FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;
  IF migrations = 0 THEN RAISE EXCEPTION 'FAIL: no migration history in the restore'; END IF;

  SELECT count(*) INTO unbalanced FROM (
    SELECT e.id FROM journal_entries e LEFT JOIN journal_lines l ON l."entryId" = e.id
    GROUP BY e.id HAVING COALESCE(SUM(l."amountCents"), 0) <> 0 OR COUNT(l.id) < 2
  ) x;
  IF unbalanced > 0 THEN RAISE EXCEPTION 'FAIL: % unbalanced journal entries', unbalanced; END IF;

  SELECT string_agg(t, ', ') INTO missing_triggers FROM unnest(ARRAY[
    'journal_entries_append_only', 'journal_lines_append_only', 'audit_events_append_only',
    'journal_entries_no_truncate', 'journal_lines_no_truncate', 'audit_events_no_truncate'
  ]) AS t WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t);
  IF missing_triggers IS NOT NULL THEN RAISE EXCEPTION 'FAIL: append-only triggers missing: %', missing_triggers; END IF;

  SELECT string_agg(tablename, ', ') INTO no_rls FROM pg_tables
   WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND NOT rowsecurity;
  IF no_rls IS NOT NULL THEN RAISE EXCEPTION 'FAIL: row level security is off on: %', no_rls; END IF;

  RAISE NOTICE 'OK: % migrations, ledger balanced, append-only triggers present, RLS on', migrations;
END $$;
SQL

echo "PASS: restore verified in $(( $(date +%s) - started ))s. Record the date and duration in docs/security/backup-and-recovery.md (restore log)."
echo "Drop the scratch database when you are done: DROP DATABASE $scratch_db;"
