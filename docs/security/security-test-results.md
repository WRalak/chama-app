# Security test results

Run on **2026-10-27** in a development container (Node 22, PostgreSQL 16), from a clean `npm ci` of the committed lockfile.

**These are internal automated results, not an independent assessment or penetration test.** A green build alone is not evidence of security: see the limitations in §7 and the remaining risks in `security-checklist.md` §D.

## 1. Full verification run

```
npm ci && npm run build -w @chamahub/shared && npm run test -w @chamahub/shared \
 && npm run typecheck -w @chamahub/api && npm run typecheck -w @chamahub/admin && npm run typecheck -w @chamahub/mobile \
 && npm run test -w @chamahub/api -- --runInBand && npm run build -w @chamahub/admin \
 && SOURCE_URL=…/chamahub_test SCRATCH_URL=…/restore_check_ci bash backend/scripts/verify-restore.sh \
 && npm audit --json > audit.json; node scripts/audit-gate.mjs audit.json
```

| Step | Result |
|---|---|
| `npm ci` | 1429 packages from the lockfile |
| Shared unit tests (vitest) | **92 / 92 passed** (8 files) |
| Typecheck: api, web, mobile | passed |
| API tests (jest) | **194 / 194 passed** (22 suites) |
| Web production build | passed |
| Restore verification (test database) | **PASS:** 15 migrations, ledger balanced, append-only triggers present, RLS on |
| Dependency gate | passed (4 advisories on the allowlist, each with an expiry) |

## 2. Tests added in this round

| Suite | What it proves | Result |
|---|---|---|
| `payments-integrity` | **Forged callback:** a "success" callback that Safaricom's STK query does not confirm never posts, and is audited. **Provider unreachable:** the callback is held; the retry posts once. **Duplicates:** the same callback ×10 at once posts once. **Receipts and amounts:** a receipt reused by another payment is refused; a manipulated amount → DISPUTED. **STK caps:** the 6th prompt to one phone in an hour is refused (429). **Keys:** another member's idempotency key → 409 | 5 / 5 |
| Mutation check of the above | Bypassing the STK query made the forged-callback test **fail**; the code was restored | sensitive |
| `concurrency` (extended) | Two full repayments of one loan confirmed at the same moment: exactly one posts, and the loan is not overpaid | 3 / 3 |
| `rotation` (extended) | Payout approval ×5 at once → one; disbursement requests ×5 with different keys → one attempt; recipient confirmation ×5 → one ledger posting; no 5xx | 13 / 13 |
| `sessions-identity` | New hashes are scrypt; old bcrypt hashes upgrade at sign-in; **every character of a >72-byte passphrase counts**; a suspended account loses access at once (token 403, refresh 401) and wrong passwords get the generic 401; expired and logged-out sessions are dead for both tokens; a reset code works once; staff "sign out everywhere" needs the permission (Analyst 403, member token 401) and is audited; exports are audited before sending, `no-store`, and not recorded when refused (403) | 7 / 7 |
| `rate-limits` | With the database store, two instances share counters, which reset after the window; a burst of 25 at once is counted exactly (10 allowed); `otp/request` returns 429 after 5, and the counters are in Postgres; client IPs are not stored readably | 3 / 3 |
| `security-monitoring` | 26 probes of another group's records by one member → exactly one `cross_tenant_probing` alert; events carry the route template and no URL ids; 50 forged tokens from one IP → one `credential_stuffing` alert, and the token text is never logged; one-time codes are never logged when SMS is not configured | 3 / 3 |
| `body-limits` | A 540 KB body on an ordinary route → 413 JSON without internals; malformed JSON → 400; a 2.3 MB import is accepted by the upload route | 3 / 3 |
| `packages/shared/src/web-security.test.ts` | Open-redirect payloads (`//host`, `/\host`, `\\host`, `javascript:`, tab, absolute URLs) are refused; the CSRF check refuses cross-site writes (`Origin`, `Sec-Fetch-Site`, `null` origin, look-alike hosts) and allows reads, same-origin writes and non-browser clients | 4 / 4 |
| `password-strength.test.ts` | The example passphrase shown in the error message is itself refused | 6 / 6 |

**Live checks against the built web app (`next start`):**

| Request | Result |
|---|---|
| POST `/api/auth/login` with `Origin: https://evil.example` | 403 "This request did not come from ChamaHub." |
| POST with `Sec-Fetch-Site: cross-site` | 403 |
| Same-origin POST | passed the check (500 only because the API was not running) |
| Cross-site GET | 200 |

## 3. Earlier security suites (still passing)

`tenant-isolation` (every group GET route × every id from another group, >500 calls, plus a write sweep), `platform-portal`, `auth-groups`, `security`, `finance`, `governance`, `roles`, `collections`, `billing`, `ai`, `mobile-officers`, `spreadsheet.spec`, `env.spec`, `push-text.spec`. Details are in the 2026-10-23 run (git history of this file).

## 4. Restore verification

| Run | Result |
|---|---|
| Local development database (86 tables) | PASS in 3 s, counts identical |
| Test database (CI-equivalent run) | PASS in 1 s |
| **Negative:** append-only trigger dropped in the restored copy | invariant check **FAILED** as intended (`append-only triggers missing: journal_lines_append_only`) |
| Guards | Refuses a scratch database not named `restore_check_*` (exit 2) and a non-empty one (exit 2) |
| Production backups | **Not yet verified (External)** |

## 5. Dependencies (`npm audit`, 2026-10-27)

| Scope | 2026-10-23 | Today, before fixes | After fixes |
|---|---|---|---|
| Full tree | 52 (0 critical) | 13 | **10** (7 high, 3 moderate, 0 critical) |
| Production tree (`--omit=dev`) | 17 | 10 | **7** (4 high, 3 moderate, 0 critical) |

New advisories published this week were caught by the gate:

| Package | Advisory | Action |
|---|---|---|
| body-parser 2.3.0 (Express, in the request path) | DoS: trailing bytes after a compressed body | Override to **2.4.0** (official patch release, same major) |
| multer 2.4.0 (Nest Express adapter) | DoS: pending fileFilter after teardown | Override to **2.5.0** (same major) |
| zod 3.25 (every request schema) | Memory exhaustion validating oversized collections; fixed only in **4.6.6+**, a breaking major | **Not auto-upgraded.** Mitigated: JSON bodies capped at 256 KB except four upload routes (8 MB), whose schemas have no unbounded collections. Measured with a 200-item `max()` array schema: **286 ms / 76 MB** at 4.8 MB, **24 ms / 7 MB** at the new cap. Allowlisted until **2026-12-15** (owner: backend lead) |

- **Still allowlisted:** node-forge and decode-uri-component (Expo tooling) and deepmerge-ts (Prisma CLI). All have owners and expiry dates.
- **No longer reported:** braces and postcss-selector-parser; their allowlist entries were removed.

## 6. Secret scanning

- gitleaks over the staged changes: **no leaks**.
- One finding during this round: a JWT-shaped *fake* token in a new test. It is now generated at run time instead, so no token-like literal is committed.

## 7. Limitations

- **M-Pesa:** the STK query is tested against a scripted Daraja client. It has **not** been verified against a live shortcode; do that in the Daraja sandbox before go-live.
- **Not performed:** load or DoS testing, TLS configuration testing (External), a mobile MASTG assessment, and a penetration test.
- **Alerting:** alert thresholds are tuned by judgement, not production data. Review them after the first weeks of real traffic.
- **CI:** CodeQL, dependency review and the GitHub gitleaks action run only on GitHub; check their results in the repository's Security tab.
