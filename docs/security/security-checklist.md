# ChamaHub security checklist and release gates

Use this list before every production release. Tick each item, or record why it does not apply. Items marked **(human)** need a person to check them; tooling cannot.

## A. Release gates (all must pass)

| # | Gate | How it is checked |
|---|---|---|
| G1 | CI green on the release commit: typecheck (api, web, mobile), shared unit tests, all API e2e tests (including tenant isolation, platform portal, security baseline), web build | `.github/workflows/ci.yml` |
| G2 | Least-privilege DB role check passes | CI step "Least-privilege database role" |
| G3 | Dependency gate passes: no high or critical advisory outside `security/audit-allowlist.json`, and no expired entry | `security.yml` → `scripts/audit-gate.mjs` |
| G4 | No secrets found in full git history | `security.yml` → gitleaks |
| G5 | CodeQL has no open high or critical alerts **(human: review the Security tab)** | `security.yml` → CodeQL |
| G6 | Migrations reviewed: no destructive change without a written data plan; `migrate deploy` tested on a copy of production **(human)** | PR review |
| G7 | New routes: any group-scoped route takes its `groupId` from the URL and is covered by the tenant sweep (automatic if it has more than one path param); sensitive staff routes carry `@RequireRecentAuth()` **(human)** | PR review + `tenant-isolation.e2e-spec.ts` |
| G8 | Money changes go through the ledger and maker-checker; no UPDATE or DELETE on financial history **(human)** | PR review + DB triggers |
| G9 | A green build alone is not evidence of security. For security-relevant changes, a second person has reviewed the diff **(human)** | PR approval |

## B. Production configuration (External; verify per environment)

- [ ] `NODE_ENV=production`.
- [ ] Unique random secrets (≥32 chars) from a secret manager: `JWT_ACCESS_SECRET`, `OTP_SECRET`, provider webhook secrets, and **`PLATFORM_JWT_SECRET` set explicitly** (otherwise it is derived from the member secret, coupling rotation).
- [ ] `DEV_LOG_OTP` unset; `DISABLE_THROTTLE` unset (the API refuses to start otherwise).
- [ ] `CORS_ORIGINS` lists only the exact `https://` origins of the web app (the API refuses `*`, http, paths and wildcards).
- [ ] `PLATFORM_REQUIRE_MFA` is unset or `true`; `PLATFORM_REAUTH_MINUTES` ≤ 15.
- [ ] TLS everywhere; HSTS at the edge; HTTP redirects to HTTPS.
- [ ] `DATABASE_URL` uses `chamahub_app` (run `backend/scripts/db-roles.sql`, and re-run it after every `migrate deploy`). The owner URL is used only by the migration job.
- [ ] Automated DB backups with point-in-time recovery; a restore tested in the last 90 days **(human)**.
- [ ] Database not reachable from the public internet, or restricted by IP or SSL **(provider)**.
- [ ] Supabase: Data API disabled or RLS confirmed (the security e2e test checks RLS); service-role key not used by the app. **Any Supabase key ever shared in chat or tickets has been rotated.**
- [ ] M-Pesa: `MPESA_CALLBACK_TOKEN` random and long; callback URL https.
- [ ] Only one API instance until rate limiting uses a shared store (Redis), or accept that limits multiply by instance count.
- [ ] Log retention and access restricted; logs shipped to a central store with alerts on 5xx spikes, lockouts and staff MFA resets **(provider)**.
- [ ] Mobile production build: `EXPO_PUBLIC_API_URL` is https; built from a clean checkout; `allowBackup=false` present in the generated manifest.

## C. Staff and procedure (human)

- [ ] Every staff account belongs to one named person; there are no shared accounts.
- [ ] At least two OWNERs, each with MFA, and recovery codes stored offline.
- [ ] Quarterly access review: remove leavers and check roles against duties.
- [ ] Support access to group data only through group-approved, time-limited grants.
- [ ] Incident runbook (`incident-response.md`) contacts filled in, and a rehearsal held.
- [ ] Data-protection obligations (ODPC registration, privacy notice, 72-hour breach notification) confirmed with counsel.

## D. Remaining risks (accepted, with owner and target)

| Risk | Severity | Compensating control | Owner | Target |
|---|---|---|---|---|
| No member step-up re-authentication for sensitive member actions | Medium | Maker-checker on all money movement; security notices | backend lead | 2026-12 |
| In-memory rate limiting (per instance) | Medium | DB-backed account lockout; single instance | backend lead | before horizontal scaling |
| Staff MFA is TOTP (phishable in real time); no WebAuthn | Medium | Step-up reauth; security e-mails; short staff sessions | backend lead | 2027-Q1 |
| MFA encryption key derived from the staff token secret; rotation forces re-enrolment | Low | Documented in the IR runbook | backend lead | 2027-Q1 (KMS key) |
| Password blocklist is local; no breached-password corpus check | Low | Normalised blocklist plus personal-detail check; lockout | backend lead | 2027-Q1 |
| Tenant write sweep masked by request validation | Low | Read sweep (mutation-checked); per-feature cross-group tests; DB snapshot unchanged | backend lead | 2026-12 |
| Least-privilege DB role not yet active in deployed environments | Medium | RLS; Prisma parameterisation | ops | before launch |
| Mobile: no certificate pinning, root detection, screenshot blocking; no MASVS/MASTG testing | Medium | Server-side enforcement; SecureStore | mobile lead | before public launch |
| No AV scanning of evidence uploads | Low | Magic-byte allowlist; files never executed or served inline as HTML | backend lead | 2027-Q1 |
| Dependency advisories in the build toolchain (braces, node-forge, decode-uri-component, deepmerge-ts, postcss-selector-parser) | Low (not in the runtime path) | Allowlist with expiry | see allowlist | see allowlist |
| No independent penetration test | High (unknown unknowns) | This internal review | founders | before public launch |
