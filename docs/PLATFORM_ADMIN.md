# Platform staff portal

The portal at `/platform` is where ChamaHub staff run the service: users, groups, support, helpers, subscriptions, billing, revenue, settings and audit. It uses the same API and database as the member app, but staff have their own identity:

- **Separate accounts.** Staff are `platform_accounts` (e-mail + password), not member accounts. Being a chairperson or treasurer in a Chama gives no portal access, and a portal account has no Chama access.
- **Separate tokens.** Staff JWTs are signed with a different key (`PLATFORM_JWT_SECRET`, or one derived from `JWT_ACCESS_SECRET` with its own label). A member token gets `401` on every `/v1/platform/*` route; a staff token gets `401` on member routes.
- **Separate browser session.** The web app keeps staff tokens in httpOnly, `SameSite=Strict` cookies scoped to `/api/platform`, behind their own BFF proxy (`/api/platform/proxy`), which only forwards to `/v1/platform/*`. The member proxy refuses `platform/*` paths.

## Sign-in and sessions

- E-mail and password. Passwords are hashed with **scrypt** (N=32768, r=8, p=1, 16-byte salt). Minimum 12 characters with a letter and a number. Hashes are never returned by any endpoint.
- **One generic error** for every failed sign-in: unknown e-mail, wrong password, locked, suspended and expired accounts all get the same message. The audit log records the real reason.
- **Brute force:** each route is rate-limited per IP (sign-in: 5/min). After 5 wrong passwords or codes the account locks for 15 minutes.
- **Two-step sign-in (TOTP) is required for all staff** (`PLATFORM_REQUIRE_MFA`, on unless set to `false`). After the password, a new staff member can only reach Security Settings until they add an authenticator app; every other API route answers `403 MFA_SETUP_REQUIRED`. It cannot be switched off while required. The secret is encrypted at rest (AES-256-GCM).
- **Each code works once.** The last accepted time step is stored and a code from the same or an earlier step is refused, so an intercepted code cannot be replayed.
- **Recovery codes:** turning two-step on shows ten single-use codes (`XXXXX-XXXXX`) once, to download or copy. Any of them can replace the 6-digit code at sign-in; each use is audited, and Security Settings shows how many are left and can issue a new set (with a current code). Only SHA-256 hashes are stored.
- **Lost phone:** an administrator who may manage the account uses **Reset two-step sign-in** on the person's Helpers page (reason required, audited). That removes the old setup and recovery codes and signs them out; they set it up again at the next sign-in. Confirm who you are talking to before resetting.
- **Sessions:** 10-minute access tokens, rotating refresh tokens, a 30-minute idle timeout and a 12-hour maximum (all configurable). The account, session and permissions are re-read from the database **on every request**, so suspension, revocation, role changes and end dates apply immediately.
- **Confirm it's you (step-up):** 27 sensitive actions (staff and roles, user and group suspension, unlocks, reset codes, platform settings, plans, prices, promotions, refunds, manual payment confirmation, providers, regions, exchange rates, costs) need the password, plus the authenticator code once two-step is on, within the last `PLATFORM_REAUTH_MINUTES` (default 10). Otherwise the API answers `403 REAUTH_REQUIRED`, the portal asks for them, and the action is retried once. Failed attempts count towards the lockout; each confirmation is audited as `platform.reauth`.
- **Security e-mails** go to the staff member when the account locks, a new device signs in, a recovery code is used, the password is reset or changed, two-step is turned on or off or reset, recovery codes are regenerated, or their roles change. They contain no links or codes.
- **Password reset:** a single-use link (SHA-256 stored, 30 minutes) to the account's e-mail. The answer is the same whether or not the e-mail exists. A reset signs out every session.

## Bootstrap the owner

There is no sign-up route and no default account. Create the first owner once, from a machine with database access:

```bash
cd backend
PLATFORM_BOOTSTRAP_EMAIL=owner@yourcompany.com PLATFORM_BOOTSTRAP_NAME="Jane Owner" \
  npm run platform:bootstrap -- --confirm
```

