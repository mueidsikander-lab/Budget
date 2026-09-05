# Improvements Backlog

Generated and maintained by the `/improve-scan` command and the
`.claude/agents/*` subagents (security-auditor, ui-ux-reviewer,
financial-logic-reviewer, performance-reviewer, code-quality-reviewer).
This file is suggestion-only — nothing here is auto-applied. Review an
item, fix it by hand (or ask Claude to), then move it to **Resolved**.

To regenerate/update this file, run `/improve-scan` (or `/loop 60m
/improve-scan` to repeat it automatically for the rest of the session).

---

## 2026-06-21 — Initial scan (still open)

### Security

- **[Low]** No SRI on the lazy-loaded CDN scripts: `html2canvas@1.4.1`
  (jsdelivr) and `pdf.js@3.11.174` (cdnjs) are now injected on-demand
  (`loadScript()`, see Resolved) rather than unconditionally, which shrinks
  the exposure window, but neither `<script>` has an `integrity`/`crossorigin`
  attribute. *Fix:* add SRI hashes once a network path to the CDN is
  available to compute them, or self-host both libraries. *Not fixed this
  pass*: this sandbox has no outbound access to jsdelivr.net/cdnjs.cloudflare.com,
  so a hash typed from memory would risk silently breaking PDF import /
  image-sharing if wrong — left open rather than guessed.

### Financial logic correctness

- **[Medium]** Forecast/elapsed-fraction logic (`renderForecast`-adjacent code)
  relies on device-local `new Date()` with no explicit timezone pinning —
  currently correct only because the device's local timezone happens to match
  the intended budget timezone (UTC+4). Given this project already shipped one
  UTC+4-related date bug, this is worth hardening proactively even though not
  currently broken.

### Performance & code quality

- **[Medium]** `bindBudgetEvents` (~225 lines) wires four event types and
  inline-implements business logic for reimbursements, outflows,
  paid-toggling, and txn CRUD in one function. *Fix:* split by concern into
  smaller functions (no architecture change needed).
- **[Low]** Naming drift (`fixB/fixS/varB/varS` vs. full-word vs.
  single-letter scoped reuse, e.g. `t` meaning different things in nearby
  functions) — only worth fixing opportunistically when touching nearby code.

---

## Resolved — 2026-09-05 (visual system + date handling)

A second pass, merging the parts of an independent review patch that were
better than what shipped in the data-integrity pass below. Its visual system
was adopted; its paid-placeholder rule (replace rather than floor), its
projected-vs-actual savings-target row, and its removal of the
`alertSync.processed` size cap were not — see the analysis in the session log.

### UI/UX

- Adopted a calmer, higher-contrast visual system: near-black `#06070a` ground
  with two ambient radial gradients, translucent card surfaces on a single
  `--lift` elevation ramp, accents lifted off the iOS palette so they hold up
  on the lighter cards, `clamp()` type scale, 1040px page cap, a two-column
  dashboard grid on wide screens, and a floating nav pill that goes
  edge-to-edge under 700px. `setup.html` matches. Applied by editing the
  existing rules — the source patch appended a second `:root` and an override
  block, leaving two competing palettes in one file.
- Every editable field is now at least 16px, so iOS stops zooming the viewport
  on focus. Done by raising the fields themselves rather than with a blanket
  `!important`, which in the source patch also clobbered deliberate sizes.
- `prefers-reduced-motion` honoured; 48px nav targets; 3px focus rings.
- The upload drop zone is a real `<label>`, removing the JS click handler that
  opened the file picker twice.

### Financial logic correctness

- **[Medium]** `renderDailyChart` bucketed by re-parsing the stored UTC
  `toISOString()` with local `ymd()`, so a late-evening charge in UTC+4 landed
  on the wrong day. It now buckets from `t.dateStr` via `dateStrToYmd()`.
- **[Medium]** `addManualTxn` parsed its date input with `new Date("YYYY-MM-DD")`
  — UTC midnight — then read it back with local getters. Now built from parts,
  matching `processStatement()`.
