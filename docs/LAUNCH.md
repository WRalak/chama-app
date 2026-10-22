# Pre-launch checklist

ChamaHub checked against the 41-item "Pre-Launch Checklist for Vibe-Coded Sites & Apps".

Key:
- ✅ in place
- 🛠 added in the launch-hardening change
- 👤 **you must do this when deploying**
- ➖ does not apply to ChamaHub

## 1. Security and secrets

| Item | Status | Where / what |
| --- | --- | --- |
| API keys off the frontend | ✅ | M-Pesa, SMS, WhatsApp, e-mail and AI keys live only in `backend/.env`. The web app reaches the API through a same-origin proxy that keeps tokens in httpOnly cookies. The mobile app holds only its own session. |
| `.env` hidden, no hard-coded secrets | ✅ | `.env` and `.env.local` are git-ignored. The API refuses to start with missing or short secrets (`config/env.ts`). |
| Git history checked for secrets | ✅ | Scanned all commits: only a fake test key and placeholder URLs. 👤 **Rotate the Supabase database password and keys that were pasted into chat earlier.** |
| HTTPS everywhere | 🛠 / 👤 | HSTS is sent by the API (helmet) and the web app (production). 👤 Serve both behind HTTPS (your host or a reverse proxy). |
| Security headers, CORS | ✅ / 🛠 | API: helmet (CSP, HSTS, frame and sniffing protection); CORS limited to `CORS_ORIGINS`. Web: CSP, HSTS, `X-Frame-Options: DENY`, nosniff, referrer and permissions policies (`web/next.config.mjs`). Covered by `test/security.e2e-spec.ts`. |
| No debug output in production | ✅ | Errors return a message and request id only, never stack traces or database details (tested). The API refuses to start in production with `DEV_LOG_OTP` or 🛠 `DISABLE_THROTTLE` set. |

## 2. Authentication and access control

| Item | Status | Where / what |
| --- | --- | --- |
| Real login and logout | ✅ | JWT access tokens, rotating refresh tokens with reuse detection, sessions you can revoke per device. |
| Password reset; verify ownership | ✅ | Reset by SMS code. The phone is verified by SMS code before anything else works (instead of e-mail verification). |
| Admin routes protected | ✅ | Platform administration requires a platform role checked by the API. Group pages require membership. Non-members get 404. |
| Permissions checked on the server | ✅ / 🛠 | `GroupAccessGuard` resolves permissions from the caller's membership; the client never supplies user or member ids that are trusted. 🛠 Fixed: chairpersons (import approvers) were refused when opening the imports they must approve. |
| Data isolation (RLS) | ✅ / 🛠 | Every query is scoped to the caller's group. 🛠 Row level security is now on for every table, and the `anon` and `authenticated` roles have no grants, so a Supabase anon key cannot read ChamaHub data. A test fails if a new table skips this. |
| Rate-limit login and sign-up | ✅ | Sign-up 5/min, login 10/min, OTP 3–5/min, AI chat 10/min, everything else 300/min; account lockout after repeated failures. |

## 3. Data and backend safety

| Item | Status | Where / what |
| --- | --- | --- |
| Database locked down | 🛠 / 👤 | See RLS above. 👤 In Supabase, keep the service-role key out of every app; the backend only needs `DATABASE_URL`. |
| Server-side validation | ✅ | Every request body and query is parsed by a strict zod schema (`ZodPipe`). React escapes all rendered text. |
| No SQL injection | ✅ | Prisma parameterised queries; no `queryRawUnsafe` anywhere. |
| Secure file uploads | ✅ | Evidence: allow-listed types, 3 MB limit, file signature checked against the claimed type, SHA-256 stored, kept in the database (not a public folder), downloaded only through permission-checked routes. |
| Daily backups | 👤 | Supabase Pro includes daily backups (enable point-in-time recovery for a finance app). Self-hosting: schedule `pg_dump` daily, keep copies off the server, and test a restore before launch. |
| Error tracking | 🛠 / 👤 | 🛠 Set `ERROR_WEBHOOK_URL` (Slack, Teams or an alerting service) to get a report for every 5xx. The report has the route, error type and request id only, no request or financial data. Every error is also logged with the same request id. |

## 4. SEO and discoverability

The signed-in app is private. Only sign-in, sign-up and the legal pages are indexable.

