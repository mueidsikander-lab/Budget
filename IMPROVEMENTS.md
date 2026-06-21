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
- **[Low]** Auto-learned merchant mapping key (`cleanDesc.toLowerCase().split("
  ").slice(0,2).join(" ")`) is built inconsistently from SMS/email- vs.
  CSV-derived description strings, risking over/under-broad future matches via
  the substring-based `matchCat`.
- **[Low]** `renderDailyChart` buckets by re-parsing a stored `toISOString()`
  (UTC) timestamp with local-timezone `ymd()` formatting — not verified as
  currently triggering a wrong bucket, but the same class of bug as the
  forecast issue above; flagged for awareness.

### Performance & code quality

- **[Medium]** `bindBudgetEvents` (~225 lines) wires four event types and
  inline-implements business logic for reimbursements, outflows,
  paid-toggling, and txn CRUD in one function. *Fix:* split by concern into
  smaller functions (no architecture change needed).
- **[Low]** Naming drift (`fixB/fixS/varB/varS` vs. full-word vs.
  single-letter scoped reuse, e.g. `t` meaning different things in nearby
  functions) — only worth fixing opportunistically when touching nearby code.

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
