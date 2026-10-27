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
| Compromised member account | Portal → Users → **Sign out everywhere** (keeps the account open), or **Suspend**; *send reset code*; *unlock*. All member sessions are also revoked when the password changes. |
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

## Playbooks

Each playbook follows the general procedure above. The lines below are what is specific to each scenario.

| Scenario | Detect | Triage | Contain | Revoke | Preserve | Reconcile | Recover | Notify | Root cause and verify |
|---|---|---|---|---|---|---|---|---|---|
| **Account takeover (member)** | Member report; SECURITY notices (new device, token reuse); `credential_stuffing` alert | Which groups and roles? Any approvals or destination changes since? | Portal: *Sign out everywhere*; suspend if the attacker is still active | Sessions (done by the above); send reset code | `audit_events` for the user since the first suspicious login | Review approvals they gave; reverse wrong postings through the ledger | Member resets password; reactivate | Member; group officers if their actions were affected | How did they get the password? Was there a weak password, or a phished OTP? |
| **Compromised staff account** | Staff security e-mails (new device, MFA change); `platform.*` audit anomalies | What permissions? Any support grants, refunds, suspensions? | Another owner: suspend the helper (sessions end at once) | Reset MFA; password reset; revoke grants | `platform_audit_logs` export | Undo plan, price and promotion changes; refunds | Re-invite after review | Affected groups if grants were used | Phishing? Prioritise WebAuthn |
| **Exposed secret** | gitleaks/GitGuardian; vendor notice | Which secret, which environment, since when? | Rotate at the provider **first** | Per the rotation table in `security-operations.md` | Note where it was exposed (commit, log, chat) | — | Redeploy; confirm the old value fails | Provider if their terms require it | Remove from history after rotating |
| **Unauthorized financial change** | Member dispute; statement mismatch; unusual adjustment | Which entries and who? (the journal is append-only, so the history is intact) | Suspend the group (read-only) or the officer | Officer sessions | Export the group's journal and audit trail | **Reversal entries with reasons, through maker-checker; never edit rows** | Lift the suspension | All group members | Which approval rule failed? Add a test |
| **Payment-provider compromise or forged callbacks** | `payment_callback_forgery` alert; payments FAILED with "did not confirm" | Was the callback token leaked? Any confirmed payments without a provider receipt? | Rotate `MPESA_CALLBACK_TOKEN`; allow only Safaricom IPs at the edge | Daraja consumer key and secret if suspected | `mpesa_requests.rawCallback`, provider statements | Match against the M-Pesa statement through statement import | — | Safaricom | Verify the STK query is enforced (`payments-integrity` test) |
| **Database compromise** | Provider alert; unexpected DDL; data on the internet | Read only, or write? Which credentials? | Rotate the DB passwords (owner and `chamahub_app`); restrict network access | All app secrets (assume env leaked) | Provider logs; snapshot | Compare with the last verified backup | `backup-and-recovery.md` if integrity is in doubt | ODPC within 72 h if personal data was exposed; members | Least-privilege role active? Network exposure? |
| **Data leakage (cross-tenant or export)** | `cross_tenant_probing` alert; `export.downloaded` anomalies; report | Which records and groups? Use the request ids | Fix or disable the route (feature flag or deploy); suspend the actor | The actor's sessions | Audit and export records | — | Deploy the fix with a regression test in `tenant-isolation` | Affected groups; ODPC if personal data | Add the route to the sweep |
| **AI data exposure** | Report of an answer with another group's or member's data | Which conversation? The tool calls are recorded | `AI_PROVIDER=disabled` | — | `ai_conversations` and usage records | — | Fix the tool's permission or scope; re-enable | Affected members | Add a test to `ai.e2e-spec.ts` |
| **Malicious upload** | Report; CodeQL/AV (if added) | Which file, which payment? | Remove the evidence file (soft delete, if one exists; otherwise ask engineering to quarantine it) | Uploader's sessions if hostile | The file's SHA-256 and audit row | — | — | Officers who opened it | Magic-byte and type rules; consider AV scanning |
| **Ransomware / backup recovery** | Provider alert; database unreachable or encrypted | Scope; last good point in time | Stop the API; isolate credentials | All secrets | Snapshot what is left | Gap: M-Pesa statements for the missing period | `backup-and-recovery.md` restore procedure, verified with `verify-restore.sh` | Members; ODPC if personal data | How did they get access? Off-site backup intact? |

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
