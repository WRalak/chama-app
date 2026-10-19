# ChamaHub architecture

## Monorepo

```
apps/api       NestJS REST API (/v1), Prisma, PostgreSQL — the only writer of financial data
apps/admin     Next.js dashboard; browser → same-origin BFF proxy → API
apps/mobile    Expo app; talks to the API directly with tokens in the OS keystore
packages/shared  Zod request schemas, response types, enums, permission matrix, finance math
```

Business rules live in the API. The shared package gives both clients the same validation and labels. Its calculators are used by the API as the source of truth; the UIs use them only to preview. For example, the loan calculator calls `GET /loans/quote`.

## Identity and multi-Chama access

- One `User` per person (unique phone). `Membership(groupId, userId)` carries a **per-group role**: chairperson, vice chairperson, treasurer, secretary, auditor or member.
- `GroupAccessGuard` resolves the caller's membership for any route with `:groupId` and checks `@RequirePermission(...)` against **that group's role only**. A chairperson in group A has no extra rights in group B (covered by e2e tests).
- Non-members get `404` for a group, so its existence does not leak.
- Platform roles (`SUPPORT`, `SUPER_ADMIN`) manage the SaaS but **do not** see group finances. Read access needs a `SupportAccessGrant` that states its purpose, is approved by that group's chairperson, is read-only, expires, and audits every request.
- Auth: phone + password (bcrypt). An SMS OTP verifies the phone before any group features unlock. Short-lived JWT access tokens are paired with rotating refresh tokens; reusing an old refresh token revokes the session. Accounts lock after repeated failures. Sessions are checked on every request, so "sign out other devices" takes effect immediately.
- Admin web: tokens live in httpOnly cookies. The BFF proxy refreshes them and rejects cross-origin state changes.

## Financial model

- **Money is integer KES cents** (`BigInt` columns, `number` in the API, guarded by `Number.isSafeInteger`). Rates are basis points. Every rate result is rounded half away from zero. Splits use the largest-remainder method, so parts always sum exactly.
- **Double-entry ledger.** `JournalEntry` + `JournalLine` (debit +, credit −). Accounts: cash, member contributions, loans receivable, interest/fine/other income, expenses, payouts, distributions, opening balance.
- **Database-enforced integrity** (`prisma/integrity.sql`, appended to the initial migration):
  - A deferred constraint trigger rejects any unbalanced entry at commit.
  - Journal and audit tables reject `UPDATE`, `DELETE` and `TRUNCATE`. Corrections are reversal entries (`reversesId` is unique, so an entry can be reversed only once).
  - CHECK constraints: positive amounts, paid ≤ due, net = gross − offset.
- **Recorded ≠ received.** A manual payment is `PENDING` until an officer other than the recorder (and other than the payer) verifies it. Only `CONFIRMED` payments post to the ledger. Statuses: scheduled, pending, confirmed, failed, reversed, disputed.
- **Idempotency.** Every money-moving POST takes a client `idempotencyKey`, unique per group (or per disbursement, payout or allocation). Replays return the original; a key reused with a different payload gets `409`. Status transitions use guarded `updateMany(where status = X)` inside SERIALIZABLE transactions with retry.
- **Obligations** are generated from schedules per member per period. Members are never billed for periods before they joined. Generation is idempotent through a unique key. Statuses are computed: upcoming, due, partial, overdue (after grace days), paid, waived.
- **Loans.** Group policy: flat, one-off, reducing balance (equal principal) or amortized (equal installments, solved by integer binary search, so results are identical on every platform). The policy is snapshotted per loan. Eligibility is a multiple of confirmed savings minus outstanding principal. Approvals are maker-checker: a borrower can never approve their own loan unless the policy explicitly allows it, and even then an independent approval is still required. Disbursement is blocked if ledger cash is insufficient. Repayments go to interest first, then principal, oldest installment first. Overpayments are rejected, never silently absorbed.
- **Rotations.** A cycle generates rounds and a linked schedule. Each round's obligations are its collection. Payouts can be approved only for the earliest unpaid round (never skipped). A shortfall needs a recorded reason, and the recipient cannot approve their own payout. The amount paid out is the *confirmed* collection. Order changes are proposals that another officer approves. A cycle closes only when every round is complete.
- **Distributions.** Distributable = confirmed cash − liabilities − retained funds. Outstanding loans are shown but are never distributable. Methods: equal, contribution-proportional, share-based. The full calculation is stored before approval. Cash is re-checked at approval. Loan offsets post as real repayments.
- **Statements.** Group statements are computed from journal lines, classified by account (a reversal counts as the type it reverses). The tests check that opening + inflows − outflows = closing. Members see only published snapshots, with member names hidden unless the group allows it. Personal consolidated statements count each journal entry once and list loans received separately from income.

## Background jobs (`JobsService`, recorded in `job_runs`)

- Every 30 min: generate obligations, refresh statuses, issue configured late fines (one per obligation), update installment statuses.
- Daily at 08:00 EAT: contribution, repayment, payout and meeting reminders, de-duplicated per item.
- Every minute: dispatch queued SMS, WhatsApp and email deliveries according to each user's preferences.

## Paper-records migration

CSV (or Excel, converted in the browser) → per-row validation with errors and warnings → stored batch → a **different officer** reviews and commits. Data is re-validated at commit and everything is written in one transaction. Imported loan books post receivables against opening equity, not cash. Imported members claim their account through password reset by SMS.
