# Budget

A single-file, no-build, client-side personal budget tracker. Deployed as
static files on GitHub Pages — there is no server and no backend; "backend"
concerns in this app mean client-side data integrity, the GitHub Gist sync
pipeline, and localStorage persistence.

## Files

- `index.html` — the entire app (HTML + CSS + JS inline, ~2900 lines). All
  state lives in one `APP` object, persisted to `localStorage` (`bgt_v7`).
  Rendering is whole-section `innerHTML` replacement, not a framework.
- `setup.html` — one-time assistant that creates a secret GitHub Gist and
  walks the user through an iPhone Shortcut that forwards ADCB email alerts
  into it as comments.
- `EMAIL-SYNC-SETUP.md` — user-facing setup docs for the above.

## Conventions worth preserving

- No build step, no framework, no bundler. Keep it that way — fixes should
  be plain JS/CSS edits to the existing files, not a rewrite.
- All dynamic content interpolated into `innerHTML` must go through
  `escHtml()` (defined near the top of the script in `index.html`). This is
  the app's only XSS defense and it must stay consistent.
- `getSpent(r)` is the single source of truth for "how much was spent" on a
  budget row (it resolves paid-override / custom-spent-override / raw sum).
  Any new code that needs spent-amount must call it rather than reading
  `r.s` directly.
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
