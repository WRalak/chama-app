# ChamaHub security architecture

This document describes how ChamaHub's security controls work and where each one lives in code. It is mapped to **OWASP ASVS 5.0** (API and web) and **OWASP MASVS v2** (mobile) as a *design reference*.

ChamaHub has **not** been assessed against either standard by an independent party. Nothing here is a claim of compliance or certification. Each row states one of:

- **Implemented**
- **Tested** (an automated test fails if the control is removed)
- **Partial**
- **Not implemented**
- **External**: hosting, provider or human procedure.

## 1. Principles

1. **The server decides.** Identity, group membership, role, permissions, account status, approval status, balances and plan entitlements are read from the database on every request. Clients never supply them: ids in the body are ignored where the URL or session defines them.
2. **Tenant first.** Every group route passes `GroupAccessGuard`: a non-member gets 404, and a suspended group is read-only. Every service query filters by the `groupId` that guard resolved.
3. **Money moves only through the ledger.** The ledger is append-only (DB triggers) and balanced (trigger). Corrections are new entries, and every money action is maker-checker.
4. **Two separate identities.** Members and ChamaHub staff have separate tables, password hashes (bcrypt vs scrypt), JWT secrets, cookies, guards and audit logs.
5. **Fail closed.** The API refuses to start:
   - on missing migrations;
   - with `DEV_LOG_OTP` or `DISABLE_THROTTLE` in production;
   - with unsafe production CORS.
6. **No secrets in clients.** Provider keys exist only in the API environment. The web app is a BFF that keeps tokens in httpOnly cookies. The mobile app keeps its tokens in SecureStore.

## 2. Components and controls

### Authentication

| Control | Where |
|---|---|
| Member password hashing (bcryptjs) | `modules/auth/auth.service.ts` |
| Password policy: length, common-password blocklist with normalisation (`P@ssw0rd2026!` is caught), and the person's own name, phone or e-mail | `packages/shared/src/password-strength.ts`, `passwordSchema`, `assertNotPersonal` |
| Phone OTP verification; OTPs are stored hashed and never logged (`DEV_LOG_OTP` is refused in production) | `auth.service.ts`, `config/env.ts` |
| Lockout: 5 failures, 15 minutes, stored in the DB | `auth.service.ts` |
| Security notices: lockout, new device, token reuse, password reset or change. The text never includes codes or links | `auth.service.ts` `securityNotice` |
| Staff password hashing (scrypt); separate staff JWT secret | `platform-auth/staff-crypto.ts` |
| Mandatory staff TOTP: guard returns `MFA_SETUP_REQUIRED`; replay protection via `mfaLastStep`; 10 recovery codes stored as SHA-256 | `platform-auth.service.ts`, `common/guards.ts` |
| TOTP secrets encrypted at rest (AES-256-GCM, random IV, auth tag) with a key derived from the staff token secret | `staff-crypto.ts` |
| Staff step-up re-authentication (password plus TOTP) before 27 sensitive actions, valid for `PLATFORM_REAUTH_MINUTES` | `@RequireRecentAuth()`, `PlatformGuard`, `POST /v1/platform/auth/reauth`, `web/src/components/platform/reauth-dialog.tsx` |
| Staff security e-mails: lock, new device, MFA changes, recovery-code use, password changes, role changes | `platform-auth.service.ts` `securityEmail`, `staff.service.ts` |
| No public owner registration: owners come from a one-time bootstrap CLI; `platform:dev-admin` refuses to run in production | `cli/platform-bootstrap.ts`, `cli/platform-dev-admin.ts` |

### Sessions

| Control | Where |
|---|---|
| Members: 15-minute access token; 30-day refresh token rotated on use; reuse revokes the token family | `auth.service.ts` |
| Web cookies: access token `httpOnly; SameSite=Lax; Secure` in production; refresh token `SameSite=Strict`, path `/api` | `web/src/lib/server/session.ts` |
| Staff: 10-minute access token; session re-read on every request so revocation is immediate; cookies scoped to `/api/platform` | `common/guards.ts`, `web/src/lib/server/platform-session.ts` |
| Mobile: tokens in SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; `android.allowBackup=false` | `mobile/src/lib/storage.ts`, `mobile/app.json` |

