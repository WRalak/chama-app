# ChamaHub roadmap

This file tracks where ChamaHub stands against the full product specification. The first release is built around merry-go-rounds; table banking, investment and welfare reuse the same membership, ledger, notification and permission core.

Status words: **done** means implemented, tested and in the apps. **Partial** means part of it works and the rest is listed. **Not started** means nothing is built yet.

## Done

| Area | Notes |
| --- | --- |
| Accounts, multi-Chama roles, platform staff | Per-group roles plus optional roles. Each group can configure permissions within safeguards. Support access needs a chairperson-approved, audited, time-boxed grant. |
| Ledger and integrity | Double-entry in integer cents. The database keeps the ledger and audit log append-only and enforces balanced entries. Idempotency keys; maker-checker. |
| Contributions | Schedules, obligations, partial payments, verification by a second officer, self-reported payments, disputes. |
| **Rotation engine (phase 1)** | Draft → approval by officers or a members' vote. Order methods: agreed, random draw (published seed) and carry-over. Several recipients per round. Readiness checks; prepare / approve / send / confirm with evidence. Failed attempts and retries; amendments; the original approved plan is kept. 26 engine unit tests and 13 end-to-end tests. |
| Loans, distributions, statements, imports, meetings, votes, audit findings | See `ARCHITECTURE.md`. |
| **Collections (phase 1 of the automation platform)** | Payment destinations with maker-checker approval, history and member notifications; member “How to pay”; receipt/screenshot evidence; database-written payment history; CSV/XLSX statement import with column mapping, preview, duplicate detection, a matching engine (15 unit tests) and a review queue that never assigns an ambiguous line; WhatsApp summaries from confirmed records. 19 end-to-end tests. |
| **Mobile for every officer (phase 2)** | Role-aware group dashboard and shortcuts; mobile workflows for reconciliation (verify, search by member/amount/date/code, M-Pesa matching, duplicates, arrears, disputes), manual entries with evidence and review, payout preparation/approval/sending/confirmation, rotation drafting and amendments, members and roles, loan review with borrower standing and disbursement, expenses, meetings (attendance, minutes, resolutions, actions), announcements, reports with PDF/CSV sharing, settings, audit. Push registration and deep links. Tested per role, including cross-group tampering. |

## Next phases, in priority order

1. **Payment reconciliation**
   - Daraja STK status query, plus a job that resolves STK requests stuck without a callback.
   - Callback hardening: the secret token is checked in code; Safaricom IP allow-listing must still be set up at the edge.
   - Payment status "under reconciliation" shown on each obligation.
   - Reading PDF statements (today: CSV and Excel).
   - Paybill/Till C2B callbacks feeding the same matching engine and review queue as statements.
2. **Notifications**
   - Push is implemented; it needs an EAS project id and a development/store build to receive pushes on real phones.
   - Group-level channel preferences.
   - Offline viewing across app restarts (needs encrypted on-device storage before financial data is cached to disk).
   - WhatsApp Business API templates for sending summaries automatically. Today officers share them from the app; the texts already come only from confirmed records.
3. **Group setup wizard and group activation**
   - A guided setup (type → contributions → rotation → loans → notifications) in plain language.
   - Groups start as pending until the founding officers confirm the rules.
4. **Statements and reports.** Payout schedule/history PDF; a collection reconciliation report; monthly statement automation.
5. **Investment and welfare**
   - Investment: share register, asset and liability register, realized and unrealized gains, return of capital kept separate from profit.
   - Welfare: claims with eligibility checks, documents, approvals and benefit history.
   - Today only the investment holdings list and distributions exist.
6. **Subscriptions.** Plans and subscription status exist. Still to do: billing history and feature entitlements. Expiry must never block historical statements.
7. **OCR intake.** Photographed notebooks become *unverified* import rows that go through the existing review-and-approve import queue.

## Not planned without provider onboarding

- **M-Pesa B2C (automatic payouts).** Payouts are recorded with references and independently confirmed. B2C needs a Safaricom initiator account and security credential, plus result and timeout callbacks. Until then the app never claims money was sent automatically.