- **[Low]** Auto-learned merchant mapping keys are now derived through
  `normalizeDescKey()`, so email-sync and CSV descriptions produce the same key.
- **[Low]** `removeTxn` released a shared import key while another transaction
  still held it, letting that sibling be re-imported as new.

### Data integrity

- **[Medium]** Learned merchant mappings were written to `APP.mappings` the
  moment a category was picked in the import preview — they survived Cancel and
  could not be undone. They are now applied with the import and captured in its
  before-snapshot, so Undo Import removes them.
- **[Low]** `exportData` revoked the object URL synchronously, which races the
  download in some browsers.
- **[Low]** `index.html` now fails loudly with a Reload prompt if
  `budget-core.js` does not load, instead of throwing on first use and looking
  like data loss.

### Security

- **[Low]** `setup.html` interpolated gist IDs and GitHub error messages into
  `innerHTML` unescaped.

---

## Resolved — 2026-09-05 (data-integrity pass)

Acting on the app review that flagged data integrity, recovery and imports as
the reasons not to trust this as the sole record of several years of finances.

### Financial logic correctness

- **[Critical]** Paid placeholders double-counted every later matching
  transaction. Marking rent (10,937) paid and then importing the actual
  10,937 payment recorded 21,874, because all three write paths
  (`addManualTxn`, `recategorizeTxn`, the statement-apply handler) cleared
  `p` and set `s = budget + amount`. `p` is now a **floor**, not an addend:
  `getSpent(r)` returns `max(budget, transaction sum)` for a paid row, so the
  recorded payment replaces the placeholder, a larger real bill shows through
  as overspend, and an unrelated small charge cannot deflate the row. `s` is
  now strictly the sum of the row's own transactions; `fixApp()` re-derives it
  for paid rows (display-neutral), the seed Tuition row no longer ships
  `s = budget`, and Settings offers a reviewable **Repair Double-Counted
  Spend** action for data already written by the old rule.
- **[Critical]** Deleting a custom category hid its spending. Transactions and
  merchant mappings survived the deletion, but every total walks `APP.budget`,
  so the money vanished from the app entirely. Deletion now goes through a
  modal that reassigns transactions *and* mappings to a category you pick (or
  discards them explicitly), carrying the spend over so totals are unchanged
  by the reorganisation. `fixApp()` also recovers transactions already
  orphaned by an earlier deletion into a visible zero-budget
  "Unfiled (recovered)" row rather than leaving them uncounted, and drops
  mappings pointing at categories that no longer exist.
- **[High]** Duplicate detection rejected legitimate transactions. Identity was
  date + merchant + amount, so two identical purchases at the same merchant on
  the same day collapsed into one — and `parseAlertMessages()` squashed
  identical pasted alerts before they ever reached the preview. Identity is now
  occurrence-aware (`BC.assignImportKeys`): the first occurrence keeps the bare
  legacy key so existing `APP.imported` entries still match, later occurrences
  get a `#n` suffix and a `#2` badge in the preview. Re-importing the same
  statement still flags every row as a duplicate.

### Data integrity & recovery

- **[High]** "Undo Import" was not an undo. It captured spent-overrides *after*
  clearing them (so `prevCs` was always null), and never restored paid flags,
  statement coverage dates, the debit balance, `alertSync.processed` or the
  previous import's metadata. Imports are now transactional: a complete
  before-state is snapshotted *before* any mutation and restored wholesale,
  only the keys that import actually added are removed, and one level of
  chaining lets you step back import by import.
- **[High]** Export was presented as a backup with no way back in. Added
  **Restore from Backup** (file picker → validate → confirm → replace), an
  export-freshness line on the Export row that turns amber past 30 days, and a
  weekly-at-most nudge on launch when the last backup is stale.
- **[High]** `saveCache()` swallowed every storage failure, so a full or blocked
  localStorage looked exactly like a successful save. Failures now raise a
  persistent banner and a toast, distinguish "full" from "blocked (private
  mode)", and clear themselves on the next successful write.

### Security

