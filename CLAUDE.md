# Budget

A single-file, no-build, client-side personal budget tracker. Deployed as
static files on GitHub Pages — there is no server and no backend; "backend"
concerns in this app mean client-side data integrity, the GitHub Gist sync
pipeline, and localStorage persistence.

## Files

- `index.html` — the app's markup, CSS and all DOM/rendering code, inline.
  All state lives in one `APP` object, persisted to `localStorage` (`bgt_v7`).
  Rendering is whole-section `innerHTML` replacement, not a framework.
- `budget-core.js` — the financial arithmetic, as pure functions over an
  explicit state object. No DOM, no globals, no dependencies. `index.html`
  loads it with a plain `<script src>` and keeps thin wrappers
  (`getSpent(r)`, `computeBudgetTotals()`, …) that pass `APP` in, so call
  sites read exactly as before.
- `tests/budget-core.test.js` — runs with `node --test` from the repo root.
  No install step. CI runs it on every push (`.github/workflows/tests.yml`).
- `sw.js` — service worker. Network-first, and it caches **only** the
  same-origin app shell; api.github.com and the CDN scripts must never be
  written to the cache (the Gist comments are the user's bank alerts).
- `setup.html` — one-time assistant that creates a secret GitHub Gist and
  walks the user through an iPhone Shortcut that forwards ADCB email alerts
  into it as comments.
- `EMAIL-SYNC-SETUP.md` — user-facing setup docs for the above.

## Conventions worth preserving

- No build step, no framework, no bundler, no dependencies. Keep it that way —
  fixes should be plain JS/CSS edits to the existing files, not a rewrite.
  `budget-core.js` is a plain script, not a module system.
- New or changed financial arithmetic belongs in `budget-core.js` with a test
  in `tests/budget-core.test.js`. This repo has shipped the same class of
  savings-calculation regression several times; a test is how it stops.
- The visual system lives in the one `:root` block at the top of `index.html`
  (`--bg`, `--card`, `--well`, `--hair`, `--text-*`, the accents, `--accent`
  for buttons, and the `--lift` elevation ramp) and `setup.html` mirrors it.
  Change the tokens there — never bolt a second `:root` or an override block
  onto the end of the sheet.
- The approved palette is ivory, olive, sage and terracotta. `--accent`
  controls olive actions; `--spent`, `--bills`, `--flexible`, and `--savings`
  identify allocation segments. `--red` means an actual deficit. Keep the
  main balance area open, without a solid coloured hero box. Category icons
  come from the existing sprite through `catAvatar()`.
- Icons are the inline SVG sprite at the top of `<body>`, used as
  `<svg class="ic"><use href="#i-name"/></svg>`. Don't reintroduce emoji as
  UI icons; they render differently on every OS. (The WhatsApp text share
  keeps its emoji on purpose — that is message content.)
- A fully used fixed bill is the expected outcome, not an alarm. Row bars use
  the category colour and turn `--red` only when genuinely over budget.
- Every editable field is at least 16px. iOS Safari zooms the viewport when a
  focused input is smaller, which throws the layout sideways mid-edit. Treat
  16px as the floor when adding one.
- All dynamic content interpolated into `innerHTML` must go through
  `escHtml()` (defined near the top of the script in `index.html`). This is
  the app's only XSS defense and it must stay consistent.
- `computeSpendingPlan()` reserves unpaid fixed bills and the savings goal
  before exposing a flexible allowance. The daily guide includes today, while
  `getCycleDays()` keeps its existing elapsed-day semantics for forecasts.
- Payment schedules live on their budget row as `{day, overrides}`. Overrides
  are keyed by budget cycle, even for a date outside that month. Moving a
  planning date never releases the bill's reservation. Restore validation must
  preserve schedules; closing a month must keep the recurring day.
- Imported card purchases are spending, not a reconciled outstanding balance.
  Never subtract them from bank cash or add reimbursements to an entered bank
  balance. Unknown card debt and net cash remain unknown.
- `getSpent(r)` is the single source of truth for "how much was spent" on a
  budget row (it resolves paid-override / custom-spent-override / raw sum).
  Any new code that needs spent-amount must call it rather than reading
  `r.s` directly.
- `r.s` is **strictly the sum of that row's own transactions** — nothing else
  may be written into it. `r.p` (marked paid) is a **floor**, not an addend:
  `getSpent` returns `max(r.b, r.s)` for a paid row. Code that adds a
  transaction must only add to `r.s`; the old rule (`p = false; s = b + amount`)
  is what recorded 21,874 for a 10,937 rent bill marked paid and then imported.
- Deleting a budget category must never leave its transactions or merchant
  mappings behind. Every total walks `APP.budget`, so orphaned spend simply
  stops being counted anywhere. Reassign both, or delete both, explicitly.
- A transaction's import identity is date + merchant + amount + **which
  occurrence** of that triple it is (`BC.assignImportKeys`). Two identical
  purchases at the same merchant on the same day are two real transactions.
  The first occurrence keeps the bare legacy key so existing `APP.imported`
  entries still match.
- Anything that mutates state during an import must be captured in the
  before-snapshot the apply handler builds, or "Undo Import" silently stops
  being an undo. Snapshot **before** mutating, never after.
- `saveCache()` returns a boolean and surfaces failures. Never swallow a
  storage error: localStorage is the only copy of this data.
- Data arriving from outside — a restored backup, a `#transfer=` payload —
  goes through `BC.validateAppData()` before it becomes `APP`.
- `getSpent(r)` applies to forecasting too. Summing `APP.transactions` to work
  out spend silently drops every paid-override and custom-spent row (rent,
  tuition), which is what made the old savings forecast read ~34k. Derive
  spend from `computeBudgetTotals()`, never from the transaction list alone.
- Savings is always `inflow − everything actually spent`, so unspent budget
  counts as saved. `computeBudgetTotals()` owns that arithmetic (and the
  `committed`/`unusedBudget` split); `confirmAdj()` must stay on the same
  basis when it recomputes a concluded month.
- `savingsTarget()` is the single source of truth for the goal. It derives
  `inflow − budgetTotal()` unless `APP.savingsTargetMode === "custom"`, so
  editing any category budget moves the target by the same amount.
- The forecast horizon is the end of the cycle month, never payday. Inflow,
  budget rows and `savingsTarget()` are all whole-calendar-month figures, so
  projecting spend to the 25th and subtracting it from a month of inflow
  compares two different spans. `getCycleDays()` owns elapsed/remaining days
  and must stay consistent with `getElapsedFraction()`.
- The forecast is full-consumption, not run-rate. `computeForecast()` assumes
  every category reaches 100% of its budget by cycle end and counts an
  over-budget row at what it actually cost, so projected savings is
  `inflow − Σ max(budget, getSpent(row)) − outflows` — i.e. exactly
  `computeBudgetTotals().committed`. Never extrapolate a per-day run-rate
  across the cycle: a lumpy sample says nothing useful, and blowing the
  incidental budget in week one projected a loss when the only money still at
  risk was the budget not yet spent. The weekly pace is displayed as a
  description only; nothing is derived from it.
- Over/under-budget must be accumulated PER ROW, never per group. Netting an
  overspent Chiller against an underspent Electric at the fixed/variable level
  hides the overspend and inflates both the projection and `unusedBudget`
  (it read 17 instead of 4,750 on the month that prompted this).
- Transaction bucketing and manual entry use the LOCAL calendar date, via
  `t.dateStr` (DD/MM/YYYY) or a locally-constructed `Date` — never by re-reading
  the stored `toISOString()` instant with local getters. `dateStrToYmd()` is the
  bridge. `new Date("YYYY-MM-DD")` parses as UTC; build it from parts instead.
- Date/timezone handling has already caused one shipped bug (see git log:
  "Fix date range filter for UTC+4 timezone"). Be deliberate about local vs.
  UTC dates in any new date logic.

## Continuous improvement loop

This repo has `.claude/agents/` subagents and a `/improve-scan` command set
up so Claude can periodically re-analyze the app from several angles
(security, UI/UX & accessibility, financial-logic correctness, performance,
code quality) and append new, deduplicated findings to `IMPROVEMENTS.md`.

To run it once: `/improve-scan`
To run it on a loop in a live session: `/loop 60m /improve-scan` (uses the
built-in `loop` skill; the loop only runs while a session is open).

The scan is suggestion-only by design — this app holds real financial data,
so changes should be reviewed by you before being applied, not auto-applied
by the loop.
