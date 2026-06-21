# Improvements Backlog

Generated and maintained by the `/improve-scan` command and the
`.claude/agents/*` subagents (security-auditor, ui-ux-reviewer,
financial-logic-reviewer, performance-reviewer, code-quality-reviewer).
This file is suggestion-only — nothing here is auto-applied. Review an
item, fix it by hand (or ask Claude to), then move it to **Resolved**.

To regenerate/update this file, run `/improve-scan` (or `/loop 60m
/improve-scan` to repeat it automatically for the rest of the session).

---

## 2026-06-21 — Initial scan

### Security

- **[High]** Stored XSS: `index.html:1972` (`h.month`) and `:1981`
  (`h.topCategories[0].c`) are concatenated into `innerHTML` in
  `drawHistory()` without `escHtml()`. Both originate from
  `APP.currentMonth`/category names, which become attacker-controlled if a
  crafted `#transfer=<base64 JSON>` URL is opened (`confirmTransfer()`,
  ~line 811-822, does `APP = data` with no string sanitization). *Fix:*
  wrap both in `escHtml()`.
- **[Medium]** Same unescaped-`APP.currentMonth` sink in the detected-month
  banner: `index.html:2351` and `:2353`. *Fix:* `escHtml()` both
  interpolations.
- **[Medium]** No Subresource Integrity on the CDN scripts:
  `index.html:12-13` (`html2canvas@1.4.1` via jsdelivr, `pdf.js@3.11.174`
  via cdnjs) have no `integrity`/`crossorigin`. A compromised CDN/MITM
  could inject JS with full access to localStorage financial data. *Fix:*
  add SRI hashes or self-host both libraries.
- **[Low]** `prepareHomeScreen()` (`index.html:824-834`) puts the entire
  base64-encoded `APP` object into `location.hash`. It's a fragment (not
  sent to servers/logs) but persists in browser history until the modal is
  closed, and could leak in full if the user shares that URL instead of
  using "Add to Home Screen". *Fix:* clear the hash immediately, or hand
  off via `sessionStorage` instead of the URL.
- **[Low]** No documented rotation/expiry guidance for the secret Gist ID
  itself (only token expiry is covered in `SMS-SYNC-SETUP.md`); the
  comments endpoint is permanently unauthenticated by design. *Fix:* add a
  doc note recommending periodic gist-ID rotation if it's ever exposed
  (screenshot, shoulder-surfing Settings, etc.).
- **[Low]** `setup.html`'s `checkInbox()` renders gist comment bodies into
  `innerHTML` (around line 217-220) without escaping — low severity
  self-XSS scoped to the setup assistant. *Fix:* HTML-escape before
  display.

### UI/UX & Accessibility

- **[High]** Icon-only controls have no accessible name: share/conclude
  buttons (`index.html:490-491`), `.cb-paid` checkbox (`:1391`), `txn-del`
  (`:1458`), `map-del` (`:881`, `:2840`), `reimb-del`/`outflow-del`
  (`:1493`/`:1525`). `title` doesn't reliably announce on VoiceOver. *Fix:*
  add proper `aria-label`s (dynamic per category where relevant).
- **[High]** No `manifest.json`, service worker, or `apple-touch-icon` —
  the PWA claim (`apple-mobile-web-app-capable` meta tags) is incomplete;
  the app can't install as a real PWA on Android/desktop and breaks
  offline for any feature depending on the CDN scripts. *Fix:* add a
  manifest + icons and a minimal service worker, or vendor the two CDN
  libraries locally for offline use.
- **[High]** Modals have no focus management: `openModal`/`closeModal`
  (`index.html:2755-2756`) just toggle `display`, with no `role="dialog"`,
  no focus trap, no Escape-to-close. *Fix:* add `aria-modal`, move focus in
  on open and restore on close, bind Escape.
- **[Medium]** `user-scalable=no, maximum-scale=1.0` in the viewport meta
  (`index.html:5`) removes the pinch-zoom escape hatch for low-vision
  users, compounding low-contrast text (`--text-3` is ~2:1 contrast on
  black, under WCAG AA). *Fix:* drop both viewport restrictions.
- **[Medium]** Fixed-width amount/name columns risk clipping with real
  data: `.cbk-amt` (`:127`, `flex:0 0 62px`) against large totals, `.cbk-name`
  (`:124`, 38% width + ellipsis) against real category names like
  "Telephone+Internet+TV" / "Mueid / Madiha / House" (`defaultData()`,
  `:669`/`:697`/`:710`). *Fix:* let `.cbk-amt` grow; verify long names
  render acceptably.
- **[Medium]** Inputs lack associated `<label>`s: `#inflow-input` (`:568`),
  `#debit-balance-input` (`:576`), `#gist-id-input` (`:593`), `#date-from`/
  `#date-to` (`:527-529`). *Fix:* `<label for>` or `aria-labelledby`.