- It needs both variables and `--confirm`. It creates an **invited** owner with no password, and a single-use setup link (24 hours). The owner opens `/platform/accept-invite?token=…` and chooses their own password.
- With `EMAIL_WEBHOOK_URL` set, the link is e-mailed. Otherwise it is printed **once to that terminal** (never to the application log). Pass it to the owner over a secure channel.
- Running it again before the owner has set up (same e-mail) replaces the link. **Once an owner has set up, the command refuses**, and the refusal is audited. More owners are invited from the portal by an existing owner.
- Remove the `PLATFORM_BOOTSTRAP_*` variables afterwards.

**Local development: admins straight into the database.** `npm run platform:dev-admin -- --confirm` (in `backend`) creates an active staff account with a password you supply. It refuses to run with `NODE_ENV=production`, applies the same password rules, stores only the scrypt hash and writes an audit entry. Two-step setup is still required at first sign-in.

```powershell
$env:DEV_ADMIN_EMAIL="you@example.com"; $env:DEV_ADMIN_NAME="Your Name"
$env:DEV_ADMIN_PASSWORD="<12+ characters, a letter and a number>"; $env:DEV_ADMIN_ROLE="OWNER"   # or PLATFORM_ADMIN, SUPPORT_HELPER, ANALYST, FINANCE
npm run platform:dev-admin -- --confirm                    # add --reset-password to change an existing account's password
Remove-Item Env:DEV_ADMIN_PASSWORD
```

Also for local development only, `npm run db:seed` with `SEED_PLATFORM_PASSWORD=<your choice, 12+ characters>` also creates demo staff (`owner@`, `admin@`, `helper@`, `analyst@`, `finance@staff.chamahub.test`). The seed refuses to run in production and never uses a built-in password.

## Roles and permissions

Roles live in the database (`platform_roles`, `platform_role_permissions`); each account has roles plus optional individual permissions. Built-in roles are created at API start-up if missing; afterwards the owner can adjust them (except Owner) and add custom roles.

| Role | Default permissions |
| --- | --- |
| Owner | Everything. At least one active owner must always exist. |
| Platform administrator | Dashboard, users and account recovery, groups and group suspension, support inbox (assign, prioritise), group-access requests, helpers, billing view and promotions, security events. **Not:** administrators, roles, settings, prices, refunds, revenue, finance records, audit log. |
| Support helper | Their assigned cases (reply, internal notes, ask for details, escalate, resolve) and requesting group access for those cases. **Not:** stats, users list, groups list, billing, revenue, prices, staff, settings, audit, or any group's money. |
| Operations analyst | Dashboard figures only. |
| Finance | Dashboard, billing, refunds, manual payment confirmation, revenue, costs and exchange rates. |

Rules enforced by the API (not the UI):

1. Nobody grants a permission they do not hold (directly or through a role).
2. Granting administrative or financial permissions (`manage_admins`, `manage_helpers`, `manage_roles`, `configure`, `manage_plans`, `refund`, `manage_finance`, `view_revenue`), or changing an account that holds them, needs `platform.manage_admins`.
3. Only an owner can make, change, suspend or remove an owner.
4. Nobody changes their own access, status or sessions through staff management.
5. The last active owner cannot be suspended, deactivated, demoted or given an end date.
6. A role cannot be edited by someone who lacks any permission it grants; the Owner role cannot be edited; built-in roles cannot be deleted.
7. Roles and permissions sent by the browser are ignored: every check uses the database.

Every denied check is written to the audit log (`platform.permission_denied`).

## Inviting helpers

Helpers › Add helper: name, e-mail, role(s), optional team and an end date for temporary staff. The API creates an **invited** account and a single-use invitation (32 random bytes; only its SHA-256 is stored; 72 hours by default) and e-mails the link. The helper chooses their own password; nobody else ever sees or sets it.

