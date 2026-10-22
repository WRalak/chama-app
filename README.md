# ChamaHub

**Every Chama. Every Contribution. Every Payout. One Place.**

ChamaHub manages multiple Chamas (savings groups) for the Kenyan market. It has three parts and one financial record:

| Part | Path | Stack | For |
| --- | --- | --- | --- |
| Mobile app | `mobile` | Expo SDK 57, React Native 0.86, Expo Router, TanStack Query, React Hook Form + Zod | Members and every group officer: day-to-day management runs fully on the phone |
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
# Windows PowerShell: use `copy` instead of `cp`, with backslashes in the paths.

npm run dev:setup          # build shared, apply migrations, load DEMO data
npm run dev                # backend :4000, web dashboard :3000 and the Expo dev server, together

# or one at a time:
npm run dev:api            # http://localhost:4000
npm run dev:admin          # http://localhost:3000
npm run dev:mobile         # Expo: press w for the browser, or scan the QR code with Expo Go
```

The mobile app finds the API on the computer running the Expo dev server, so a phone on the same Wi-Fi needs no configuration (allow Node through the Windows firewall when asked). Set `EXPO_PUBLIC_API_URL` only for a deployed API.

**Demo data only** (from `backend/prisma/seed.ts`; it refuses to run with `NODE_ENV=production`):

- `0700 000 001` / `Demo1234` — Amina: treasurer of *Jitegemee Table Banking*, chairperson of *Mombasa Investment Chama*, member of *Upendo Merry-Go-Round* and *Family Welfare Group*.
- One user per role, to try each role's mobile experience (all `Demo1234`):

  | Role | Phone | Group |
  | --- | --- | --- |
  | Chairperson | `0700 000 002` (Peter) | Upendo Merry-Go-Round |
  | Treasurer | `0700 000 003` (Joyce) | Upendo Merry-Go-Round |
  | Payout approver (optional role) | `0700 000 005` (Mercy) | Upendo Merry-Go-Round |
  | Ordinary member | `0700 000 004` (Daniel) | Upendo Merry-Go-Round |
  | Secretary | `0700 000 009` (Lucy) | Mombasa Investment Chama |
  | Auditor | `0700 000 006` (Samuel) | Mombasa Investment Chama |
  | Loan committee (optional role) | `0700 000 002` (Peter) | Jitegemee Table Banking |
- `0700 000 099` / `Demo1234` — platform super admin.
- `0700 000 098` / `Demo1234` — platform admin.
- `0700 000 097` / `Demo1234` — support agent (no access to group finances without a chair-approved grant).

Roles are per group. See `docs/ARCHITECTURE.md` → *Identity, roles and multi-Chama access* for the permission matrix, optional roles and the safeguards that bound what a group can configure.

### Mobile app for officers

Each Chama opens with the member's own position. Officers also get a dashboard for that group (collections, next payout and readiness, items waiting for them) with shortcuts and the management sections their permissions allow: members, contributions and reconciliation, payout rotation, payout approvals, loans, expenses, meetings, announcements, reports and statements, settings, and activity/audit. Permissions are re-read per group from the API, which enforces them on every request; hidden buttons are only a convenience. Actions never run offline: an action either reaches the server and is recorded, or visibly fails.

### Collections: where to pay, evidence, statements and WhatsApp

- **Payment destinations.** A group can have several: Paybill, Till, bank account, the treasurer's M-Pesa number, cash and others. Each has its details, the responsible officer, how payments are confirmed, and effective dates.
  - New or changed details need another officer's approval before members see them, and every member is told when they change.
  - Old details stay on record as *no longer valid*, masked for members.
  - Members see **How to pay** with copyable numbers.
- **Evidence and history.** Members and officers can attach a receipt photo, screenshot or PDF (under 3 MB) to a payment. Every status change is logged by the database, whichever code path made it. Each payment shows its full history.
- **Statement import.** An officer uploads a CSV or Excel statement they downloaded from M-Pesa, a Paybill/Till portal or the bank. ChamaHub detects the columns (they can be changed), previews the file, flags duplicates and matches each line:
  - A member's own report with the same code and amount, or a single member paying from their registered phone or naming it in the account reference, is a **clear match**.
  - A name alone is only ever a **suggestion**. Two plausible members make the line **ambiguous**, and a person always chooses.
  - Confirming a member's report with the statement confirms it. Any other line becomes a payment that a second officer verifies.
  - Try it with `docs/samples/upendo-paybill-statement-demo.csv` as Joyce (0700 000 003) in the demo data.
- **WhatsApp summaries.** Collection status, payment receipts, payout notices and *how to pay* are built from confirmed records only and open in WhatsApp. They never include anyone's loans or balances, and they name who has not paid only when the group allows members to see each other's contributions.
- ChamaHub never asks for or stores an M-Pesa PIN, bank password or OTP, never logs into these accounts, and never reads SMS.

### Design system

Rose, berry and deep plum on a warm white background, with Satoshi as the typeface and amounts in KSh. Statuses always carry an icon and words. Run `npm run fonts:satoshi` once to install Satoshi from Fontshare; until then the apps use system fonts (mobile) and Inter (web). See [`docs/DESIGN.md`](docs/DESIGN.md).

### Governance

- **Joint Signatory.** A group can require one Joint Signatory approval on expenses, payouts, distributions and loans, on top of its normal approval count. The rule cannot be switched on without a signatory, and the last signatory cannot be removed while it is on.
- **Contribution reminders.** Treasurers can send reminders to every member who owes. Each member is told only their own amount, at most once every 12 hours.
- **Officer handovers.** When a chairperson, vice chairperson, treasurer or secretary changes, a permanent record of ledger figures and open work is saved for the incoming officer to acknowledge. Officers can also prepare one before leaving office.

### AI assistant

Members and officers can ask about their group's records on mobile (**Ask assistant**) and on the web (**AI Assistant**). The assistant only reads records through server-side tools allowed for the user's role in that group, and every figure comes from ChamaHub's financial engine. It cannot record, approve or move anything. Set `ANTHROPIC_API_KEY` in `backend/.env` to turn chat on. Without it, the same screens offer **quick answers** read straight from the records. See [`docs/AI.md`](docs/AI.md).

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
| Push notifications | **Implemented; needs a build with an EAS project.** The API sends through the Expo push service, and the app registers on sign-in and deep-links taps to the right screen. Expo Go (Android) and the browser preview cannot receive remote push; run `npx eas init` in `mobile/` and use a development or store build. In-app notifications always work. |
| Automated payouts (M-Pesa B2C) | **Not implemented.** Payouts are sent through the group's agreed channel and recorded with the transaction reference. Each payout completes only when the recipient confirms or a second officer verifies the reference. B2C needs separate Safaricom onboarding (initiator credentials, result/timeout callbacks). |
| AI assistant (Claude) | **Implemented; needs `ANTHROPIC_API_KEY`.** Tested with a scripted provider and against a local stub of the API, not against the live service. Without a key, chat is off and quick answers work. |
| PDF statements | Working (server-side, pdfkit). |
| CSV / Excel import, CSV export | Working. Paper-records imports convert Excel to CSV in the browser; statement imports read .xlsx on the server. |
| Statement import (M-Pesa, Paybill/Till, bank) | **Working, from files the officer downloads.** No account access, scraping or SMS reading. PDF statements are not read yet. |
| OCR of photographed notebooks | Planned. Extracted figures will always go through the import review queue, never straight into the books. |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design and financial rules, and [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for deployment, backups and the production checklist.
