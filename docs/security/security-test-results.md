# Security test results

Run on 2026-10-23 in a development container (Node 22, PostgreSQL 16). **These are internal automated results, not an independent assessment or penetration test.** A green build alone is not evidence of security: see the limitations below and the remaining risks in `security-checklist.md`.

## 1. Full verification run

Command, from a clean `npm ci` of the committed lockfile:

```
npm ci && npm run build -w @chamahub/shared && npm run test -w @chamahub/shared \
 && npm run typecheck -w @chamahub/api && npm run typecheck -w @chamahub/admin && npm run typecheck -w @chamahub/mobile \
 && npm run test -w @chamahub/api -- --runInBand && npm run build -w @chamahub/admin \
 && npm audit --json > audit.json; node scripts/audit-gate.mjs audit.json
```

| Step | Result |
|---|---|
| `npm ci` | 1432 packages installed from the lockfile |
| Shared unit tests (vitest) | **87 / 87 passed** (7 files) |
| Typecheck: api, web, mobile | passed |
| API tests (jest, 17 suites) | **172 / 172 passed** |
| Web production build | passed |
| Dependency gate | passed (all remaining advisories on the allowlist) |

## 2. Security-specific tests

| Test | What it proves | Result |
|---|---|---|
| `backend/test/tenant-isolation.e2e-spec.ts` | Group A's chairperson calls every group GET route with more than one path param, using every id stored against group B (ids harvested from every table with a `groupId` column). No 2xx response contains group B data (>500 calls). No cross-group write is accepted, and a snapshot shows group B unchanged. A non-member gets 403/404. | Pass (4 tests) |
| Mutation check of the above | Removing the `groupId` filter from `evidence.service.ts` made the read sweep **fail**. The change was then reverted. | Sensitive to a real regression |
| `backend/src/common/spreadsheet.spec.ts` | A valid xlsx is read and formulas are not evaluated. Rejected: a 60 MB-of-zeros zip bomb (<200 KB file), lying declared sizes, encrypted entries, >500 entries, non-zip input. | Pass (4) |
| `packages/shared/src/password-strength.test.ts` | Common, leet and padded passwords, keyboard and number runs, and personal details are refused; strong passphrases are accepted. | Pass (5) |
| `auth-groups.e2e-spec.ts` | Common or personal passwords are refused at register, reset and change. Refresh rotation with reuse detection. Lockout. SECURITY notices contain no 6-digit code or URL. | Pass |
| `platform-portal.e2e-spec.ts` | Staff auth: mandatory MFA; TOTP replay refused; recovery codes; reauth required for sensitive routes (`REAUTH_REQUIRED`, then success after `POST auth/reauth`); forged and member tokens refused on every portal route; privilege-escalation rules; at least one owner kept; append-only audit without secrets; reset e-mails without a token or link. | Pass |
| `src/config/env.spec.ts` | In production, CORS `*`, http, path and wildcard origins are refused; exact https origins are accepted. | Pass (2) |
| `src/modules/notifications/push-text.spec.ts` | Financial and security push text has no amounts, phone numbers, references or names. | Pass (2) |
| `security.e2e-spec.ts` | RLS on every table; security headers; CORS allowlist; errors without stack traces. | Pass |
| `finance`, `governance`, `roles`, `rotation`, `collections`, `billing` | Maker-checker (nobody approves their own payment, loan or payout); the ledger is append-only at DB level; forged webhooks rejected; fake evidence files rejected; destination changes need approval. | Pass |

## 3. Least-privilege database role

`backend/scripts/db-roles.sql` was applied to a scratch database migrated to head. The results as `chamahub_app`:

| Statement | Result |
|---|---|
| `SELECT count(*) FROM users` | allowed |
| `INSERT` / `DELETE` on `_prisma_migrations` | `permission denied` |
| `CREATE TABLE` | `permission denied for schema public` |
| `DROP TABLE users`, `ALTER TABLE users ...` | `must be owner of table users` |
| `TRUNCATE users` | `permission denied` |
| `rolsuper` | `f` |
| Re-running the script | idempotent |
| API started with `DATABASE_URL` as `chamahub_app` | started (migration check passed); `POST /v1/auth/register` succeeded |

**Issue found and fixed during this test:** the first version of the script left the app role unable to see any rows. Every table has RLS on with no policies, from the Supabase lockdown migration. The script now adds a per-table policy for `chamahub_app` only.

The same checks run in CI (`ci.yml`, step "Least-privilege database role"). The full e2e suite still runs as the owner, because its reset helper uses TRUNCATE.

## 4. Secret scanning

gitleaks 8.24.2 with `.gitleaks.toml`:

- Full history, 42 commits: **no leaks**.
- Committed and untracked working tree, excluding gitignored files: **no leaks**.

The config relaxes only the generic-key rule, and only in `backend/test/`, which holds throwaway e2e passwords. A planted AWS-style key in `backend/test/` and a generic key in `backend/src/` were both still detected.

Locally, the gitignored `web/.next` build output contains Next.js preview keys. They are generated per build and never committed.

## 5. Dependencies

| Scope | Before this work | After |
|---|---|---|
| Production dependency tree (`npm audit --omit=dev`) | 22 (16 high) | 17 (14 high, 3 moderate, 0 critical) |
| Full tree | 62 | 52 (0 critical) |

Fixes made:

- Removed `xlsx` (SheetJS) from the web app; it has unpatched prototype-pollution and ReDoS advisories. Uploads are now parsed by the server with the zip-bomb guard.
- Overrides: `postcss` 8.5.31, `uuid` 11.1.1.
- Upgraded `fflate`, `vitest` 4.1.12 and Prisma 6.19.3.

All remaining advisories trace to five packages. Each is on the allowlist with a reason, owner and expiry:

- `braces`, `node-forge`, `decode-uri-component`: Expo/Metro mobile toolchain;
- `deepmerge-ts`: prisma CLI config;
- `postcss-selector-parser`: tailwind 3 build.

None of them is in the API request path. No breaking upgrades were applied automatically.

## 6. Limitations of these results

- **Write sweep:** in the tenant write sweep, many writes are rejected by body validation before the record lookup runs. The write sweep therefore proves only that no cross-group write succeeded, not that every lookup is scoped. Per-feature cross-group tests exist in `mobile-officers`, `rotation`, `collections`, `ai` and `auth-groups`.
- **Mobile:**
  - deep-link validation and `allowBackup=false` are implemented but not covered by an automated test (there is no mobile test runner);
  - no MASTG testing has been performed.
- **Not run here:** CodeQL and the GitHub gitleaks action run only on GitHub; their first results are not yet available.
- **Not performed:** load or DoS testing, TLS configuration testing (External) and a penetration test.