**If e-mail is not configured or fails**, the account is still created and the API returns the link **once**, in that response, to the person who created it. It is not stored in a readable form and never logged. The portal shows it with a warning to pass it on securely. “Resend invitation” revokes the old link and issues a new one. Configure `EMAIL_WEBHOOK_URL` (a relay that accepts `POST {to, subject, text}`) to send invitations and resets by e-mail.

Other actions: edit details, change roles and permissions (reason required), suspend (signs out immediately), reactivate, deactivate permanently, sign out everywhere, send a password-reset link, and view activity. Each needs a confirmation and a reason, which go to the audit log.

## Support

- Members open cases from **Profile › Help** (web) or **Settings › Help** (mobile): topic, optional Chama (only one they belong to), subject and description. Each gets a number (`CH-000123`). Security reports start at high priority. Members see the conversation and the resolution, and can reply (which reopens a resolved case) or close it. Members never see internal notes, assignment history or staff names.
- The **Support Inbox** (support managers) shows every case with filters; managers assign to staff who hold the support permission and set priority. **My Assigned Cases** shows a helper's own queue. A helper cannot open another helper's case: it returns 404.
- On a case, staff reply (the member is notified), ask for more information (status *Waiting for user*), add internal notes, escalate with a reason, and resolve with a required summary. Messages, notes and assignment history are append-only in the database.
- Cases about contributions, payouts or loans show a reminder: **support never changes financial records.** Corrections are made by the group's own officers in the app, with their approvals and audit trail.
- The case shows only what is needed: the requester's name, masked phone, masked e-mail, account status and number of groups, plus the group's name, country, member count, plan and status. No balances or contributions.

### Exceptional access to a group's records

From a case about a group, a helper can **request read-only access** with a purpose and duration (capped by Feature Settings › longest support access). Helpers without `support_manage` can only request access for an open case about that group that is assigned to them. The group's chairperson approves or refuses it under Settings › Support access and can end it early. While approved, the staff member sees members, the latest 100 payments and 50 loans on a dedicated read-only page (no phone numbers). Each view is recorded in the platform audit log and the group's own audit trail. There is no way to change anything through it.

## Dashboard figures

All from live queries; nothing is estimated.

- Users, groups (not archived), new registrations in the range, active groups (recorded money in the last 30 days), paying groups (a paid plan with a paid period, excluding trials and promotions), groups on trial, free groups.
- Open cases; critical incidents (open urgent or security cases); staff with assigned cases; median first response and median resolution time for cases opened in the range.
- Charts: registrations (users and groups), groups by plan, active vs inactive, cases by status, cases opened vs resolved per week. Each chart has a table view.
- **Revenue** (only with `view_revenue`): verified **live** payments by month and currency, refunds shown separately, and pending checkouts reported but not counted. Test-mode payments are never included, and currencies are never added together.

## Audit log

