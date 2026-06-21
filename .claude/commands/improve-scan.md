---
description: Run all five improvement-audit subagents against the current app and append new findings to IMPROVEMENTS.md
---

Run a full multi-angle improvement scan of this app and update
`IMPROVEMENTS.md`. This command is suggestion-only — never edit
`index.html`/`setup.html` as part of this command, even if a fix looks
obvious. The user reviews and applies fixes separately.

Steps:

1. Read `IMPROVEMENTS.md` (create it from scratch if missing, using the
   structure of the existing entries as a template) so you know what's
   already been reported and what's already marked fixed.
2. Dispatch these five subagents in parallel, each given the current date
   and a pointer to read `index.html`/`setup.html` fresh (not from your own
   memory of them): `security-auditor`, `ui-ux-reviewer`,
   `financial-logic-reviewer`, `performance-reviewer`,
   `code-quality-reviewer`. Ask each to also note whether any
   previously-reported finding in `IMPROVEMENTS.md` is now fixed.
3. Once all five report back, reconcile against `IMPROVEMENTS.md`:
   - For findings that already exist (same file/line/issue), leave them
     alone unless an agent confirmed it's fixed — then move it to a
     "Resolved" section with the date.
   - Append genuinely new findings under today's date, grouped by angle,
     in the same High/Medium/Low format the agents used.
   - Do not duplicate or restate unchanged findings.
4. Print a short summary to the user: how many new findings, how many
   resolved, and the single highest-priority new item (if any). Do not
   paste the full report inline — point them at `IMPROVEMENTS.md`.

If the user has not asked you to also fix anything, stop after step 4 —
do not start editing app code.