| Item | Status | Where / what |
| --- | --- | --- |
| Meta title and description | 🛠 | Site-wide title template and description; each legal and auth page has its own. |
| robots.txt and sitemap.xml | 🛠 | `web/src/app/robots.ts` and `sitemap.ts`. 👤 Set `NEXT_PUBLIC_SITE_URL`. |
| Open Graph share image | 🛠 | `web/src/app/opengraph-image.png` (1200×630, brand colours). |
| Alt text | ✅ | The app shows no content images; icons are decorative or labelled. |
| Favicon | 🛠 | `icon.png` and `apple-icon.png` from the app icon. |

## 5. UX, design and performance

| Item | Status | Where / what |
| --- | --- | --- |
| Clear next step / CTA | ✅ | Home shows what is due with a "Pay or report a payment" action; officers see tasks waiting for them. |
| Mobile layout | ✅ / 👤 | Web checked at 390 px wide (tables become cards); native mobile app. 👤 Test on a real low-end Android phone before launch. |
| Loading and empty states | ✅ | Shared loading, empty and error components on web and mobile. |
| Form validation | ✅ | Shared zod schemas give field-level messages on both apps; the server re-validates. |
| Fast loads | ✅ | First-load JavaScript is about 100–210 kB per page, fonts are self-hosted, and there are no large images. |
| Custom 404 | 🛠 | `web/src/app/not-found.tsx`, `mobile/app/+not-found.tsx`. |
| Onboarding | ✅ | Mobile welcome screens; on the web, sign-up → verify phone → join with a code, accept an invitation or create a Chama. |

## 6. Forms and communication

| Item | Status | Where / what |
| --- | --- | --- |
| Forms deliver | ✅ | Support requests become tickets in Platform › Support; notifications go in-app plus SMS, WhatsApp or e-mail where configured. |
| Spam protection | ✅ | Sign-up requires SMS verification, plus rate limits. There are no anonymous public forms. |
| Thank-you / confirmation | ✅ | Every action confirms with a message and an updated status. |
| Broken links | ✅ | Crawled 87 pages as an officer on the production build: no broken links, no CSP violations. |

## 7. Legal, trust and analytics

| Item | Status | Where / what |
| --- | --- | --- |
| Privacy policy | 🛠 / 👤 | `/privacy` on the web and in the app (one shared text, `packages/shared/src/legal.ts`), written for the Kenya Data Protection Act, 2019. 👤 **Have a Kenyan advocate review it**, set `NEXT_PUBLIC_LEGAL_*` and `EXPO_PUBLIC_LEGAL_*`, and register with the ODPC as a data controller/processor. |
| Terms of use | 🛠 / 👤 | `/terms`, same as above. Sign-up shows "By creating an account you agree to…". |
| Cookie consent | ➖ | Only strictly necessary sign-in cookies; no analytics or advertising cookies. Explained in the privacy policy. |
| Real contact address | 👤 | Shown in both documents from `NEXT_PUBLIC_LEGAL_ADDRESS` and `NEXT_PUBLIC_CONTACT_EMAIL`; they say "draft" until set. |
| Delete account | ✅ | Profile › Privacy on web and mobile. Financial records are anonymised, not deleted, so group books still balance. |
| Analytics | ✅ / ➖ | Platform overview shows usage (groups, members, activity) from ChamaHub's own data. No third-party tracker by design: this is financial data. |
| Security review | 🛠 | Done for this checklist: the RLS, imports-permission and throttle fixes came out of it. Repeat before each major release. |

## Deployment settings to fill in

```
# backend/.env
NODE_ENV=production
CORS_ORIGINS=https://app.example.co.ke
ERROR_WEBHOOK_URL=https://hooks.slack.com/...      # optional
# never set DEV_LOG_OTP or DISABLE_THROTTLE in production

# web/.env
API_URL=https://api.example.co.ke
NEXT_PUBLIC_SITE_URL=https://app.example.co.ke
NEXT_PUBLIC_LEGAL_NAME=...
NEXT_PUBLIC_LEGAL_ADDRESS=...
NEXT_PUBLIC_CONTACT_EMAIL=...
NEXT_PUBLIC_ODPC_REGISTRATION=...

# mobile/.env
EXPO_PUBLIC_API_URL=https://api.example.co.ke
EXPO_PUBLIC_LEGAL_NAME=...   (same values as the web)
```