- **[Medium]** The service worker cached the response to *every* GET, including
  Gist comment bodies (the user's bank alerts), and the cache-busting
  `?t=<timestamp>` on each sync created a new entry every time it ran. Caching
  is now restricted to the same-origin app shell; everything else goes straight
  to the network and is never stored. Cache name bumped to `budget-shell-v2` so
  the old contents are dropped on activate.
- **[Medium]** Remaining unescaped interpolations closed: the history trend-bar
  month label, and the category names in both the import preview summary and
  the post-import "Done" summary (a custom category name is user-controlled and
  reaches these paths unescaped). `escHtml()` also escapes `'` now.
- **[Medium]** `#transfer=` payloads and restored backups are validated and
  coerced by `BC.validateAppData()` before becoming `APP` — typed fields,
  dropped unknown keys, a hex-shaped gist id, and a hard reject for anything
  that isn't a budget file.

### UI/UX & Accessibility

- **[Medium]** Settings rows are `<div onclick>`; they are now promoted at
  runtime to `role="button"` with `tabindex="0"`, an `aria-label` and
  Enter/Space activation.
- **[Medium]** Modals moved focus in but did not hold it — Tab walked out into
  the page behind the overlay. Added a focus trap.
- **[Medium]** `--text-3` was `rgba(235,235,245,0.3)` on black (~2.4:1, well
  under WCAG AA) and `--text-2` sat on the line; both raised.
- **[Medium]** `.page` had no max width, so on desktop the single column
  stretched across the whole viewport. Capped at 720px and centred.
- **[Low]** A paid row now explains the floor rule inline, so "paid ✓" plus a
  list of real transactions reads as one figure.

### Testing & CI

- **[Medium]** There were no automated tests and no CI, against a history of
  repeated savings-calculation regressions. Extracted the financial arithmetic
  into `budget-core.js` — plain functions over an explicit state object, no
  DOM, no globals, loaded by a bare `<script src>` (still no build step, no
  bundler, no dependencies) — and added `tests/budget-core.test.js` running on
  `node --test`, plus a GitHub Actions workflow. 24 cases pin the savings
  basis, the auto target, per-row over/under budget, the full-consumption
  forecast and its cycle-end horizon, the paid-placeholder rule, duplicate
  identity, orphan detection, and restore validation. `index.html` keeps thin
  wrappers, so every call site is unchanged.

---

## Resolved — 2026-06-21

### SMS → Email migration (ADCB stopped sending SMS)

Renamed the whole alert-sync pipeline from SMS to email throughout
`index.html`, `setup.html`, and the setup doc (`SMS-SYNC-SETUP.md` →
`EMAIL-SYNC-SETUP.md`): `APP.smsSync` → `APP.alertSync` (with a one-time
migration in `fixApp()` so existing users' connected Gist isn't lost),
`parseSMSMessages`→`parseAlertMessages`, `syncSMSFromGist`→
`syncAlertsFromGist`, etc. The iPhone Shortcut flow now triggers on
**Email received** (with a "Get Details of Emails" → Plain Text Content
step) instead of **Message received**, and `setup.html`/the doc walk the
user through switching ADCB's alert channel from SMS to Email first.

### Security

- **[High]** Stored XSS via unescaped `h.month`/`topCategories[0].c` in
  `drawHistory()`, and unescaped `APP.currentMonth` in the detected-month
  banner, conclude-modal, preview-summary, and both share-card builders — all
  now wrapped in `escHtml()`.
- **[Low]** `setup.html`'s `checkInbox()` rendered gist comment bodies into
  `innerHTML` without escaping — added a local `escHtml()` and applied it.
- **[Low]** No documented rotation/expiry guidance for the gist ID — added to
  `EMAIL-SYNC-SETUP.md`'s Notes section (treat the ID like a password; recreate
  the gist and update Settings if it's ever exposed).
- **[Low]** `prepareHomeScreen()`'s tap-outside-to-dismiss path bypassed
  `closePrepareModal()`'s hash-clearing (it called the generic `closeModal`
  instead), which could leave `#transfer=<base64 APP>` in the URL/history
  after an accidental outside tap. Fixed by routing all dismiss paths (Escape,
  tap-outside) through the same per-modal close function the modal's own
  button uses.

