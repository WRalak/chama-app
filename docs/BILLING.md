# Subscriptions, billing and global settings

ChamaHub charges groups for the software through plans. This is completely separate from a group's own money:

- Subscription payments live in `billing_*` tables and never touch the ledger, contributions, loans or payouts.
- Nothing the AI assistant does can create or change a billing record.

## Regions, currency, time zone, language

- **Countries.** `regions` lists countries. Groups can only be created in an `available` one. Subscriptions are sold only where `billingAvailable` is set **and** a provider is enabled.
- **Launch currencies.** Opening a region is refused unless its currency is in `LAUNCH_READY_CURRENCIES` (`packages/shared/src/currency.ts`; KES today). The reason: SMS and e-mail texts, PDFs, AI answers and personal cross-group totals still format amounts as KES.
- **One base currency per group.**
  - Chosen when the group is created (the region's default).
  - A database trigger copies it onto every `payments` and `journal_entries` row and overrides any other value.
  - A second trigger refuses to change the group's currency once it has money records.
  - Amounts are integer minor units, with the decimals taken from the currency (`CURRENCIES`: UGX 0, KES 2, KWD 3).
- **Conversion.** `convertMinor` / `convertMinorInverse` need an explicit dated rate, use exact rational arithmetic and round once. Different currencies are never added together (`totalsByCurrency`).
- **Time zone and language.**
  - The group's time zone and language are stored and editable in Settings.
  - Each user's language (`users.locale`) drives the translated parts of the apps: navigation, tabs, statuses and billing prompts.
  - Catalogues are in `packages/shared/src/i18n.ts` (English and Kiswahili). A missing key falls back to English.
  - The Kiswahili text needs review by a native speaker.
- **Not yet localised:** contribution schedules still assume Africa/Nairobi for due dates, and SMS, e-mail and PDF texts are English.

## Plans and entitlements

| Plan | Members | Paid features | Kenya price (placeholder) |
| --- | --- | --- | --- |
| Free | 15 | none: core records, statements, rotations, meetings | — |
| Starter | 30 | new loans, contribution reminders, WhatsApp summaries | KSh 500 / month, 5,000 / year |
| Standard | 100 | + statement import, bulk import | KSh 1,000 / month, 10,000 / year |
| Premium | 500 | + AI assistant, priority support | KSh 2,000 / month, 20,000 / year |

**These prices are placeholders seeded by the migration.** Replace them with the approved prices in Platform › Plans & pricing before taking payments.

**Where the rules live**

- Plans and prices are rows in `plans` and `plan_prices`, keyed by plan, country (`*` = any other), currency and interval.
- Changes are audited.
- A subscription keeps the price it paid (`subscriptions.amountMinor`), so a price change applies from the next period.

**How access is decided** (`resolveAccess`, pure and unit-tested)

- The better of an active promotion and the subscription wins: trial, paid period, or grace after a missed renewal.
- Otherwise the group is on Free.
- Dates are checked directly, so access ends on time even if the background job has not run.

**How it is enforced**

- `EntitlementService` plus `@RequireFeature(...)` on API routes return `402 Payment Required`. The response says the feature, the current plan and the cheapest plan that includes it.
- The member limit is checked on invitations (counting pending ones), on joining (invitation or code) and on member imports.
- Reading never needs a paid plan: ledgers, statements, reports, exports, payment history and receipts stay available after expiry.

## Subscription lifecycle

```
new group ──► TRIALING (trial of `trialPlanCode`, `trialDays`) ──► EXPIRED (Free) when the trial ends
checkout ──► payment PENDING ──(provider status API confirms amount + currency)──► SUCCEEDED ──► ACTIVE
ACTIVE ──period end──► PAST_DUE (grace: paid features continue `graceDays`) ──► EXPIRED (Free)
ACTIVE + cancel ──► cancelAtPeriodEnd ──period end──► CANCELLED (Free)
ACTIVE + downgrade ──► scheduled; at period end the group renews on the lower plan
upgrade ──► immediate; unused time credited (prorationCreditMinor)
```

- **Lifecycle job.** The job (`billing-lifecycle`, every 10 minutes) moves statuses, sends renewal reminders (`renewalReminderDays`), notifies chairperson and treasurer, re-checks pending payments, and fails stale ones.
- **Recurring charges.** Automatic recurring charges are not implemented: a group renews by paying.

## Payments

**Provider interface.** `backend/src/modules/billing/providers/provider.ts` defines `initiate`, `parseWebhook` (authenticity), `fetchStatus` (the trusted answer) and an optional `refund`. Subscription logic only uses this interface.

**Availability.** Which provider serves which country, currency and methods, and whether it supports refunds and recurring charges, is configuration in `billing_provider_availability`. Platform › Regions & providers edits it.

**Rules every payment follows**

1. A unique reference (`CHB-…`) and a client idempotency key.
2. A webhook is authenticated (signature or secret token), stored once in `billing_events` (unique per provider event id), then **only triggers a status check**. The provider's status API decides.
3. Activation is a conditional update from PENDING, FAILED or CANCELLED to SUCCEEDED, so duplicates, retries and the reconciliation job can never apply it twice.
4. The amount and currency must match. On a mismatch nothing is activated and a HIGH-priority billing case opens.
5. Test and live are separate (`livemode`). Test payments never count as revenue, and a webhook in the wrong mode is ignored.
6. Receipts are numbered from a database sequence (`CHB-R-YYYY-NNNNNN`).
7. Database triggers prevent changing a payment's amount, currency, plan or reference, and deleting payments, events or refunds.
8. No PIN, OTP, card number or password is ever received. Payer phones are masked, and personal or card fields are stripped from stored webhooks.

| Provider | Status |
| --- | --- |
| `MPESA_DARAJA` | STK push to ChamaHub's own shortcode; callbacks need the secret URL token, then STK Query confirms. **Not verified.** |
| `PAYSTACK` | Hosted checkout, HMAC-SHA512 webhooks, Verify API, refunds. **Not verified;** disabled in every country. |
| `MANUAL` | Bank transfer or invoice; finance staff confirm with the bank reference (audited). |
| `SANDBOX` | Signed fake provider for development and tests; refuses to run in production. |

**Refunds and disputes**

- Refunds need `platform.refund` (FINANCE role).
- A full refund ends the period that payment bought.
- A disputed payment (provider chargeback) is marked DISPUTED and opens a case. Access is unchanged until it is resolved.

## Platform roles

| Role | Can |
| --- | --- |
| SUPPORT | Support tickets; view billing status and payments (no revenue, no refunds) |
| PLATFORM_ADMIN | Groups, accounts, plans and prices, promotions, billing cases; no revenue figures, no refunds |
| FINANCE | Revenue, refunds, manual payment confirmation, costs, exchange rates; no accounts |
| SUPER_ADMIN | Everything, including regions and provider availability |

None of them can read a group's ledger. That still needs the chairperson's time-boxed support grant.

## Revenue report (`GET /v1/platform/revenue`)

**Kept separate in the report**

- **Cash.** Verified payments by currency, refunds, provider fees and net. Pending and disputed payments are listed apart and never added.
- **Recurring.** MRR and ARR come from the contracted price of subscriptions whose current period was bought with a verified payment in that mode (annual = 1/12). Also by plan and country, and average per paying group.
- **Groups.** Paying, grace, promotion, trial and free; new paying groups; renewals; churn and retention (from `subscription_events`).
- **Costs.** `operating_costs` rows plus measured AI usage (`ai_usage.costMicroUsd`). Recorded AI invoices take precedence, to avoid counting AI twice. CAC is acquisition costs divided by new paying groups.

**Consolidation**

- Amounts are converted into `reportingCurrency` only with recorded `exchange_rates`. Each rate's value, date and source is listed.
- Currencies without a rate are excluded and flagged (`complete: false`).
- "Estimated operating profit" is net cash minus recorded costs.

## Environment variables

These go in `backend/.env.example`: `BILLING_CALLBACK_BASE_URL`, `BILLING_WEBHOOK_TOKEN`, `BILLING_MPESA_*`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_CALLBACK_URL`, `BILLING_MANUAL_INSTRUCTIONS`, `BILLING_SELLER_*`, `BILLING_SANDBOX_SECRET`. Never commit real values.

## Before charging real customers

- [ ] Approved prices entered; placeholder prices replaced.
- [ ] Daraja: production shortcode for ChamaHub, go-live approval, callback URL reachable over HTTPS, one real payment confirmed end to end.
- [ ] Or Paystack: live key, webhook URL registered, a test and a live payment confirmed, a refund tested.
- [ ] `BILLING_SELLER_*` and the tax position for each market checked with an accountant (VAT and Digital Service Tax in Kenya; e-invoicing requirements).
- [ ] Billing, renewal and cancellation terms reviewed by an advocate (they are in the Terms of Use).
- [ ] Consumer-protection, data-protection and financial-service obligations assessed for every market before opening it.
