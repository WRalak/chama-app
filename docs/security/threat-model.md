# ChamaHub threat model

Status: living document. Last reviewed 2026-10-27 after the "enterprise security" audit (previous review 2026-10-23). This is an internal engineering assessment, **not** an independent audit, penetration test or certification.

Status words used below:

- **Implemented**: in code, on by default.
- **Tested**: an automated test fails if the control is removed.
- **Partial**: some cases are covered.
- **Not implemented**.
- **External**: depends on hosting or provider settings, or on people following a procedure.

## 1. System and trust boundaries

```
 Member phone (Expo app) ──HTTPS──┐
 Member browser ──► Next.js BFF (/api/proxy, httpOnly cookies) ──HTTPS──► NestJS API ──► PostgreSQL
 Staff browser ──► Next.js BFF (/api/platform/proxy, cookies scoped to /api/platform) ──┘      │
                                                                                               ├─► M-Pesa / billing providers (webhooks in)
                                                                                               ├─► SMS / WhatsApp / e-mail / Expo push
                                                                                               └─► AI provider (read-only tool results out)
```

**Trust boundaries:**

1. The client and the API. Nothing from a client is trusted: user ids, group ids, roles, permissions, statuses, balances and entitlements are all derived on the server.
2. The API and the database. Today the API connects as the table owner; `backend/scripts/db-roles.sql` provides a least-privilege runtime role, which must be switched on per environment (External).
3. The API and third parties. Webhooks are verified; outbound credentials live only in API environment variables.
4. Member identity and staff identity. They use separate tables, password hashing, JWT secrets, cookies and guards.
5. The API and the AI model. The model gets only read-only tool output and cannot write.

## 2. Assets

| Asset | Why it matters |
|---|---|
| Ledger (journal entries and lines), payments, payouts, loans | Members' money. Wrong or forged records cause direct loss and disputes. |
| Payment destinations (paybill, till, phone) | Changing one diverts future contributions. |
| Member PII (names, phones, e-mail, national ID if entered) | Privacy and Kenyan Data Protection Act exposure. |
| Member sessions and refresh tokens; staff sessions and MFA secrets | Account takeover. |
| Staff (platform) accounts | Cross-tenant powers: suspend groups and users, billing, support access. |
| Evidence uploads (receipt images, PDFs) | Personal and financial documents. |
| Provider credentials (M-Pesa, SMS, e-mail, AI, database URL) | Abuse of paid services, data access. |
| Audit logs | Needed for disputes and incident response; must be append-only. |

## 3. Attackers

- **A1 – anonymous internet user:** credential stuffing, enumeration, DoS, malicious uploads.
- **A2 – member of group A** trying to read or change group B (BOLA/IDOR).
- **A3 – a member** trying to escalate inside their own group (approve their own payout or loan, change the destination).
- **A4 – a malicious or compromised officer** (chair, treasurer) in their own group.
- **A5 – a compromised or malicious ChamaHub staff helper.**
- **A6 – an attacker holding a stolen phone or token.**
- **A7 – a supply-chain attacker** (a malicious npm package).
- **A8 – prompt-injection content** in group data aimed at the AI assistant.
- **A9 – a forged webhook sender.**

## 4. Threats, controls and evidence

Columns:

- **Path:** how the attack works.
- **Prevent:** controls that stop it.
- **Detect:** how we would notice it.
- **Recover:** how we would undo it.
- **Test:** the automated evidence.

