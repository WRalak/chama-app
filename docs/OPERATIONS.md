# Operations

## Deploying

1. PostgreSQL 16 with automated backups (see below). Run migrations with `npm run prisma:deploy -w @chamahub/api`. Never use `migrate dev` or `migrate reset` in production.
2. API: `npm run build:shared && npm run build -w @chamahub/api && node backend/dist/main.js` behind TLS. Set `NODE_ENV=production`, strong `JWT_ACCESS_SECRET` and `OTP_SECRET` (`openssl rand -hex 32`), and `CORS_ORIGINS`. `DEV_LOG_OTP` must be unset (startup fails if it is on in production).
3. Run **one** API instance with jobs enabled, or set `DISABLE_JOBS=true` on all but one instance until jobs move to a queue with locking.
4. Admin: `npm run build -w @chamahub/admin && npm run start -w @chamahub/admin` with `API_URL` pointing at the API over a private network.
5. Mobile: build with EAS (`eas build -p android`). Set `EXPO_PUBLIC_API_URL` to the public HTTPS API.

## M-Pesa go-live checklist

- Test STK push and C2B end to end in the Daraja sandbox with real credentials.
- `MPESA_CALLBACK_URL` must be public HTTPS. Set `MPESA_CALLBACK_TOKEN` to a long random value, and allow-list Safaricom callback IPs at the load balancer.
- Set each group's `accountReferencePrefix` so paybill payments route to the right group's reconciliation queue.
- Reconcile the first weeks of production payments manually against M-Pesa statements.

## Database roles (least privilege)

The API should not connect as the database owner. Once per database, after `prisma migrate deploy`, run this as the owner:

```
psql "$OWNER_DATABASE_URL" -v app_password="'<from your secret manager>'" -f backend/scripts/db-roles.sql
```

Then point the API's `DATABASE_URL` at `chamahub_app`. That role can read and write rows, but it cannot:

- create, alter, drop or truncate tables;
- change migration history.

It also has a 30 s statement timeout.

Keep the owner URL for the migration job only. **Re-run the script after every migration** so new tables get the app's row policy. Until then the app cannot see the new tables: it fails closed rather than open. CI checks the role on every push. Security docs are in `docs/security/`.

## Backups and recovery

- Continuous WAL archiving plus daily base backups (managed Postgres PITR, or pgBackRest), kept for at least 35 days, with an encrypted off-site copy.
- Restore drill monthly into a scratch database, then run `SELECT count(*) FROM journal_lines` and the statement reconciliation check, and compare cash balances per group against the last published statements.
- The ledger and audit tables are append-only at the database level. Restore from backup; never edit rows to "fix" data. Corrections go through reversal or adjustment endpoints so they stay auditable.

## Monitoring

- `GET /health` for liveness and database status.
- Platform overview shows failed jobs and notification deliveries in the last 24 h, integration configuration, and security events (failed logins, refresh-token reuse, support access).
- Every response carries `x-request-id`, which is also stored on audit events.
- Set `ERROR_WEBHOOK_URL` to be alerted on every server error (5xx). The alert carries the route, error type and request id, never request or financial data.

## Known gaps before production

Work through [`LAUNCH.md`](LAUNCH.md) (the pre-launch checklist, item by item) as well.


- Real-device testing on low-end Android hardware and with screen readers (TalkBack and VoiceOver) has not been done yet.
- OCR imports and automatic subscription billing are not implemented. (Push notifications are implemented but untested against a production Expo/FCM setup.)
- The SMS, WhatsApp, email and M-Pesa providers are unverified against live accounts (see the README).
- Background jobs run in-process; move them to a locked queue before scaling the API horizontally.
- An independent security review and penetration test are recommended before handling real funds.
