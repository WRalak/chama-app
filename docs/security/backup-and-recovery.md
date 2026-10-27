# Backup and recovery

ChamaHub's database holds the authoritative record of members' money (the journal) and the audit trail. **A backup only counts once a restore from it has been tested.** Everything in this document is **External** (hosting configuration and people) except `backend/scripts/verify-restore.sh` and its CI run.

## Objectives (proposed; confirm with the business)

| | Target | Why |
|---|---|---|
| **RPO** (data you can afford to lose) | ≤ 5 minutes | Continuous WAL/PITR on managed Postgres. Payments recorded in the window can be re-entered from M-Pesa statements |
| **RTO** (time to be back) | ≤ 4 hours | Restore to a new instance, repoint `DATABASE_URL`, verify |
| Retention | 35 days of PITR, plus monthly snapshots for 7 years | Financial record-keeping (confirm the period with counsel and an accountant) |

## What must be in place (per environment)

- [ ] Managed Postgres with **point-in-time recovery** on (Supabase Pro PITR, Neon, RDS or similar).
- [ ] Backups **encrypted at rest** by the provider. Confirm in the provider console and record where you checked.
- [ ] An **independent copy:** a scheduled `pg_dump --format=custom` to storage in a *different* account or provider, with object lock / WORM retention, so that neither the application nor a single compromised admin can delete every copy.
- [ ] The application database role (`chamahub_app`) has **no** access to backup storage. The backup job uses its own read-only credentials.
- [ ] Backup failures alert someone (provider notifications, or the job's exit status sent to `SECURITY_WEBHOOK_URL`).
- [ ] Production, staging and development use separate databases and separate credentials.

## Restore verification

`backend/scripts/verify-restore.sh`:

1. Takes a `pg_dump`. This only reads the source, which should be a read replica or PITR clone when possible. It can instead check an existing dump (`DUMP_FILE`).
2. Restores into an **empty** database whose name must start with `restore_check_`. The script refuses any other name and any non-empty database.
3. Compares the row count of every table with the source.
4. Checks invariants in the restore:
   - migration history is present;
   - **every journal entry balances** and has at least two lines;
   - the append-only triggers on the journal and audit tables exist;
   - row level security is on for every table.
5. Exits 0 only if everything passes. It prints counts, never row contents.

```bash
createdb restore_check_2026_11   # on a scratch server
SOURCE_URL="postgresql://readonly@replica:5432/chamahub" \
SCRATCH_URL="postgresql://user@scratch:5432/restore_check_2026_11" \
  bash backend/scripts/verify-restore.sh
dropdb restore_check_2026_11
```

- **CI:** runs on every push against the test database after the e2e suite (`ci.yml`, "Backup restore verification").
- **Production backups:** run it **monthly** against a PITR clone or the latest off-site dump, and after any change to backups. Record the result below.

### Restore log

| Date | Source | Duration | Result | By |
|---|---|---|---|---|
| 2026-10-27 | local development database (86 tables) | 3 s | PASS. A tampered restore with a trigger removed correctly FAILED | engineering (automated check) |
| 2026-10-27 | test database after the full e2e suite (CI-equivalent) | 1 s | PASS | engineering (automated check) |
| — | production PITR clone | — | **not yet done** | ops |

## Recovery procedure (database loss or corruption)

1. **Declare an incident** (`incident-response.md`, Sev 1). Stop writes:
   - scale the API to zero, or
   - set every group to read-only by suspending them.
2. **Preserve:** snapshot the damaged database as it is. Do not repair it in place.
3. **Choose the restore point:** just before the corruption or compromise. For ransomware or a malicious admin, go to before the attacker's first action according to the audit logs.
4. **Restore** to a *new* instance. Never overwrite the damaged one.
5. **Verify** with `verify-restore.sh` (use `DUMP_FILE` or a scratch copy).
6. **Re-apply least privilege:** run `db-roles.sql` with a **new** `chamahub_app` password. Rotate every secret if compromise is suspected (`security-operations.md`).
7. **Repoint** `DATABASE_URL` and start the API. The start-up migration check confirms the schema.
8. **Reconcile:**
   - Payments that arrived after the restore point still exist at Safaricom. Pull the M-Pesa statement for the gap and import it through *Statement import*.
   - Officers confirm matches through the normal maker-checker flow. **Never insert journal rows by hand.**
9. **Tell members** what period was affected and what to check.

## Rollback of an application release

- Application code: redeploy the previous build. The API refuses to start only when the database is *missing* migrations the code needs, so older code starts fine on a newer schema.
- Migrations are forward-only. The ones added in this release (`shared_rate_limits` and earlier) only add tables and columns, so the previous code keeps working with them in place. Do not drop them in a hurry.