`platform_audit_log` is append-only: a database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`. Each row stores actor (or the e-mail tried), action, target, outcome (`SUCCESS`/`FAILURE`/`DENIED`), reason, request id, IP, user agent and before/after values. Keys that look like secrets (password, token, secret, OTP, PIN, code, API key, cookie, credential) are replaced with `[redacted]` before writing.

It records:

- sign-ins (success and failure), sign-outs and lockouts;
- invitations, acceptances and e-mail failures;
- staff creation, edits, access changes, suspension, reactivation, deactivation and session revocation;
- password resets and changes, and MFA on/off;
- role changes;
- user suspension and recovery actions;
- group suspension and interventions;
- support case views and actions;
- access requests and use;
- billing actions (refunds, promotions, reconciliation, manual confirmation);
- plan, price, region and settings changes;
- every permission denial.

Reading the audit log is itself recorded. Staff actions that affect a group are also written to that group's own audit trail as "ChamaHub staff".

## API (all under `/v1`)

| Area | Endpoints |
| --- | --- |
| Auth | `POST platform/auth/login`, `login/mfa` (6-digit code or recovery code), `refresh`, `logout`, `forgot-password`, `reset-password`, `accept-invitation`, `change-password`, `mfa/setup`, `mfa/enable` (returns recovery codes once), `mfa/recovery-codes`, `mfa/disable`; `GET platform/auth/me`, `invitation?token=`, `sessions`; `DELETE platform/auth/sessions/:id` |
| Staff | `GET/POST platform/staff`; `GET/PATCH platform/staff/:id`; `PUT platform/staff/:id/access`; `POST platform/staff/:id/{suspend,reactivate,deactivate,revoke-sessions,resend-invite,password-reset,reset-mfa}`; `GET platform/staff/:id/activity` |
| Roles | `GET/PUT platform/roles`; `DELETE platform/roles/:code` |
| Support (staff) | `GET platform/support/cases`, `cases/:id`, `assignees`; `POST cases/:id/{reply,notes,status,escalate,assign,priority}` |
| Support (members) | `GET/POST me/support-cases`; `GET me/support-cases/:id`; `POST me/support-cases/:id/{messages,close}` |
| Operations | `GET platform/dashboard`, `search`, `notifications`, `users`, `users/:id`, `groups`, `groups/:id`; `POST platform/users/:id/{status,send-reset-code,unlock}`, `platform/groups/:id/{suspend,reactivate,interventions}` |
| Group access | `POST/GET platform/support-access`; `GET platform/support-access/:id/records` |
| Security & settings | `GET platform/audit`, `security-events`, `jobs`, `integrations`; `GET/PATCH platform/settings` |
| Business | unchanged billing routes: `platform/billing/*`, `platform/plans`, `platform/plan-prices`, `platform/regions`, `platform/revenue`, `platform/finance/*` |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PLATFORM_JWT_SECRET` | derived from `JWT_ACCESS_SECRET` | Signs staff tokens and encrypts TOTP secrets. Set your own 32+ character value in production. Changing it signs every staff member out and **disables existing two-step setups** (they must set up again). |
| `PLATFORM_ACCESS_TOKEN_TTL_SECONDS` | 600 | Staff access-token lifetime. |
| `PLATFORM_SESSION_IDLE_MINUTES` | 30 | Idle timeout. |
| `PLATFORM_SESSION_MAX_HOURS` | 12 | Absolute session length. |
| `PLATFORM_INVITE_TTL_HOURS` | 72 | Invitation link lifetime. |
| `PLATFORM_RESET_TTL_MINUTES` | 30 | Reset link lifetime. |
| `PLATFORM_PORTAL_URL` | `http://localhost:3000` | Public web origin used in links. |
| `PLATFORM_REQUIRE_MFA` | `true` | Staff must set up two-step sign-in. Set `false` only for local experiments. |
| `PLATFORM_REAUTH_MINUTES` | 10 | How long a step-up confirmation lasts for sensitive actions. Keep it at 15 or less. |
| `EMAIL_WEBHOOK_URL` | — | E-mail relay for invitations and resets. |
| `PLATFORM_BOOTSTRAP_EMAIL`, `PLATFORM_BOOTSTRAP_NAME` | — | One-time owner bootstrap only. |

## Migration notes

Migration `20261028000000_platform_portal`:

- removes `users.platformRole`. **Staff who used member accounts with a platform role lose that access**: bootstrap an owner and invite them as staff.
- moves the old free-text `support_tickets` into numbered `support_cases`, with the original text as the first message;
- revokes support-access grants that were pending or active;
- adds `SUSPENDED` to group statuses and `SUPPORT` to notification types.

## Not done yet

- Rate limits are per API instance (in-memory). Several API instances need a shared store (for example Redis) for limits to be global.
- No e-mail provider is bundled; set up a relay for `EMAIL_WEBHOOK_URL` and test delivery before inviting staff.
- Passkeys (WebAuthn) are not supported yet; authenticator-app codes can still be phished by a convincing fake login page.
- No IP allow-listing for the portal; consider putting `/platform` behind your VPN or edge access rules.