### Authorization

| Control | Where |
|---|---|
| Group membership and permission checks from DB role assignments | `GroupAccessGuard`, `@Permissions` |
| Maker-checker: the maker or beneficiary cannot approve; nobody verifies their own payment or approves their own loan or payout; joint signatories | `finance/approvals.service.ts`, `contributions.service.ts`, `loans.service.ts`, `rotations.service.ts` |
| Changing a payment destination needs another officer's approval, and members are notified | `collections/destinations.service.ts` |
| Staff RBAC: nobody grants a permission they lack; admins cannot create admins or owners; at least one owner always remains | `platform/staff.service.ts` |
| Staff access to group data needs a time-limited, group-approved support grant | `platform/support-grants.controller.ts` |

### Data protection and integrity

- **Append-only tables:** DB triggers on journal entries and lines, audit events, votes, billing history and destination details. A balanced-entry trigger blocks unbalanced journal entries.
- **Idempotency keys** on payments. Concurrency is tested in `concurrency.e2e-spec.ts`.
- **RLS:** on for every table with no policies for the Supabase `anon`/`authenticated` roles (`20261026000000_lock_down_data_api`).
- **Least-privilege runtime role:**
  - `backend/scripts/db-roles.sql` creates `chamahub_app`: rows only, no DDL or TRUNCATE, migration history read-only, `statement_timeout` 30 s.
  - The CI job verifies it.
  - Switching each environment's `DATABASE_URL` to it is **External**.
- **Evidence uploads** are labelled as member-submitted. They never mark a payment verified; an officer has to confirm against the statement.
- **Lock-screen privacy:** push text for financial and security kinds is generic, and push data carries only record ids (`notifications.service.ts` `pushText`).

### Input handling

- **Validation:** zod schemas shared between client and server; a global validation pipe; a 6 MB JSON limit.
- **Spreadsheet uploads (`common/spreadsheet.ts`):**
  - zip-bomb guard: real inflate with a 40 MB cap and at most 500 entries; ZIP64 and encrypted archives are refused;
  - formulas are never evaluated; only cached values are read;
  - the unpatched SheetJS `xlsx` package was removed.
- **CSV export:** formula-injection neutralisation (`common/csv.ts`).
- **Evidence files:** magic bytes must match the declared type.
- **Deep links:** only `[A-Za-z0-9_-]{1,64}` ids are interpolated into routes (`mobile/src/lib/links.ts`).

### API and transport

- **Headers:** helmet security headers; `x-powered-by` hidden; errors carry no stack traces.
- **CORS:** an exact allowlist. In production it must be exact `https://` origins (`config/env.ts`).
- **Throttling:** `@nestjs/throttler`, 300/min globally, stricter on auth routes (e.g. reauth 5/min). It is in memory, per instance (**Partial**).
- **Server timeouts:** headers 20 s, request 60 s, keep-alive 5 s (`main.ts`).
- **Webhooks:** M-Pesa callback token; billing webhooks are checked against the provider status API and processed idempotently.
- **TLS:** terminated by the host (**External**). `trust proxy` is set to 1 hop.

### AI assistant

- The model can only call read-only, permission-filtered tools, as the signed-in member, inside that member's current group.
- Tool output is marked as data.
- The model never calculates amounts and has no write, approval, transfer or SQL capability (`docs/AI.md`).

### Supply chain and CI

- `npm ci` from the lockfile.
- `overrides` pin patched transitive versions.
- **`.github/workflows/security.yml`:**
  - npm audit gate against `security/audit-allowlist.json`: every entry has a reason, owner and expiry; an expired entry fails the build;
  - gitleaks over full history (`.gitleaks.toml`);
  - CodeQL `security-extended`;
  - also runs weekly.

### Logging

