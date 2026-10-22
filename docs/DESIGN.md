# ChamaHub design system

*Every Chama. Every Contribution. Every Payout. One Place.*

ChamaHub holds people's money records, so the interface favours clarity and trust over decoration: plenty of white and warm background, deep plum text, rose used sparingly for emphasis, and status that never depends on colour alone.

## Tokens

The same values are in `mobile/src/theme/index.ts` (React Native) and `web/tailwind.config.ts` (Tailwind).

| Token | Value | Use |
| --- | --- | --- |
| Rose (primary accent) | `#E84D8A` | Selected navigation and tabs, active indicators, progress bars, focus rings, brand dot, highlights |
| Berry | `#B83270` | Filled primary buttons, links and selected-chip text |
| Deep plum | `#42213D` | Text and headings, the web sidebar, the brand tile and the member's headline card |
| Soft blush | `#FCE7F0` | Selected chips, icon tiles, avatars, progress tracks |
| Warm background | `#FFFAFC` | App and page background |
| White | `#FFFFFF` | Cards, tables, inputs |
| Secondary text | `#806B7B` | Labels and supporting text |
| Border | `#F0DCE6` | Card and input borders, dividers |
| Success | `#16845B` (text on tint `#0F6B49`, tint `#E7F5EE`) | Confirmed receipts |
| Pending | `#D97706` (text on tint `#92400E`, tint `#FEF3C7`) | Awaiting verification or approval |
| Error / overdue | `#DC3545` (text on tint `#A71D2A`, tint `#FDECEE`) | Overdue obligations, failures, errors |

### Why primary buttons are Berry, not Rose

White text on Rose measures **3.6:1**, below the WCAG AA minimum of 4.5:1 for normal-size text. Berry measures **5.6:1**.

- Filled buttons and links use Berry.
- Rose carries the brand where it does not hold small text: selection, active indicators, progress, focus and highlights.
- Badge text uses a darker shade of each status colour (`successText`, `pendingText`, `errorText`), so it stays readable on its tint.

### Status never by colour alone

`StatusBadge` (mobile and web) always shows an icon and words:

- **Confirmed**: check icon.
- **Awaiting verification**: clock icon. This is what a reported payment shows until it is confirmed.
- **Reported**: document icon.
- **Overdue**: alert icon.
- **Reversed**: undo icon.
- **Disputed**: flag icon.

Screen readers read the label. Selected tabs use a filled icon as well as colour. Selected chips add a check mark.

## Typography: Satoshi

Satoshi (Indian Type Foundry, free for commercial use under the ITF Free Font License) is the primary typeface. It is distributed by Fontshare, which this repository's build environment cannot reach. Font files are therefore not committed; one command fetches the official release and wires it in:

```bash
npm run fonts:satoshi
```

This command writes:

- `mobile/assets/fonts/Satoshi-{Regular,Medium,Bold}.otf`, and the generated `mobile/src/theme/fonts.generated.ts`. Fonts load from the app bundle at start-up, with no network needed.
- `web/public/fonts/Satoshi-Variable.woff2`, and the generated `web/src/app/satoshi.css` (`font-display: swap`).
- The licence text, next to each set of files.

Commit the generated files afterwards. Until then:

- Mobile uses the system font (Roboto on Android, San Francisco on iOS).
- The web dashboard uses Inter, which is already bundled.

On mobile, each weight is a separate Satoshi file because Android ignores `fontWeight` on custom fonts. The `font()` and `withFont()` helpers in the theme pick the file from the weight.

| Mobile style | Size / line height | Weight |
| --- | --- | --- |
| title | 24 / 30 | Bold |
| heading | 17 / 23 | Bold |
| body | 16 / 22 | Regular |
| label | 14 / 19 | Bold |
| small | 13 / 18 | Regular |
| amount | 28 / 34, tabular figures | Bold |

## Components

**Mobile** (`mobile/src/components/ui.tsx`):

| Need | Component |
| --- | --- |
| Buttons | `Button` (primary, secondary, ghost, danger; 48dp minimum height) |
| Financial summary cards | `MoneyCard` (amount plus what it means: *Confirmed*, *Awaiting verification*) and `Stat` / `StatGrid` |
| Status badges | `StatusBadge`, `Badge` |
| Transaction rows | `TransactionRow` (direction icon, amount, status) and `Row` |
| Member avatars | `Avatar` |
| Contribution progress | `Progress` (with a text label and an accessibility value) |
| Forms | `Field` (label, hint, error with an icon), `Chips` |
| Tables | `KV`, and table cards in the assistant |
| Dialogs and confirmation | `askToConfirm` for consequential actions; `ResultView` for success or failure screens |
| Notifications | `Notice` (tones: green, amber, red, blue, rose, neutral) and in-app notification rows |
| Empty, loading and error states | `Empty`, `Loading` (with a label), `ErrorView` (with retry) |

**Web**: `Button`, `Badge` and `StatusBadge` (with icons), `DataTable`, `Dialog` / `Sheet`, `Field` and inputs, `PageHeader`, `Panel`, `StatStrip`, `MoneyCard`, `Avatar`, `EmptyState`, `LoadingRows`, `ErrorState`.

Cards have 12–16px rounded corners and a restrained plum-tinted shadow. Amounts use tabular figures. Currency is always written **KSh** (`formatKes` in the shared package).

## Navigation

**Mobile tabs:**

- **Home** answers: what have I contributed, what do I owe, has my payment been confirmed, when is my payout, what is my loan balance, and what changed.
- **My Chamas**.
- **Finances**: statement, payments awaiting verification, recent payments, loans, PDF.
- **Activity**: updates and what is coming up.
- **Profile**.

Inside a Chama, sections are role-aware:

- **Everyone:** Overview, Contributions, Payout rotation (where the role can view the rotation), Meetings, Activity and audit.
- **Officers, depending on role:** Members, Payout approvals, Loans, Expenses, Reports, Settings, Payment destinations, Statement import, Officer handovers.

**Web sidebar:** Groups, Overview, Members, Contributions, Reconciliation, Payouts, Loans, Expenses, Reports, Audit Logs and Settings. Each section's pages are nested under it. Platform administration is a separate block of `/platform` routes. A section appears only if the user's role can open one of its pages. The API enforces every permission regardless.
