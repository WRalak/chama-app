# ChamaHub

**Every Chama. Every Contribution. One Place.**

ChamaHub manages multiple Chamas (savings groups) for the Kenyan market. It has three parts and one financial record:

| Part | Path | Stack | For |
| --- | --- | --- | --- |
| Mobile app | `mobile` | Expo SDK 54, React Native 0.81, Expo Router, TanStack Query, React Hook Form + Zod | Members, and officers on the go |
| Admin dashboard | `web` | Next.js 15 App Router, Tailwind, Radix/shadcn-style UI, TanStack Table/Query, Recharts | Chama officers and platform staff |
| API | `backend` | NestJS 11, Prisma 6, PostgreSQL 16 | Shared backend: all money rules and authorization |
| Shared | `packages/shared` | TypeScript + Zod | Contracts, enums, permission matrix, integer-cent finance math |

Both apps call the same API, so a payment an officer verifies on the web shows up on a member's phone, and the reverse.

## Quick start (local)

Prerequisites: Node 20+ (with npm), PostgreSQL 16. Run every command from the repository root: it is an npm workspace, so one `npm install` installs the backend, web, mobile and shared packages together.

```bash
npm install
cp backend/.env.example backend/.env          # set DATABASE_URL and two 32+ char secrets
cp web/.env.example web/.env.local
cp mobile/.env.example mobile/.env     # EXPO_PUBLIC_API_URL reachable from the phone
# Windows PowerShell: use `copy` instead of `cp`, with backslashes in the paths.

npm run dev:setup          # build shared, apply migrations, load DEMO data
npm run dev:api         # http://localhost:4000  (health: /health)
npm run dev:admin       # http://localhost:3000
npm run dev:mobile      # Expo dev server — open in Expo Go or an emulator
```

**Demo data only** (from `backend/prisma/seed.ts`; it refuses to run with `NODE_ENV=production`):

- `0700 000 001` / `Demo1234` — Amina: treasurer of *Jitegemee Table Banking*, chairperson of *Mombasa Investment Chama*, member of *Upendo Merry-Go-Round* and *Family Welfare Group*.
- `0700 000 099` / `Demo1234` — platform super admin.
- `0700 000 098` / `Demo1234` — platform admin.
- `0700 000 097` / `Demo1234` — support agent (no access to group finances without a chair-approved grant).

Roles are per group. See `docs/ARCHITECTURE.md` → *Identity, roles and multi-Chama access* for the permission matrix, optional roles and the safeguards that bound what a group can configure.

In development, OTP codes are written to the API log (`DEV_LOG_OTP=true`) because no SMS provider is configured.

## Tests

```bash
npm run test -w @chamahub/shared   # finance math: loan schedules, distributions, rotations, money parsing
npm run test -w @chamahub/api      # e2e against a real Postgres (TEST_DATABASE_URL, default chamahub_test)
npm run typecheck
```

The API suite covers auth (OTP, lockout, refresh-token reuse detection), group-scoped authorization across multiple groups, maker-checker verification, idempotency (including 10 concurrent submissions), reversals, ledger immutability enforced by the database, loans, rotations, distributions, statement reconciliation, imports, M-Pesa callback handling and platform-admin isolation. GitHub Actions runs all of it (`.github/workflows/ci.yml`).

## Integration status

Nothing below is presented to users as working unless it is configured.

| Integration | Status |
| --- | --- |
| M-Pesa Daraja (STK push, C2B confirmation) | **Implemented, not verified against Safaricom.** Disabled until all `MPESA_*` variables are set; the app then shows manual-payment instructions. Callbacks need a secret URL token and IP allow-listing at the edge. Requires sandbox testing and go-live approval. |
| SMS (Africa's Talking) | Implemented, not verified with a live account. Without credentials, nothing is sent. |
| WhatsApp Business Cloud API | Plain-text sending implemented; production use needs an approved WABA and message templates. |
| Email | Posts to a configured relay webhook; no provider bundled. |
| Push notifications | Not yet implemented (in-app notifications work). |
| Automated payouts (M-Pesa B2C) | **Not implemented.** Payouts are sent through the group's agreed channel and recorded with the transaction reference. Each payout completes only when the recipient confirms or a second officer verifies the reference. B2C needs separate Safaricom onboarding (initiator credentials, result/timeout callbacks). |
| PDF statements | Working (server-side, pdfkit). |
| CSV / Excel import, CSV export | Working. Excel is converted to CSV in the browser. |
| OCR of photographed notebooks | Planned. Extracted figures will always go through the import review queue, never straight into the books. |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design and financial rules, and [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for deployment, backups and the production checklist.