- Audit events are written for every financial and staff action and are append-only.
- The portal audit test asserts that the audit trail contains no secrets.
- Not logged: passwords, OTPs, tokens, recovery codes, MFA secrets.
- Centralised log shipping and alerting are **External / Not implemented**.

## 3. OWASP ASVS 5.0 mapping (design reference)

| ASVS 5.0 chapter | ChamaHub controls | Status |
|---|---|---|
| V1 Encoding and Sanitization | Prisma parameterised queries; CSV formula neutralisation; React escaping; formulas never evaluated | Implemented / Tested (CSV, xlsx) |
| V2 Validation and Business Logic | Shared zod schemas; maker-checker; append-only ledger; idempotency; concurrency tests | Tested |
| V3 Web Frontend Security | helmet headers; httpOnly SameSite cookies; BFF; no tokens in JS | Implemented / Tested (headers) |
| V4 API and Web Service | Exact CORS; body limits; throttling; error hygiene; server timeouts | Tested (CORS, errors); throttling Partial |
| V5 File Handling | Magic bytes; size limits; zip-bomb guard; no formula evaluation | Tested. AV scanning Not implemented |
| V6 Authentication | Hashing; blocklist and personal-detail checks; lockout; staff MFA with replay protection; recovery codes; security notifications; no default credentials | Tested. Breach-corpus check and WebAuthn Not implemented |
| V7 Session Management | Short access tokens; rotation with reuse detection; server-side staff sessions; revocation; staff step-up re-authentication | Tested. Member step-up Not implemented |
| V8 Authorization | Group guard; permission checks; BOLA sweep; staff RBAC anti-escalation; support grants | Tested (write-sweep Partial) |
| V9 Self-contained Tokens | Separate member and staff signing secrets; staff tokens bound to a live DB session | Tested |
| V10 OAuth and OIDC | Not used | n/a |
| V11 Cryptography | Platform crypto only (bcrypt, scrypt, AES-256-GCM, HMAC, CSPRNG); no custom algorithms; keys from env. **MFA key is derived from the staff token secret, so rotating that secret invalidates enrolled TOTP** | Implemented. Separate KMS-held key Not implemented |
| V12 Secure Communication | TLS at the host; `Secure` cookies in production; https-only production CORS | External / Tested (CORS) |
| V13 Configuration | Env validated at start-up; production refusals; secret scanning; dependency gate | Tested / Implemented in CI |
| V14 Data Protection | Push privacy; masked old destinations; data export of the member's own data only; AI retention | Tested |
| V15 Secure Coding and Architecture | Dependency gate; CodeQL; lockfile; documented threat model | Implemented |
| V16 Security Logging and Error Handling | Append-only audit; no secrets in audit; generic errors | Tested. Alerting External |
| V17 WebRTC | Not used | n/a |

## 4. OWASP MASVS v2 mapping (design reference; no MASTG testing performed)

| MASVS group | ChamaHub controls | Status |
|---|---|---|
| MASVS-STORAGE | SecureStore with this-device-only access; `allowBackup=false`; no secrets in the bundle (`EXPO_PUBLIC_*` holds only the API URL and public legal/contact text) | Implemented |
| MASVS-CRYPTO | No app-side crypto; the platform keystore through SecureStore | Implemented |
| MASVS-AUTH | Server-side auth; no local-only (biometric) authorisation; every officer action re-checked by the API | Implemented |
| MASVS-NETWORK | HTTPS API URL in production builds; certificate pinning **Not implemented** | Partial |
| MASVS-PLATFORM | Deep-link and push data validated to plain ids; no sensitive data in push text; clipboard used only for share text the user chose to copy | Implemented / Tested (push text) |
| MASVS-CODE | Dependency gate; Expo SDK kept current; remaining toolchain advisories on the allowlist | Partial |
| MASVS-RESILIENCE | No root or jailbreak detection, obfuscation or tamper checks | Not implemented |
| MASVS-PRIVACY | Minimal push data; member data export; no analytics SDKs | Implemented |
