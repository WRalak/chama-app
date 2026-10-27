# Security controls matrix

This matrix maps ChamaHub's controls to external standards, used as **engineering references**. It is not a certification, attestation or compliance statement: no independent party has assessed ChamaHub against any of these standards, and no penetration test has been done.

Status:

- **T** – tested: an automated test fails if the control is removed.
- **I** – implemented, without a dedicated test.
- **P** – partial.
- **N** – not implemented.
- **E** – external: hosting, provider or human procedure.

Test names refer to `backend/test/*.e2e-spec.ts` unless a path is given.

## 1. OWASP API Security Top 10 (2023)

| Risk | ChamaHub control | Evidence | Status |
|---|---|---|---|
| API1 Broken object-level authorization | `GroupAccessGuard`; `groupId` in every query; ids never trusted as access control | `tenant-isolation` (all group routes × all foreign ids, mutation-checked), `mobile-officers`, `ai`, `rotation` | T (write sweep P: validation runs first) |
| API2 Broken authentication | scrypt; lockout; refresh rotation with reuse detection; mandatory staff MFA with replay protection; separate staff key | `auth-groups`, `sessions-identity`, `platform-portal` | T |
| API3 Broken object property-level authorization | zod schemas strip unknown keys; responses are built field by field (no password hashes or phone numbers in staff views) | `platform-portal` (no hashes), `finance` (support view without phones) | T |
| API4 Unrestricted resource consumption | per-endpoint rate limits; shared store option; 256 KB bodies (8 MB on four upload routes); server timeouts; pagination max 200; zip-bomb guard; STK caps; AI quotas | `rate-limits`, `spreadsheet.spec`, `payments-integrity`, `ai` | T (load testing N) |
| API5 Broken function-level authorization | deny-by-default guards; `@RequirePermission`; separate staff routes and RBAC; step-up for sensitive staff actions | `roles`, `platform-portal` (every portal route × forged and member tokens) | T |
| API6 Unrestricted access to sensitive business flows | maker-checker; no self-approval; destination changes need approval; STK prompt caps | `governance`, `finance`, `rotation`, `collections`, `payments-integrity` | T |
| API7 SSRF | no user-supplied URLs are fetched; provider URLs come from configuration only | code review (`fetch(` used only in provider clients and webhooks) | I |
| API8 Security misconfiguration | env validated at start-up; production refuses unsafe CORS, `DEV_LOG_OTP` and `DISABLE_THROTTLE`; helmet; generic errors | `env.spec`, `security` | T |
| API9 Improper inventory management | the route inventory is generated from the router in the tenant sweep; single `/v1` prefix; health endpoint only outside it | `tenant-isolation` (asserts > 40 group routes) | I |
| API10 Unsafe consumption of APIs | M-Pesa callbacks confirmed with STK query; billing webhooks confirmed with the provider status API; amounts and receipts validated; idempotent | `payments-integrity`, `billing` | T |

## 2. OWASP ASVS 5.0 (chapters)

| Chapter | Controls | Status |
|---|---|---|
| V1 Encoding and Sanitization | parameterised Prisma queries; CSV formula neutralisation; React escaping; spreadsheet formulas never evaluated | T |
| V2 Validation and Business Logic | shared zod schemas; maker-checker; append-only balanced ledger; idempotency; concurrency | T |
| V3 Web Frontend Security | httpOnly SameSite cookies; BFF; CSRF origin check; safe redirects; helmet | T (unit + live check) |
| V4 API and Web Service | CORS allowlist; body limits; timeouts; rate limits | T |
| V5 File Handling | magic bytes; size limits; sanitised names; served `no-store` + `nosniff` behind group authorization; zip-bomb guard | T; malware scanning N |
| V6 Authentication | scrypt; blocklist; lockout; MFA (staff); recovery codes; notifications; no default credentials | T; breached-password check N; WebAuthn N |
| V7 Session Management | rotation; reuse detection; server-side revocation; idle and absolute timeouts (staff); staff step-up; admin revocation tools | T; member step-up N |
| V8 Authorization | group guard; permissions; staff RBAC anti-escalation; support grants | T |
| V9 Self-contained Tokens | short-lived JWTs bound to a live DB session; separate keys | T |
| V10 OAuth and OIDC | not used | n/a |
| V11 Cryptography | Node crypto only (scrypt, AES-256-GCM, HMAC-SHA256, CSPRNG); no custom algorithms; keys from env | I; KMS N |
| V12 Secure Communication | TLS at the edge; `Secure` cookies; https-only CORS in production | E / T |
| V13 Configuration | env validation; secret scanning; dependency gate | T / I (CI) |
| V14 Data Protection | push privacy; `no-store` exports; member's own data export; AI retention; data minimisation in support views | T |
| V15 Secure Coding and Architecture | threat model; CodeQL; dependency review; lockfile | I |
| V16 Security Logging and Error Handling | append-only audit; export audit; security events and alerts; no secrets in logs; OTP masking | T; central log retention E |

## 3. OWASP MASVS v2 (no MASTG testing has been performed)

| Group | Controls | Status |
|---|---|---|
| STORAGE | SecureStore (this device only); `allowBackup=false`; no secrets in the bundle | I |
| CRYPTO | platform keystore via SecureStore; no app-side crypto | I |
| AUTH | server-side authorization for every action; no local-only authorization | I |
| NETWORK | HTTPS API URL in production builds; certificate pinning N (not justified yet: pinning breaks on certificate rotation; reconsider with a managed pin set) | P |
| PLATFORM | deep-link ids validated; generic lock-screen push text; ids only in push data | T (push text) / I |
| CODE | dependency gate; Expo SDK updates | P (Expo Go now on SDK 58; the project is on 57) |
| RESILIENCE | no root/jailbreak detection or obfuscation | N (the threat model puts enforcement on the server) |
| PRIVACY | no analytics SDKs; minimal push data | I |

## 4. NIST Cybersecurity Framework 2.0 (functions)

| Function | ChamaHub evidence |
|---|---|
| GOVERN | threat model; release gates; accepted-risk register with owners and expiry; dependency allowlist with owners |
| IDENTIFY | asset and attacker inventory (`threat-model.md`); route inventory in the tenant sweep; `npm audit` |
| PROTECT | sections 1–8 of `enterprise-security-architecture.md` |
| DETECT | security events and alert rules; append-only audit logs; weekly dependency scan; CodeQL; gitleaks |
| RESPOND | `incident-response.md` playbooks; revocation and suspension levers in the portal |
| RECOVER | `backup-and-recovery.md`; `verify-restore.sh` in CI; reversal-only ledger corrections |

## 5. NIST SSDF (SP 800-218) practice groups

| Group | Evidence | Status |
|---|---|---|
| PO – Prepare the Organization | security docs; release gates; roles in IR | I |
| PS – Protect the Software | branch history scanned for secrets; lockfile; least-privilege CI tokens | I |
| PW – Produce Well-Secured Software | threat modelling; typed schemas; security regression tests; CodeQL; code review gate (human) | I / E |
| RV – Respond to Vulnerabilities | audit gate with expiry; dependency review; vulnerability reporting in `incident-response.md` | I |

## 6. Applicable regulation (to confirm with counsel)

- **Kenya Data Protection Act 2019:** ODPC registration; 72-hour breach notification; data subject rights (the member data export is implemented).
- **Safaricom Daraja terms:** callback handling and data use.
- **Card or bank partner contracts**, if added later.

For other countries ChamaHub serves, local equivalents apply. This document does not determine legal applicability.
