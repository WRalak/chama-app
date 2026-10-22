# Global SaaS upgrade: implementation plan

## What existed before this upgrade

- **Groups**
  - Types: merry-go-round, table banking, investment, welfare, savings, hybrid.
  - No country, currency, time zone or language settings. All money was implicitly KES; all dates were implicitly Africa/Nairobi.
- **Money**
  - Integer minor units everywhere (BigInt in the database, safe integers in the API).
  - A double-entry, append-only ledger enforced by database triggers.
  - `formatKes` / `parseKes` assumed two decimal places and KES.
- **Plans and subscriptions**
  - `plans`: a code, one KES price, a member cap and a list of feature labels.
  - `subscriptions`: one row per group with TRIALING, ACTIVE, PAST_DUE or CANCELLED, set by platform staff.
  - New groups got a trial on the cheapest plan.
  - Nothing enforced plan features.
  - No billing payments, provider integration, receipts or billing history.
- **Platform administration**
  - Overview (counts and integration health), groups, accounts, staff, settings, security events and support grants.
  - Its "MRR" figure was the sum of list prices of ACTIVE subscriptions, not money collected.
- **Platform roles**: USER, SUPPORT, PLATFORM_ADMIN, SUPER_ADMIN. None of them can read group finances without a chairperson-approved, time-boxed support grant.
- **Localisation**: English only, strings inline, no localisation layer.
- **AI assistant**: read-only tools, per-user and per-group limits, cost tracking. Not tied to any plan.

## Design decisions

1. **One base currency per group.** A group chooses its currency when created.
   - The database copies the group's currency onto every payment and journal entry, and rejects any attempt to record a different one.
   - The currency can no longer change once the group has money records.
   - Amounts stay integer minor units, with the number of decimals taken from the currency (0 for UGX, 2 for KES, 3 for KWD).
2. **Billing is separate from group money.** Subscription payments live in their own tables (`billing_*`) and never touch a group's ledger, contributions, loans or payouts.
3. **Configuration in the database.** The following are editable by platform staff and audited:
   - plans, regional prices, entitlements, trial rules, grace period, reporting currency;
   - which countries are open;
   - which payment provider serves which country, currency and method.
   The Kenya prices are seeded as initial rows, not constants.
4. **Entitlements on the server.**
   - `EntitlementService` resolves a group's effective plan: active promotional access, then a paid, trial or grace subscription, then Free.
   - `@RequireFeature` on API routes, and member-limit checks wherever members join, return `402 Payment Required` with the feature and the cheapest plan that includes it.
   - Reading records, statements, reports and exports is never gated.
5. **Payments.**
   - A `BillingProvider` interface covers: initiate, verify webhook, fetch trusted status, and refund (when supported).
   - Business logic (activation, renewal, proration, refunds) never depends on a specific provider.
   - A payment becomes SUCCEEDED only after the provider's own status API confirms it, the amount and currency match, and the transition happens once (an idempotent state change).
   - Every webhook is stored as an immutable `billing_event`, de-duplicated by the provider's event id.
6. **Providers.**
   - **M-Pesa Daraja (STK push plus STK query):** Kenya first. Uses ChamaHub's own shortcode and credentials, separate from any group's.
   - **Paystack:** extensible international card and mobile money (redirect checkout, HMAC-SHA512 webhooks, verify API, refunds).
   - **Manual:** bank transfer or invoice recorded by finance staff with a reference.
   - **Sandbox:** HMAC-signed, for development and automated tests; refuses to load in production.
   - None is marked operational until configured; health shows "not verified".
7. **Revenue reporting from records.**
   - Cash collected comes from verified payments, less refunds and fees.
   - MRR and ARR come from paying subscriptions' contracted price.
   - Costs come from recorded operating costs plus AI usage cost.
   - Consolidation into the reporting currency uses recorded exchange rates, showing the rate and date. Amounts without a rate are listed separately, never added.
8. **Least privilege.**
   - New platform role FINANCE: revenue, refunds, costs, FX.
   - New permissions: `platform.view_billing`, `platform.manage_billing`, `platform.refund`, `platform.view_revenue`, `platform.manage_finance`.
   - Group permission `billing.manage` (chairperson and treasurer by default).
   - No billing role can read group ledgers.
9. **Localisation architecture.**
   - Shared message catalogues (`en`, `sw`) and a `t()` function.
   - The user's language preference is stored and used by web and mobile navigation and statuses first.
   - Further strings move into the catalogues over time.

## Increments

1. Shared layer: currencies, conversion, billing rules, entitlements, localisation, permissions, schemas and types (with unit tests).
2. Migration: group regional settings, currency columns and triggers, regions, the plan and price rework, subscriptions, promotions, billing payments, events, refunds, cases, provider availability, FX rates, operating costs, subscription events, receipt sequence; append-only and immutability triggers; initial configuration rows.
3. Backend: entitlement service and guard, subscription service (checkout, activation, upgrade with proration, scheduled downgrade, cancel and resume, trial, grace and expiry, renewal reminders), provider registry and providers, webhooks, reconciliation job, refunds, promotions, cases, revenue service, platform admin endpoints, data export.
4. End-to-end tests for every rule in section 8 of the brief.
5. Web: group "Plan & billing", upsell for gated features, platform revenue, plans and prices, billing, regions and providers, costs and FX, group subscription detail. Mobile: plan and billing screen for officers.
6. Docs, environment variables, legal text (billing and cancellation terms), verification.