| # | Attacker → asset | Path | Impact | Prevent | Detect | Recover | Test / status |
|---|---|---|---|---|---|---|---|
| T1 | A2 → any group record | Call `/v1/groups/A/...` with an id from group B | Cross-tenant data leak or change | `GroupAccessGuard` (non-member → 404); every service query is scoped by `groupId` from the URL *after* membership is checked | Audit events; 404 spikes | n/a (read) | **Tested.** `tenant-isolation.e2e-spec.ts` sweeps every group GET route with more than one param against every group-B id (>500 calls); write sweep; mutation-checked. **Partial** for writes: request validation runs before the lookup, so the write sweep proves only that writes are refused, not that each lookup is scoped. |
| T2 | A1 → member account | Password guessing or stuffing | Takeover | scrypt (old bcrypt hashes are upgraded at sign-in; bcrypt ignored characters after 72 bytes); lockout after 5 failures for 15 min (DB-backed); throttling, with a shared store option; blocklist of common and personal passwords; a disabled account is revealed only after the correct password | SECURITY notice at lockout; `credential_stuffing` alert | Reset via OTP; sessions revoked; staff can sign the member out everywhere | **Tested** (`auth-groups`, `sessions-identity`, `password-strength.test.ts`, `security-monitoring`) |
| T3 | A6 → member session | Stolen refresh token reused | Persistent takeover | Rotation with reuse detection revokes the whole token family | SECURITY notice on reuse | User signs in again | **Tested** |
| T4 | A1/A6 → member | Sign-in from a new device | Takeover goes unnoticed | — | SECURITY notice for a new device (no codes or links in the text) | Change password; sessions revoked | **Tested** (notice content) |
| T5 | A1 → staff account | Password guessing; phishing | Platform-wide powers | scrypt; separate secret; lockout; **mandatory TOTP MFA** (`PLATFORM_REQUIRE_MFA`); TOTP replay protection; recovery codes stored hashed | E-mail on lock, new device, MFA changes, recovery-code use | Owner can reset MFA or revoke sessions | **Tested** (`platform-portal.e2e-spec.ts`) |
| T6 | A5/A6 → staff powers | Unattended or hijacked staff session performs sensitive actions | Mass suspension, billing fraud | **Step-up re-authentication** (password plus TOTP) within `PLATFORM_REAUTH_MINUTES` on 27 sensitive routes; sessions re-read on every request | `platform.reauth` audit entries | Revoke sessions | **Tested** (reauth test). Not phishing-resistant: WebAuthn is **Not implemented**. |
| T7 | A3/A4 → payouts, loans, payments, destinations | Approve your own request | Theft from the group | Maker-checker in `approvals.service.ts`: the maker or beneficiary cannot approve; you cannot verify your own payment or approve your own loan or payout; joint signatories | Audit trail; notices to members | Reversal entries (the ledger is append-only) | **Tested** (`governance`, `roles`, `rotation`, `finance` suites) |
| T8 | A4 → ledger | Edit or delete history | Hidden theft | DB triggers forbid UPDATE, DELETE and TRUNCATE on journal entries and lines, audit events and votes; balanced-entry trigger | Statement reconciliation | Corrections are new entries only | **Tested** (`finance.e2e-spec.ts`) |
| T9 | A4 → destinations | Treasurer switches the paybill to their own number | Diverted contributions | Change needs approval by another officer; members are notified | DESTINATION_CHANGED notices | Revert via approval | **Tested** (`collections.e2e-spec.ts`) |
| T10 | A1/A2 → API | Zip bomb or oversized `.xlsx` import | Memory exhaustion (DoS) | `assertSafeXlsx`: central-directory walk, real inflate with a 40 MB cap, 500 entries max, no ZIP64 or encryption; body limit (256 KB; 8 MB on upload routes); `xlsx` (SheetJS, unpatched CVEs) removed | 422 responses | — | **Tested** (`spreadsheet.spec.ts`) |
| T11 | A1 → evidence storage | Upload a script or HTML disguised as an image | Stored XSS or malware | Magic-byte check; allowlisted types; size limit | — | Delete the upload | **Tested** (existing collections tests) |
| T12 | A1 → CSV exports | Formula injection (`=HYPERLINK(...)`) | Phishing via spreadsheet | `common/csv.ts` prefixes dangerous leading characters | — | — | **Implemented** |
| T13 | A9 → payments | Forged M-Pesa or billing webhook (for example, a leaked callback URL token) | Fake "paid" status; money appears in the ledger that never arrived | M-Pesa: the URL token is only the first check; **every success is confirmed with Daraja's STK query before posting**; amount must match; unique receipts; idempotent. Billing: signature plus provider status API | `payment_callback_forgery` alert; `mpesa.callback_not_confirmed` audit | Nothing to undo: unconfirmed callbacks never post | **Tested** (`payments-integrity`, mutation-checked; `billing`) |
| T14 | A8 → AI | Injected instructions in minutes or notes | Misleading answers; data exfiltration | Read-only tools only; tools filtered by permission; results marked as data; the model never computes amounts or writes records | — | — | **Tested** (`ai.e2e-spec.ts`) |
| T15 | A7 → build/runtime | Malicious or vulnerable dependency | Code execution | Lockfile; `npm audit` gate with an expiring allowlist; overrides for patched transitive versions | Weekly scheduled audit; CodeQL | Pin or revert | **Implemented** in CI (`security.yml`); runs on GitHub (External) |
| T16 | Anyone → secrets | Secret committed to git | Credential abuse | `.env` ignored; gitleaks scans full history in CI | gitleaks | Rotate the secret | **Implemented**; history scan clean on 2026-10-23 |
| T17 | A6 → phone | Lock-screen push reveals amounts or security info | Privacy leak | `pushText`: generic text for financial and security kinds; only `*Id` fields in the push data | — | — | **Tested** (`push-text.spec.ts`) |
| T18 | A1 → mobile | Malicious `chamahub://` link or push data injects a route | Open redirect / unexpected screen | `routeForNotification` accepts only `[A-Za-z0-9_-]{1,64}` ids; screens re-check with the API | — | — | **Implemented** (no mobile test runner yet) |
| T19 | A6 → device backup | `adb backup` / cloud backup extracts app storage | Token theft | `android.allowBackup=false`; tokens in SecureStore (Keychain/Keystore) | — | — | **Implemented** (effective from the next native build) |
| T20 | A1 → browser | Cross-origin calls with the user's cookies | CSRF/CORS abuse | Exact CORS allowlist; production refuses `*`, http and wildcard origins; SameSite cookies; BFF; **`Origin`/`Sec-Fetch-Site` check on every cookie-authenticated write** | 403s | — | **Tested** (`env.spec.ts`, `security.e2e-spec.ts`, `web-security.test.ts`, live check on the built app) |
| T21 | A1 → API | Slowloris / slow body | Worker exhaustion | Header timeout 20 s, request timeout 60 s, keep-alive 5 s; throttling | — | — | **Implemented** |
| T22 | Any SQL injection → DB | Injection gives DDL or mass delete | Data loss | Prisma parameterised queries; least-privilege role script (no DDL, no TRUNCATE, read-only migration history, statement timeout) | — | Backups/PITR (External) | Script **tested manually** and in the CI step; switching `DATABASE_URL` to it is **External** |
| T23 | A1 → Supabase data API | anon key reads tables | Full leak | RLS on with no policy for anon/authenticated; grants revoked | — | — | **Tested** (`security.e2e-spec.ts`) |
| T24 | A5 → group data | Staff browse group finances | Privacy | Support access needs a time-limited grant approved by the group; all staff actions are audited | Audit log | Revoke the grant | **Implemented** (grant flow not covered by an automated test yet) |
| T25 | Anyone | Owner self-registration / default credentials | Platform takeover | No public owner endpoint; bootstrap CLI with `--confirm`; dev-admin refuses production | — | — | **Tested** (portal suite) |
| T26 | A2/A3 → someone else's phone | Repeated STK pushes to any number | Harassment; a stranger tricked into paying | 3/min per caller; ≤ 5 prompts per phone and ≤ 10 per member per hour; idempotency keys bound to the member | `rate_limited` events | — | **Tested** (`payments-integrity`) |
| T27 | A1 → member | Phishing link `…/login?next=/\evil.example` sends the user to a look-alike site after sign-in | Credential theft | `safeRedirectPath` (refuses absolute, `//` and backslash forms) on member and staff login | — | — | **Tested** (`web-security.test.ts`). **Fixed in this audit** (the member login was vulnerable) |
| T28 | A4/A6 → group data | Bulk download of statements and ledgers by a hijacked officer session | Privacy breach | Exports need the permission; 20/min; `no-store`; **audited before the file is sent** (`export.downloaded`, visible in the group audit trail) | Group audit trail | Revoke sessions | **Tested** (`sessions-identity`) |
| T29 | Any officer → ledger | Concurrent requests (double clicks, scripts) post twice or overpay a loan | Wrong balances | Status-guarded updates in transactions; idempotency keys; unique receipts | — | Reversal entries | **Tested** (`concurrency`, `rotation`, `payments-integrity`) |
| T30 | Insider with log access → accounts | One-time codes in logs | Account takeover | OTPs stored as HMAC only; development SMS logs mask codes unless `DEV_LOG_OTP` is on; production never logs message text | — | — | **Tested** (`security-monitoring`). **Fixed in this audit** (development logs showed codes) |
| T31 | Ransomware / malicious admin → database | Encrypt or delete the database and backups | Unrecoverable records | PITR plus an independent off-site copy that the app role cannot reach (External); restore verification | Backup failure alerts (External) | `backup-and-recovery.md` | Restore check **Tested** (CI); production backups **External** |