### UI/UX & Accessibility

- **[High]** Icon-only controls now have `aria-label`s: share/conclude
  buttons, `.cb-paid` checkbox (dynamic per category), `txn-del`,
  `map-del` (both instances), `reimb-del`/`outflow-del`.
- **[High]** Added `manifest.json`, a minimal network-first service worker
  (`sw.js`), and hand-generated PNG icons (`icons/icon-192.png`,
  `icons/icon-512.png`, `icons/apple-touch-icon.png`) — the app now installs
  as a real PWA and the core (non-CDN-dependent) UI works offline after first
  load.
- **[High]** Modals (`openModal`/`closeModal`) now set `role="dialog"`/
  `aria-modal="true"`, move focus into the modal box on open, restore focus to
  the previously-focused element on close, and close on Escape (in addition
  to the existing tap-outside-to-dismiss).
- **[Medium]** Removed `maximum-scale=1.0, user-scalable=no` from the viewport
  meta tag, restoring pinch-zoom for low-vision users.
- **[Medium]** `.cbk-amt` no longer clips on large totals — changed from a
  fixed `flex: 0 0 62px` to `flex: 0 1 auto; min-width: 62px` so it can grow.
- **[Medium]** Added `<label>`/`aria-label`s for `#inflow-input`,
  `#debit-balance-input`, `#date-from`/`#date-to` (`#gist-id-input` was
  already labeled).
- **[Low]** SMS/email sync now tracks and surfaces a "N skipped —
  unrecognized format" count instead of silently treating unparseable alerts
  as processed.

### Financial logic correctness

- **[High]** Investigated the reported `openConcludeModal()` vs.
  `confirmConclude()` formula mismatch: verified numerically that both
  formulas are actually mathematically equivalent in current code (`Math.max(varB,
  varS - OUT)` after `varS += OUT` cancels back to `Math.max(varB,
  varS_original)`) — this was not an active bug. Both, plus `recalcHeader()`
  and `buildSnapshotText()`, were refactored to consume one shared
  `computeBudgetTotals()` helper so they can no longer independently drift.
- **[High]** Confirmed and fixed the real bug: `buildShareCardAll()` (the
  "Image — Full Budget" share card) used `INFLOW - totalS` with no floor at
  budget, while `drawBudget()` used the correct
  `INFLOW - Math.max(fixB,fixS) - Math.max(varB,varS) - OUT`. Now both consume
  `computeBudgetTotals()`, eliminating the discrepancy shown to whoever
  receives the shared image.
- **[High]** Fixed cross-channel duplicate detection: introduced
  `normalizeDescKey()` and use it consistently in both
  `parseAlertMessages()` (email-sync) and `processStatement()` (CSV/PDF), so
  the same physical charge produces the same dedup key regardless of import
  channel.
- **[Medium]** Loosened the alert amount regex from `AED\s+([\d,]+\.\d{2})`
  (exactly 2 decimals) to `AED\s+([\d,]+(?:\.\d{1,2})?)` (0, 1, or 2 decimals).

### Performance & code quality

- **[High]** `html2canvas` and `pdf.js` no longer load unconditionally in
  `<head>` — added a `loadScript()` helper that lazy-injects each library only
  when share-as-image or PDF-upload is actually invoked.
- **[High]** Free-text inputs (reimbursement/outflow description & amount)
  now call a `debouncedSaveCache()` (400ms) instead of writing the full `APP`
  object to localStorage on every keystroke.
- **[High]** Extracted `computeBudgetTotals()` as the single source of truth
  for budget totals/savings, consumed by `drawBudget()`, `recalcHeader()`,
  `openConcludeModal()`, `confirmConclude()`, `buildSnapshotText()`, and
  `buildShareCardAll()` — removes the duplication that caused the savings
  formula mismatches above.