- **[Low]** SMS sync silently treats unparseable comments as "processed"
  with no per-message feedback (`syncSMSFromGist()`, `:2148-2190`) — user
  just sees a generic "no new alerts". *Fix:* surface a "skipped —
  unrecognized format" count separately.
- **[Low]** No consistent close affordance on bottom-sheet modals beyond
  Cancel/Skip buttons; no tap-outside-to-dismiss, inconsistent with the iOS
  pattern the UI otherwise emulates.

### Financial logic correctness

- **[High]** `openConcludeModal()` (preview shown to user) and
  `confirmConclude()` (what's actually saved to History) use different
  savings formulas — `:1861` vs `:1889`. Verified numerically: with
  `varB=500, varS=600, OUT=200, fixB=fixS=1000, INFLOW=2000`, the modal
  shows 200 but History stores 300. *Fix:* make `confirmConclude` reuse the
  exact formula shown in the modal.
- **[High]** The "Image — Full Budget" share card uses yet another savings
  formula than the live Budget page — `:1063` (`drawBudget`, floors
  variable spend at budget) vs `:2616` (`buildShareCardAll`, raw
  `INFLOW - totalS`, no floor). Same scenario as above: 200 (on-screen) vs
  600 (shared image) — a 400 AED discrepancy shown to whoever receives the
  share. *Fix:* extract one `computeBudgetTotals()` used by both paths.
- **[High]** Cross-channel duplicate detection fails between SMS-sync and
  CSV/PDF import: SMS dedup key is `dateStr|cleanedUppercaseDesc|amount`
  (`:2104`) vs CSV/PDF's `dateStr|rawDesc|amount` (`:2341`) — the same
  physical charge synced via SMS and later seen on the official statement
  produces different keys and is **not** flagged as a duplicate, causing
  double-counting. *Fix:* normalize description into one canonical key
  function shared by both parsers.
- **[Medium]** SMS amount regex `AED\s+([\d,]+\.\d{2})` (`:2092-2095`)
  requires exactly two decimal digits — bank alerts formatted as "AED 100"
  or "AED 100.5" silently fail to match and the whole message is skipped
  with no specific error. *Fix:* loosen to `\.\d{1,2}` and accept
  no-decimal amounts.
- **[Medium]** Forecast/elapsed-fraction logic (`:1134`, `:1148`) relies on
  device-local `new Date()` with no explicit timezone pinning — currently
  correct only because the device's local timezone happens to match the
  intended budget timezone (UTC+4). Given this project already shipped one
  UTC+4-related date bug, this is worth hardening proactively even though
  not currently broken.
- **[Low]** Auto-learned merchant mapping key (`:2400`,
  `cleanDesc.toLowerCase().split(" ").slice(0,2).join(" ")`) is built
  inconsistently from SMS- vs. CSV-derived description strings, risking
  over/under-broad future matches via the substring-based `matchCat`.
- **[Low]** `renderDailyChart` (`:1296`) buckets by re-parsing a stored
  `toISOString()` (UTC) timestamp with local-timezone `ymd()` formatting —
  not verified as currently triggering a wrong bucket, but the same class
  of bug as the forecast issue above; flagged for awareness.

### Performance & code quality

- **[High]** `html2canvas` and `pdf.js` (`index.html:12-13`) load
  unconditionally on every page view (~250KB+ combined min'd) even though
  they're only used by the rare share-as-image / PDF-upload actions. *Fix:*
  lazy-inject both scripts only when those features are invoked.
- **[High]** Free-text inputs (reimbursement/outflow description & amount,
  ~lines 1697-1732) call `saveCache()` directly on every `input` event,
  re-serializing and writing the *entire* `APP` object to localStorage per
  keystroke. *Fix:* debounce those specific `saveCache()` calls (~300-500ms).
- **[High]** Budget-totals logic is duplicated across `drawBudget()`
  (`:1050-1063`), `buildSnapshotText()` (`:2540-2556`), and
  `buildShareCardAll()` (`:2603-2616`), with per-row formatting duplicated
  between `renderRow()` (`:1378`) and `scRow()` (`:2643`) — this is the
  root cause of the savings-formula mismatches listed under Financial
  logic above. *Fix:* one shared `computeBudgetTotals()` helper consumed by
  all render paths.
- **[Medium]** `bindBudgetEvents` (`index.html:1535-1760`, ~225 lines)
  wires four event types and inline-implements business logic for
  reimbursements, outflows, paid-toggling, and txn CRUD in one function.
  *Fix:* split by concern into smaller functions (no architecture change
  needed).
- **[Low]** Naming drift (`fixB/fixS/varB/varS` vs. full-word vs.
  single-letter scoped reuse, e.g. `t` meaning different things in nearby
  functions) — only worth fixing opportunistically when touching nearby
  code.

---

## Resolved

_(none yet)_
