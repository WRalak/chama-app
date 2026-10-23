# ChamaHub incident response

This is a runbook for people. Most steps are **human procedures** (External): the code provides the levers named here, but someone has to pull them. Rehearse it at least once before launch and after any major change.

## Ground rules

- **Preserve evidence.** Never delete audit events, journal entries, sessions or logs during an incident. The ledger and audit tables are append-only by design: do not drop the triggers to "clean up". Take a database snapshot before any remediation.
- **Do not rewrite financial records.** Wrong money records are corrected with reversal or adjustment entries, approved through the normal maker-checker flow and explained in the entry reason.
- **Never run destructive commands against production** (TRUNCATE, `migrate reset`, bulk DELETE) as part of a response.
- **Don't spread secrets or personal data** while responding: no screenshots of tokens or full statements in chat tools. Share record ids instead.
- **Keep a timeline:** who did what, when, and why. UTC plus Africa/Nairobi.

## Roles

| Role | Responsibility |
|---|---|
| Incident lead (on-call OWNER) | Declares the incident and severity; makes the decisions |
| Investigator | Collects evidence (audit logs, DB queries, host logs) |
| Communicator | Writes to affected groups and members, and to the regulator if required |
| Scribe | Keeps the timeline |

One person may hold several roles in a small team. The lead must hold an OWNER staff account with MFA.

## Severity

| Sev | Examples | Target response |
|---|---|---|
| 1 | Cross-tenant data exposure; money diverted; staff account takeover; leaked production secret | Immediately, around the clock |
| 2 | Single member account takeover; forged payment status; dependency RCE reachable in production | Within 4 h |
| 3 | Vulnerability reported but not exploited; suspicious activity | Within 2 business days |

## Levers available today

| Situation | Lever |
|---|---|
| Compromised member account | Portal → Users → suspend; *send reset code*; *unlock*. All member sessions are revoked when the password changes. |
| Compromised group or officer | Portal → Groups → suspend: the group becomes read-only and no money actions are possible. |
| Compromised staff account | Another OWNER: Helpers → suspend or deactivate (sessions revoked at once); *reset two-step sign-in*; *password reset*. |
| Destination diverted | The change needed approval. Find it in the group audit log, then reject or replace it via a new approved change. Members were notified (`DESTINATION_CHANGED`). |
| Forged or incorrect payment | Do not edit it. Record a reversal through the ledger with a reason; the dispute workflow records the member's side. |
| Leaked secret | Rotate it at the provider, then update the API environment and redeploy. See the table below for side effects. |
| Malicious dependency | Pin the last good version in `package.json`/`overrides`, `npm ci`, redeploy; check `security.yml` runs. |
| Bad AI behaviour | Set `AI_PROVIDER=disabled` and restart the API. Quick answers keep working without the model. |

### Secret rotation side effects

| Secret | Effect of rotating |
|---|---|
| `JWT_ACCESS_SECRET` | All member access tokens become invalid (users refresh or sign in again). If `PLATFORM_JWT_SECRET` is **unset**, the staff secret is derived from this, so all staff sessions end **and all staff TOTP enrolments become unreadable**: staff must re-enrol. Set `PLATFORM_JWT_SECRET` explicitly in production to avoid this coupling. |
| `PLATFORM_JWT_SECRET` | All staff sessions end and **all staff TOTP secrets become unreadable** (they are encrypted with a key derived from it). Every staff member must re-enrol MFA, using the owner *reset two-step sign-in* path. Plan this. |
| `OTP_SECRET` | Outstanding OTPs stop working; users request new ones. |
| DB password | Update `DATABASE_URL`; with the least-privilege role, rotate `chamahub_app` by re-running `db-roles.sql` with a new password. |
| Provider keys (M-Pesa, SMS, e-mail, AI) | Rotate at the provider; no data impact. |
| Supabase service or anon keys | Rotate in Supabase. **Keys that have ever been pasted into chats or tickets must be treated as leaked and rotated.** |

## Procedure

1. **Detect and declare.** Sources:
   - member reports or disputes;
   - SECURITY notices users forward;
   - staff security e-mails;
   - CI security alerts (gitleaks, CodeQL, audit gate);
   - host alerts.

   Assign a severity and open a private incident note.
2. **Contain.** Use the levers above: suspend the account or group, revoke sessions, rotate secrets. Prefer suspension, which is reversible, to deletion, which never happens.
3. **Preserve.**
   - Take a DB snapshot or PITR marker.
   - Export the relevant `audit_events` and `platform_audit_logs` rows.
   - Save the host logs for the window.
   - Record request ids.
4. **Investigate.** Work out:
   - what was accessed or changed, by whom, and since when;
   - which tenants are affected. Use the group id in audit rows; `platform_audit_logs` covers staff actions.
5. **Eradicate.** Fix the root cause in code, with a regression test that fails before the fix. Deploy through CI; a green build alone is not evidence the issue is fixed.
6. **Recover.**
   - Correct balances with approved reversal entries.
   - Lift suspensions.
   - Ask affected users to change their passwords.
7. **Notify.**
   - Affected groups and members, in plain language, without exposing other people's data.
   - Under the **Kenya Data Protection Act 2019** a personal-data breach must be reported to the ODPC **within 72 hours** of becoming aware of it, and affected people informed. Legal counsel confirms what applies.
   - Payment-provider and partner contracts may have their own deadlines.
8. **Review.** Within 5 business days, hold a blameless post-incident review. Update `threat-model.md`, `security-checklist.md` and this runbook.

## Contacts (fill in before launch)

| Who | How |
|---|---|
| On-call OWNER | _to fill_ |
| Hosting provider support | _to fill_ |
| Safaricom Daraja support | _to fill_ |
| ODPC breach notification | https://www.odpc.go.ke |
| Legal counsel | _to fill_ |

## Vulnerability reports

Report vulnerabilities to `EXPO_PUBLIC_CONTACT_EMAIL` / the security contact on the website. Acknowledge within 2 business days and do not take legal action against good-faith reporters. Track each report as a Sev 3 until triaged.
