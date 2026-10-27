# ChamaHub enterprise security architecture

How ChamaHub protects the confidentiality, integrity, availability and accountability of members' money records, layer by layer, with the code that enforces each control.

`security-controls-matrix.md` maps the controls to OWASP ASVS 5.0, MASVS, the OWASP API Security Top 10, NIST CSF 2.0 and NIST SSDF, along with each control's tests. Those standards are **engineering references only**. ChamaHub has not been independently assessed, certified or penetration-tested, and nothing here claims otherwise.

Status words:

- **Implemented**: in code, on by default.
- **Tested**: an automated test fails if the control is removed.
- **Partial**: important pieces are missing.
- **Not implemented**.
- **External**: needs hosting, provider settings or a human procedure.

## System overview

```
 Member phone (Expo) ───HTTPS───────────────────────────────┐
 Member browser ──► Next.js BFF /api/proxy (httpOnly cookies, CSRF origin check) ─┤
 Staff browser ──► Next.js BFF /api/platform/proxy (cookies scoped to /api/platform)┤
                                                                                   ▼
                       NestJS API (guards → validation → services → Prisma) ──► PostgreSQL
                                │                                                  (RLS, append-only triggers,
                                ├─► Safaricom Daraja (STK push + STK query)          least-privilege role)
                                ├─► Billing providers (webhook + status API)
                                ├─► SMS / WhatsApp / e-mail / Expo push
                                └─► AI provider (read-only tool results only)
```

The trusted boundary is the API and the database. The web BFF and the mobile app are conveniences: every rule below is enforced again on the server.

## 1. Identity and authentication

| Control | Where | Status |
|---|---|---|
| **Member passwords:** scrypt (N=2^15, r=8, p=1) for new hashes. Old bcrypt hashes are verified and upgraded at the next sign-in. bcrypt ignores everything after 72 bytes; scrypt uses the whole passphrase (up to 128 characters) | `common/passwords.ts`, `auth.service.ts` | Tested (`sessions-identity`) |
| Staff passwords: scrypt, with a separate signing secret for staff tokens | `platform-auth/staff-crypto.ts` | Tested |
| Password policy: length, a common-password blocklist with normalisation, and the person's own name, phone or e-mail | `packages/shared/src/password-strength.ts` | Tested |
| Breached-password corpus check (HIBP k-anonymity) | — | Not implemented. The local blocklist is the compensating control |
| Lockout: 5 failures, 15 minutes, stored in the database. A disabled account is only revealed after the correct password | `auth.service.ts`, `platform-auth.service.ts` | Tested |
| Recovery: phone OTP stored as HMAC, single use, 10-minute expiry, rate-limited. All sessions are revoked after a reset, and the user gets a security notice | `otp.service.ts`, `auth.service.ts` | Tested (replay refused) |
| **Staff MFA:** mandatory TOTP, enforced in the API guard (`MFA_SETUP_REQUIRED`), not only in the UI. Includes:<br>• verification before activation;<br>• replay protection;<br>• 10 hashed recovery codes, with rotation;<br>• owner-controlled MFA reset;<br>• e-mails on every change | `platform-auth.service.ts`, `common/guards.ts` | Tested |
| Phishing-resistant MFA (WebAuthn/passkeys) | — | Not implemented (planned for staff) |
| Owner bootstrap: one-time CLI that needs `--confirm`, sets no password, and only works while no owner exists. There is no public owner registration. The last owner cannot be removed | `cli/platform-bootstrap.ts`, `staff.service.ts` | Tested |

## 2. Session and device security

| Control | Where | Status |
|---|---|---|
| Members: 15-minute access token. The 30-day refresh token rotates on every use, and reuse revokes the session. The session is re-read on every request, so suspension and revocation apply immediately | `auth.service.ts`, `JwtAuthGuard` | Tested |
| Staff: 10-minute access token, 30-minute idle timeout, 12-hour maximum, session re-read on every request | `platform-auth.service.ts` | Tested |
| Web cookies are `httpOnly`, `Secure` in production and `SameSite`. The refresh cookie is `Strict` and scoped to `/api`; staff cookies are scoped to `/api/platform` | `web/src/lib/server/*session.ts` | Implemented |
| **CSRF:** writes to cookie-authenticated `/api/*` routes are refused unless `Origin` / `Sec-Fetch-Site` show they came from this site | `web/src/middleware.ts`, `packages/shared/src/web-security.ts` | Tested (unit) |
| **Post-login redirects** stay on this site; `/\host`, `//host` and absolute URLs are refused (open-redirect fix) | `safeRedirectPath`, `web/src/app/login/page.tsx`, `platform/login/page.tsx` | Tested (unit) |
| Revocation tools:<br>• members: sign out a device, or all other devices;<br>• staff: revoke a helper's sessions, or **sign a member out everywhere** (needs a reason, step-up confirmation and an audit entry) | `auth.controller.ts`, `staff.controller.ts`, `platform.controller.ts` | Tested |
| Mobile: tokens in SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); `allowBackup=false`; deep-link ids validated | `mobile/src/lib/storage.ts`, `links.ts` | Implemented |

