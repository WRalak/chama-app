# ChamaHub AI assistant

The assistant answers questions about a group's records, drafts summaries and WhatsApp messages, and explains payout readiness and loan rules. It does this only by calling a fixed set of read-only backend tools, as the signed-in member, in that member's current group. Every amount comes from ChamaHub's financial engine. The model explains and drafts; it never calculates the figures, and it cannot change any record.

## What the AI was built on

These existing pieces were in place when the assistant was added (see `ARCHITECTURE.md`):

| Area | What exists |
| --- | --- |
| Apps | Expo mobile app (`mobile/`), Next.js admin (`web/`, behind a same-origin proxy that holds the session tokens), NestJS API (`backend/`), shared types and finance engine (`packages/shared`). |
| Money | Integer-cent double-entry ledger; append-only journal, audit, payment history and evidence enforced by database triggers; maker-checker on every money movement. |
| Authorization | JWT sessions. `GroupAccessGuard` resolves the caller's permissions for the `:groupId` in the URL from their role, optional roles and the group's role policy. Non-members get 404. |
| Payments | Manual and self-reported payments; M-Pesa STK and C2B (configured by environment); statement import with a deterministic matching engine and review queue. |
| Notifications | In-app, SMS, WhatsApp Business (text), e-mail webhook, Expo push. |
| AI before this work | None: no AI dependencies, keys or configuration. |

## Architecture

```
mobile / web ──► POST /v1/groups/:groupId/ai/chat ──► AiService
                       │ (GroupAccessGuard: member of this group, permissions resolved)
                       ▼
                 AiProvider (Anthropic Claude, via @anthropic-ai/sdk)  ◄── provider abstraction
                       │ tool_use
                       ▼
                 Tool registry (allowlist, zod validation, permission check)
                       │ runs as the authenticated membership, group from the URL
                       ▼
                 Existing services: MemberFinance, Contributions, Loans, Rotations,
                 Statements, Summaries … (they re-check their own rules)
```

- **Provider abstraction**
  - Code: `backend/src/modules/ai/provider.ts`. `AiProvider.complete()` is the only call the assistant makes.
  - `AnthropicProvider` uses the official SDK:
    - Adaptive thinking, with configurable effort.
    - Server-side refusal fallback (`fallbacks: "default"`).
    - Configurable timeout and retries.
    - SDK errors are mapped to typed failures: `timeout`, `rate_limited`, `unavailable`, `rejected` and `misconfigured`.
  - Tests swap in a scripted provider through `AiProviderHolder`.
- **Tool registry**
  - Code: `backend/src/modules/ai/tools/`. Each tool has a name, description, JSON schema for the model, a strict zod schema for the server, the permissions that allow it (any of), and a `run` function.
  - `runTool` rejects:
    - unknown names (`UNKNOWN_TOOL`);
    - callers without permission (`DENIED`);
    - invalid input, including any extra field such as a `groupId` or `memberId` the model invents (`INVALID`).
  - The group and the user always come from the authenticated request; no tool accepts them as input.
- **Chat loop** (`ai.service.ts`)
  - A manual loop with at most `AI_MAX_TOOL_ROUNDS` rounds.
  - Assistant turns are stored and replayed unchanged, so conversation history stays valid.
  - The model only sees tools the caller may use. A tool called anyway is refused by the server.
  - Tool results reach the model marked as data, with an instruction never to follow instructions found inside them.
- **Cards**
  - Every tool returns `AiCard`s: facts, tables, notes, links and the read time and period.
  - The apps show them as *From records* (verified) or *Draft — review* (WhatsApp texts), separately from the AI's own words, which are labelled *AI answer*.

## Tools

| Tool | Who | Reads |
| --- | --- | --- |
| `get_my_financial_summary` | every member | Own confirmed contributions, amount owed, pending verification, loan balance, fines, next contribution, payout turn |
| `get_my_contributions` | every member | Own contribution periods and recent payments with status |
| `get_my_loans`, `get_loan_statement` | every member (own loans); loan officers (any loan) | Balances, schedule, repayments; interest method explained |
| `get_group_rules` | every member | Schedules, grace days, fines, approvals, payout shortfall policy, loan policy and how interest is calculated |
| `get_group_collection_summary` | `contributions.view_all` | Due so far, confirmed, rate, owed, pending verification, members up to date |
| `get_outstanding_contributions` | `contributions.view_all` | Who owes, how much, oldest unpaid period |
| `get_payment_reconciliation_queue` | verify or reconciliation | Pending verifications, unmatched M-Pesa, statement lines, duplicate references, disputes |
| `get_rotation_schedule`, `get_payout_readiness` | `rotations.view` | Schedule; the payout engine's readiness checks (details only for officers and the recipient) |
| `get_group_financial_report` | `reports.view` | Ledger statement for a period, with the balance check |
| `get_approved_meeting_minutes` | `meetings.view` | Approved minutes only, with resolutions and action items |
| `draft_whatsapp_report` | per kind (collections needs `contributions.view_all`) | Collections, how to pay, receipt, payout notice: from confirmed records |