## 5. Findings of the 2026-10-27 enterprise audit

| Severity | Finding | Status |
|---|---|---|
| High | M-Pesa STK callbacks (unsigned by Safaricom) posted money on the strength of the URL token alone; a leaked token allowed fake payments | Fixed: provider confirmation (T13) |
| Medium | STK push could prompt any phone repeatedly | Fixed (T26) |
| Medium | Open redirect after member sign-in (`/\host`) | Fixed (T27) |
| Medium | bcrypt truncation: characters after 72 bytes ignored, while 128 were allowed | Fixed: scrypt with upgrade at sign-in (T2) |
| Medium | Financial exports not audited and cacheable | Fixed (T28) |
| Medium | Rate limits multiplied per instance | Fixed: shared store option |
| Medium | No detection of probing or stuffing patterns | Fixed: security events and alerts |
| Medium | No tested restore procedure | Fixed for tooling and CI; production drill External |
| High | New advisories in the request path: body-parser and multer (DoS), zod (memory exhaustion validating large collections) | body-parser 2.4.0 and multer 2.5.0 pinned. zod: fix needs v4 (breaking), so mitigated with 256 KB bodies (measured worst case 286 ms / 76 MB → 24 ms / 7 MB); allowlisted until 2026-12-15 |
| Medium | Oversized or malformed request bodies returned 500 with a stack trace in logs; 5 MB `.xlsx` uploads exceeded the 6 MB body limit | Fixed: 413/400 JSON errors; 8 MB on upload routes |
| Low | CSRF relied on SameSite only | Fixed: origin check (T20) |
| Low | Disabled-account status visible without the password; idempotency key of another member returned their payment status | Fixed |
| Low | One-time codes visible in development logs | Fixed (T30) |
| Low | No staff tool to sign a member out everywhere | Fixed |
| Informational | No WebAuthn; no member step-up; no breached-password corpus check; no AV scanning; no tenant RLS policies | Open (see below) |

## 6. Known gaps (accepted or planned)

See `security-checklist.md` § Remaining risks for the owner and target date of each.

- **Member step-up re-authentication** is not implemented. Compensating control: maker-checker approvals on all money movement.
- **Rate limiting** defaults to in-memory (per instance). With more than one instance, set `RATE_LIMIT_STORE=database` (implemented and tested). Alert counters stay per instance.
- **No WebAuthn/passkeys** for staff; TOTP can be phished in real time.
- **The password blocklist is local** (about 180 words plus normalisation). There is no breached-password (HIBP k-anonymity) check.
- **The write sweep in the tenant test is masked by validation** (see T1).
- **The least-privilege DB role is not yet the default** connection in any deployed environment.
- **Mobile:**
  - no certificate pinning, root/jailbreak detection or screenshot blocking on sensitive screens;
  - no MASVS assessment has been performed;
  - no mobile unit-test runner.
- **No malware/AV scanning** of evidence uploads.
- **No centralised log shipping or alerting** (External).