## 3. Authorization and tenant isolation

Each protected request goes through these steps:

1. `JwtAuthGuard` checks who the caller is.
2. `GroupAccessGuard` resolves their membership in the group named in the URL. A non-member gets 404, and a suspended group is read-only.
3. `@RequirePermission` checks the permission against **that** group's role only.
4. The service loads the record with `groupId` in the query.
5. Maker-checker or step-up rules apply where needed.
6. A transaction runs the change.
7. An audit event is recorded.

Authorization is deny-by-default: a route is public only with `@Public()`.

| Control | Status |
|---|---|
| Cross-group sweep: every group GET route, called with every id stored against another group (>500 calls); write sweep; snapshot unchanged | Tested (`tenant-isolation`) |
| Per-feature cross-group tests: AI, statements, rotation, mobile officer routes, multi-role users | Tested |
| Staff RBAC is separate from group roles: Owner, Platform Admin, Support Helper, Finance, Analyst. Nobody can grant a permission they lack; helpers cannot see group finances without a time-limited grant approved by the group | Tested (`platform-portal`, `finance`) |
| Database row-level security policies per tenant (defence in depth) | Not implemented. RLS is on with no anon policies; tenant scoping is in the application. See the matrix for the trade-off |

## 4. Financial transaction integrity

| Control | Where | Status |
|---|---|---|
| Integer minor units (`BigInt` cents); currency on every amount | schema, `common/money.ts` | Implemented |
| Double-entry journal: append-only (UPDATE, DELETE and TRUNCATE blocked by triggers); every entry must balance (trigger); corrections are reversal entries | init migration | Tested |
| Idempotency keys on payments, disbursements and STK pushes; unique provider receipt numbers | schema, services | Tested |
| **M-Pesa STK:**<br>• a callback (which Safaricom does not sign) only posts after Daraja's STK query confirms the outcome;<br>• an unconfirmed "success" is refused, audited and alerted;<br>• if Safaricom is unreachable, the payment is held and retried every 5 minutes, then left for an officer after 24 hours;<br>• the amount must match the request | `mpesa.service.ts`, `daraja.client.ts` | Tested (`payments-integrity`, mutation-checked) |
| **STK abuse limits:** 3 per minute per caller; at most 5 prompts to one phone and 10 per member per hour. Another member's idempotency key cannot be reused | `mpesa.service.ts` | Tested |
| Billing webhooks are verified, then confirmed with the provider status API; exactly-once activation | `billing` | Tested |
| Maker-checker on payments, loans, payouts, expenses, imports and destination changes; nobody approves their own request | `approvals.service.ts` and others | Tested |
| Payout state machine on the server. A sent payout completes only with independent confirmation (an officer, or the recipient) | `rotations.service.ts` | Tested |
| **Concurrency:** same-key payments ×10; simultaneous confirmations; simultaneous approvals ×5; simultaneous disbursements ×5; simultaneous confirmations ×5; two full loan repayments at once; the same callback ×10 | `concurrency`, `rotation`, `payments-integrity` | Tested |
| The AI never approves, posts, transfers or changes permissions | `ai/tools` | Tested |

## 5. API and application security

- **Validation:** shared zod schemas on every body and query. Unknown keys are stripped, which prevents mass assignment.
- **Limits:**
  - JSON bodies are capped at **256 KB**, except four upload routes at 8 MB: member imports, statement imports and their preview, and payment evidence (`setup-app.ts`). This bounds the cost of validation; see the zod advisory in `security-test-results.md`.
  - Oversized or malformed bodies get a clean 413/400 JSON error, not a 500.
  - Server timeouts: headers 20 s, request 60 s.
  - Pagination is capped at 200.
