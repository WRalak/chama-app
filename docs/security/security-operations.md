# Security operations

The recurring work that keeps ChamaHub's controls effective. Items marked **(human)** depend on people; the code only provides the tools.

## 1. Monitoring and alerts

**Sources:**

- API log lines tagged `Security`: one JSON object per event (`securityEvent`, route template, user/staff/group id, IP, request id). They never contain tokens, codes, bodies or amounts.
- `SECURITY_ALERT` warning lines.
- The staff portal → **Audit → Security** view. Alerts appear there as `security.alert.*` with outcome `FAILURE`.
- `SECURITY_WEBHOOK_URL`: alerts are posted there (falls back to `ERROR_WEBHOOK_URL`).
- `ERROR_WEBHOOK_URL`: 5xx reports, with no request data.
- Job runs (`job_runs` table), shown in the portal's health view.

**Alert rules** (`backend/src/common/security-events.ts`, 5-minute window, one alert per subject per window):

| Alert | Trigger | First response |
|---|---|---|
| `cross_tenant_probing` | ≥ 25 denials (403, or 404 on a group route) by one user | Look at the routes and groups in the log lines. A broken client or a stale bookmark is common; repeated ids from other groups are not. If it looks hostile, sign the user out everywhere and suspend them. Ask before concluding it was fraud |
| `credential_stuffing` | ≥ 50 failed token or sign-in checks from one IP | Check whether accounts were locked. Block the IP at the edge/WAF if it continues |
| `rate_limit_abuse` | ≥ 30 rate-limit responses to one IP | Usually a script; block it at the edge if it persists |
| `payment_callback_forgery` | any M-Pesa "success" callback that Safaricom did not confirm | **Treat as Sev 2.** The callback URL token may have leaked: rotate `MPESA_CALLBACK_TOKEN` and check edge IP allow-listing |
| `duplicate_payment_events` | ≥ 5 duplicate receipt callbacks | Usually Safaricom retries; check for a replay pattern |

Alerts are **signals for a person to review**. They never block or accuse anyone automatically.

**External (human):**

- Ship API logs to a central store with ≥ 90-day retention and restricted access.
- Page someone for `SECURITY_ALERT` and 5xx spikes.
- Watch backup failures.

**Single API instance:** the alert counters are kept per instance. With several instances, set `RATE_LIMIT_STORE=database` for the rate limits, and rely on the central log pipeline to aggregate alerts.

## 2. Access reviews (human)

- **Monthly:** list staff accounts and roles in the portal. Check that every account is one named, current person. Remove leavers the same day they leave.
- **Quarterly:** review support access grants and helper permissions against their duties. Confirm that at least two owners exist, each with MFA.
- **After any incident:** review every account involved.

## 3. Key and secret rotation

| Secret | When | How | Side effects |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | yearly, or on suspected leak | set the new value, redeploy | members sign in again; if `PLATFORM_JWT_SECRET` is unset, staff are affected too |
| `PLATFORM_JWT_SECRET` | yearly, or on suspected leak | set it, redeploy, then each staff member re-enrols MFA (owner uses *Reset two-step sign-in*) | **TOTP secrets become unreadable**: plan it |
| `OTP_SECRET` | yearly | set it, redeploy | codes already issued stop working |
| `MPESA_CALLBACK_TOKEN` | on any `payment_callback_forgery` alert, or yearly | new random value of ≥ 32 characters; redeploy (the callback URL is rebuilt from it) | Safaricom's callbacks for STK pushes started before the change are refused (403). Those payments stay pending, and officers confirm them from the M-Pesa statement |
| DB `chamahub_app` password | yearly, or on leak | re-run `db-roles.sql` with a new password; update `DATABASE_URL` | short reconnect |
| Provider keys (Daraja, SMS, e-mail, AI, billing) | as the provider requires, or on leak | rotate at the provider; update env | none |

- Secrets live in the hosting provider's secret store, separately per environment. **Never** commit them or put them in `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` variables.
- gitleaks runs on every push. If a secret is ever committed, **rotate it first**, then remove it from history.

## 4. Vulnerability management

- **Weekly:** `security.yml` runs the dependency audit.
  - A new high or critical advisory fails the build: fix it, or add an allowlist entry with a reason, an owner and an expiry of at most 90 days.
  - An expired entry fails the build.
- **Pull requests:** dependency review blocks new high-severity dependencies.
- **CodeQL alerts:** triage within 5 business days (high/critical within 2).
- **No automatic breaking upgrades:**
  - Major versions (Expo SDK, Next.js, Prisma, NestJS) get a branch, a full test run and a manual check.
  - Expo SDK 58 is pending: Expo Go on phones is now 58, while the project is on 57.

## 5. Release checklist

Use `security-checklist.md` §A (gates) and §B (production configuration) for every production release. CI green is necessary, not sufficient.

## 6. Periodic tests

| Test | Frequency |
|---|---|
| Restore from a production backup (`verify-restore.sh`) | monthly |
| Incident tabletop (one playbook from `incident-response.md`) | quarterly |
| Independent penetration test (web, API, mobile) | before public launch, then yearly |
| Review of this document and the threat model | quarterly, and after major features |
