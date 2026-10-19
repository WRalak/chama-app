# ChamaHub architecture

## Monorepo

```
backend       NestJS REST API (/v1), Prisma, PostgreSQL — the only writer of financial data
web     Next.js dashboard; browser → same-origin BFF proxy → API
mobile    Expo app; talks to the API directly with tokens in the OS keystore
packages/shared  Zod request schemas, response types, enums, permission matrix, finance math
```

Business rules live in the API. The shared package gives both clients the same validation and labels. Its calculators are used by the API as the source of truth; the UIs use them only to preview. For example, the loan calculator calls `GET /loans/quote`.

## Identity, roles and multi-Chama access

- **One account, many Chamas.** One `User` per person (unique phone). `Membership(groupId, userId)` carries a **per-group role** (chairperson, vice chairperson, treasurer, secretary, auditor, member) plus optional `specialRoles` (loan committee, payout approver, read-only member, joint signatory). The group founder is recorded but gets no permanent control.
- **Backend enforcement.** `GroupAccessGuard` resolves the caller's membership for any route with `:groupId`. It computes `resolvePermissions(role, group.rolePolicy, specialRoles)` (from `packages/shared/src/permissions.ts`) and checks `@RequirePermission(...)` against **that group only**. Hiding buttons in the apps is cosmetic. A chairperson in group A has no extra rights in group B, and non-members get `404`, so a group's existence does not leak. Suspended members are read-only.
- **Default matrix.**
  - Treasurer records, prepares and disburses but does not approve expenses.
  - Chairperson verifies and approves but does not record payments or expenses.
  - Secretary handles invitations, meetings, minutes and announcements.
  - Auditor is read-only, sees the full audit log and raises findings.
  - Members vote, report their own payments (a reference is required and an officer must verify it) and report discrepancies.
- **Configurable within safeguards.** `PUT /groups/:id/role-policy` (`PERMISSIONS_CONFIGURE`) lets a group adjust each role's permissions. `PERMISSION_SAFEGUARDS` locks some permissions and blocks others per role. For example, auditors can never record or approve money, members can never verify or approve, and configuring permissions always stays with the chairperson. Rejected changes return `422` listing what was refused. Every change needs a reason and is audited.
- **Maker-checker everywhere.** The recorder cannot verify, the payer cannot verify their own payment, the borrower cannot approve their own loan, the loan preparer cannot approve it, the payout recipient cannot approve their own payout, and whoever raised a finding cannot resolve it.
- **Votes and findings.**
  - Proposals have a quorum and pass threshold. Each eligible member (holding `VOTES_CAST`) gets one ballot. Ballots are append-only, and the audit log records participation but not the choice. Expired votes close automatically.
  - Audit findings are raised by auditors and answered by the chairperson.
- **Audit visibility is scoped.** Auditors and chairpersons see the full log. Treasurers and secretaries see their area (finance or administration). Everyone else sees only their own actions.
- **Platform roles never imply group access.**
  - `SUPPORT`: account help (send a reset code, unlock).
  - `PLATFORM_ADMIN`: plans, accounts, stats.
  - `SUPER_ADMIN`: also manages staff and platform settings (channel kill switches, trial length, support-access cap, maintenance notice).
  - Reading a group needs a `SupportAccessGrant`. The grant states its purpose, is approved by that group's chairperson, is read-only and time-boxed, and every request under it is audited.
- **Auth.**
  - Phone + password (bcrypt). An SMS OTP verifies the phone before group features unlock.
  - Short-lived JWT access tokens are paired with rotating refresh tokens; reusing a refresh token revokes the session.
  - Accounts lock after repeated failures. Sessions are checked on every request.
  - Admin web: tokens live in httpOnly cookies behind a BFF proxy.

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
