# Operations

## Deploying

1. PostgreSQL 16 with automated backups (see below). Run migrations with `pnpm --filter @chamahub/api prisma:deploy`. Never use `migrate dev` or `migrate reset` in production.
2. API: `pnpm --filter @chamahub/api build && node apps/api/dist/main.js` behind TLS. Set `NODE_ENV=production`, strong `JWT_ACCESS_SECRET` and `OTP_SECRET` (`openssl rand -hex 32`), and `CORS_ORIGINS`. `DEV_LOG_OTP` must be unset (startup fails if it is on in production).
3. Run **one** API instance with jobs enabled, or set `DISABLE_JOBS=true` on all but one instance until jobs move to a queue with locking.
4. Admin: `pnpm --filter @chamahub/admin build && pnpm --filter @chamahub/admin start` with `API_URL` pointing at the API over a private network.
5. Mobile: build with EAS (`eas build -p android`). Set `EXPO_PUBLIC_API_URL` to the public HTTPS API.

## M-Pesa go-live checklist

- Test STK push and C2B end to end in the Daraja sandbox with real credentials.
- `MPESA_CALLBACK_URL` must be public HTTPS. Set `MPESA_CALLBACK_TOKEN` to a long random value, and allow-list Safaricom callback IPs at the load balancer.
- Set each group's `accountReferencePrefix` so paybill payments route to the right group's reconciliation queue.
- Reconcile the first weeks of production payments manually against M-Pesa statements.

## Backups and recovery

- Continuous WAL archiving plus daily base backups (managed Postgres PITR, or pgBackRest), kept for at least 35 days, with an encrypted off-site copy.
- Restore drill monthly into a scratch database, then run `SELECT count(*) FROM journal_lines` and the statement reconciliation check, and compare cash balances per group against the last published statements.
- The ledger and audit tables are append-only at the database level. Restore from backup; never edit rows to "fix" data. Corrections go through reversal or adjustment endpoints so they stay auditable.

## Monitoring

- `GET /health` for liveness and database status.
- Platform overview shows failed jobs and notification deliveries in the last 24 h, integration configuration, and security events (failed logins, refresh-token reuse, support access).
- Every response carries `x-request-id`, which is also stored on audit events.

## Known gaps before production

- Real-device testing on low-end Android hardware and with screen readers (TalkBack and VoiceOver) has not been done yet.
- Push notifications, OCR imports and automatic subscription billing are not implemented.
- The SMS, WhatsApp, email and M-Pesa providers are unverified against live accounts (see the README).
- Background jobs run in-process; move them to a locked queue before scaling the API horizontally.
- An independent security review and penetration test are recommended before handling real funds.