No tool writes anything. Recording, verifying, approving, sending and reversing stay in the existing screens and their maker-checker rules.

**Quick answers.** `POST /groups/:id/ai/tools/:tool` runs one tool directly, without the model. Suggested questions use it when the AI is off, unavailable or over its limit. Long-press a suggestion on mobile, or click *records* on the web, to use it at any time.

## Safeguards

- **Privacy**
  - The member's message is redacted before it is sent: phone numbers, e-mails and long digit runs (account or ID numbers) are removed, and anything after "PIN", "password" or "OTP".
  - Tool outputs contain no phone or account numbers. Other members' names appear only where the caller's role already shows them.
- **Limits**
  - Per-user daily questions (`AI_DAILY_REQUESTS_PER_USER`).
  - A per-group monthly budget in USD (`AI_MONTHLY_BUDGET_USD_PER_GROUP`), computed from recorded token usage.
  - An HTTP throttle of 10 chats a minute.
  - Quick answers are not limited.
- **Records**
  - `ai_usage` (tokens, cost, latency, status, error) and `ai_tool_calls` (tool, input, outcome) are append-only and separate from the financial tables.
  - A refused tool call is also written to the group audit log.
- **Retention**
  - Conversations and messages are deleted after `AI_RETENTION_DAYS` (daily job `ai-retention`). Members can delete theirs at any time.
  - Usage and tool-call records hold no message text and are kept.
- **Failure**
  - If the provider times out or fails, the request is recorded and the member sees a clear message offering quick answers. The conversation is not changed.
  - Nothing else in ChamaHub depends on the AI.
- **Support access** (platform staff with a time-boxed grant) cannot use the chat.

## Configuration (`backend/.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_PROVIDER` | `anthropic` | `disabled` turns chat off everywhere |
| `ANTHROPIC_API_KEY` | — | Server-side only. Without it, chat is off and quick answers still work |
| `AI_MODEL` | `claude-opus-5-5` | Any Claude model id. `claude-sonnet-5-5` or `claude-haiku-5-5` cost less |
| `AI_EFFORT` | `medium` | `low`…`max`; `low` is usually enough for chat |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES` | 60000, 2 | Per provider call |
| `AI_MAX_TOOL_ROUNDS` | 6 | Tool rounds per question |
| `AI_DAILY_REQUESTS_PER_USER` | 40 | |
| `AI_MONTHLY_BUDGET_USD_PER_GROUP` | 10 | |
| `AI_RETENTION_DAYS` | 30 | Conversation retention |

The key never reaches the mobile or web apps; both call the API, which calls the provider.

## Languages

Answers can be requested in English (`locale: "en"`, the default) or Kiswahili (`"sw"`). The tools return the same figures and dates in both cases. The apps' own text is English for now.

## Tests

- `backend/test/ai.e2e-spec.ts` covers:
  - role suggestions and tool lists;
  - quick answers and their permissions;
  - invalid arguments and injected ids;
  - cross-group isolation;
  - conversation ownership;
  - refusal of other members' data;
  - prompt injection in approved minutes and unknown tools;
  - an untouched ledger;
  - redaction;
  - provider timeout and failure;
  - the tool-round limit;
  - daily and budget limits;
  - usage visibility;
  - retention.
- `backend/test/ai-provider.e2e-spec.ts` runs the real SDK-backed provider against a local stub of the Messages API. It checks the request shape (adaptive thinking, effort, fallbacks, no sampling parameters), error mapping, timeouts and pricing.

## Phases

| Phase | Status |
| --- | --- |
| 1. Service, provider abstraction, auth integration, tool registry, assistant UI (mobile and web) | **Done** |
| 2. Financial Q&A through authorised deterministic tools | **Done** (tools above) |
| 3. Report drafting and WhatsApp summaries | **Partly done.** WhatsApp drafts and the period financial summary exist. Still to do: daily and weekly collection reports, reconciliation exception reports and treasurer handover summaries as reviewable drafts. |
| 4. Statement extraction and AI-assisted matching | Not started. The deterministic CSV/XLSX import and matching engine exist. Next: PDF and screenshot extraction into *unverified* lines, and AI explanations for ambiguous lines, still decided by a person. |
| 5. Anomaly flagging | Not started. Planned to start with deterministic rules: duplicate references and imports, repeated reversals, destination changes, mismatched payouts, conflicting evidence. Every flag is a review signal with its evidence and outcome recorded, never an automatic action. |
| 6. Meeting/document assistance, Kiswahili UI, usage analytics across groups | Partly done: approved-minutes summaries, Kiswahili answers, per-group usage. Still to do: agenda and announcement drafts (approved by a person before use), Kiswahili app text, a platform-wide usage view. |