- **Rate limits per endpoint:**
  - sign-in and recovery: 5–10 per minute;
  - staff re-authentication: 5 per minute;
  - STK push: 3 per minute;
  - AI: 10 per minute;
  - data exports: 20 per minute;
  - your own data export: 3 per minute;
  - everything else: 300 per minute.
- **Shared rate-limit store:** `RATE_LIMIT_STORE=database` keeps the counters in Postgres, so limits hold across instances (Tested, `rate-limits`). The default is in memory, which suits a single instance.
- **Headers and errors:** helmet; an exact CORS allowlist (production refuses `*`, http and wildcards); errors without stacks, SQL or hostnames.
- **No SSRF surface:** the API only calls fixed provider URLs taken from configuration, never URLs supplied by users.

## 6. Database and storage security

- **RLS:** on for every table (Supabase anon/authenticated roles see nothing; Tested).
- **Least-privilege runtime role** (`scripts/db-roles.sql`): no DDL or TRUNCATE, migration history read-only, a 30 s statement timeout. CI checks it; switching each environment to it is **External**.
- **Evidence files:** stored in the database (not a web root) and served only through the authenticated, group-scoped route with `no-store`. Magic bytes are checked, a size limit applies, and file names are sanitised.

## 7. Administrative access

Covered in sections 1–3:

- separate staff identity;
- mandatory MFA;
- step-up re-authentication on 28 sensitive routes;
- no self-granting of permissions;
- the last owner is protected;
- helpers are limited to support cases;
- invitations are hashed, single-use, expiring and revocable;
- every staff action goes to the append-only `platform_audit_logs`.

## 8. Encryption and key management

- **In transit:** TLS at the edge (**External**).
- **At rest:** encryption of the database and backups is the provider's job (**External**; Supabase and most managed Postgres encrypt at rest by default; verify per environment).
- **Field-level:** staff TOTP secrets use AES-256-GCM.
- **Keys:**
  - all keys come from the environment; nothing is hard-coded, and the API refuses to start with short or missing ones;
  - rotation steps are in `security-operations.md`;
  - the TOTP key is derived from `PLATFORM_JWT_SECRET`; a separate KMS-held key is **Not implemented**.

## 9. Logging, monitoring and detection

| Control | Status |
|---|---|
| Append-only group audit trail: payments, approvals, payouts, adjustments, exports (`export.downloaded`, written *before* the file is sent) | Tested |
| Append-only staff audit log: logins, MFA, permissions, suspensions, session revocation, settings | Tested |
| **Security events:** one JSON line per denied request (401, 403, a 404 on a group route, 429), unconfirmed M-Pesa callbacks and duplicate receipts. Each line has the route template, ids, IP and request id. It never contains tokens, codes, bodies or amounts | Tested (`security-monitoring`) |
| **Alert rules** (5-minute window):<br>• cross-tenant probing: ≥25 denials by one user;<br>• credential stuffing: ≥50 failed token checks from one IP;<br>• rate-limit abuse;<br>• any unconfirmed payment callback;<br>• duplicate payment events.<br>Alerts go to the staff portal's Security view and to `SECURITY_WEBHOOK_URL` | Tested. Alerts are review signals, never automatic blocks or accusations |
| OTP codes are masked in development SMS logs unless `DEV_LOG_OTP` is deliberately on (production never logs message text) | Tested |
| Central log storage, retention and paging | External |

## 10. CI/CD and supply chain

CI:

- typecheck;
- unit and e2e tests (including the tenant, payment, identity, rate-limit and monitoring suites);
- the least-privilege DB role check;
- **backup restore verification**.

Security workflow:

- npm audit gate with an expiring allowlist;
- dependency review on pull requests;
- gitleaks over full history;
- CodeQL `security-extended`;
- a weekly run.

The lockfile is used with `npm ci`, and the workflows have read-only default permissions. There is no container image or IaC in the repository, so image and IaC scanning do not apply (yet).

## 11. Incident response and recovery

See `incident-response.md` (playbooks), `backup-and-recovery.md` (RPO/RTO, restore procedure, `scripts/verify-restore.sh`) and `security-operations.md`.

## 12. Governance and evidence

Every claim in these documents points to code, configuration or a test, and the evidence is listed in `security-test-results.md`. Remaining risks, with owners and dates, are in `security-checklist.md` §D. Release gates are in `security-checklist.md` §A.
