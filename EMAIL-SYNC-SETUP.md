# ADCB Email Auto-Sync — One-Time Setup (iPhone)

> **Easiest path:** open **`setup.html`** on your phone (same place the app is
> hosted, e.g. `https://mueidsikander-lab.github.io/Budget/setup.html`, or via
> *Settings → Email Auto-Sync → Setup Assistant*). It creates the secret Gist
> for you, connects it to the app automatically, gives you copy-paste values
> for the Shortcut, and tests the whole pipeline. The manual steps below do
> the same thing by hand.

ADCB no longer sends SMS transaction alerts — switch your alert channel to
**Email** first (ADCB app or website → Settings → Alerts/Notifications).
After that, every ADCB email alert is forwarded automatically from your
iPhone to a private GitHub Gist. When you open the Budget app and tap
**Sync New Alerts**, new transactions appear in the normal review screen —
no typing, no statement uploads.

How it works:

```
ADCB sends email alert → iPhone Mail automation runs the Shortcut → posts alert text as a Gist comment
                                                                          ↓
Budget app (Import page) → "Sync New Alerts" → fetches Gist comments → review & apply
```

---

## Step 1 — Create a GitHub token

1. Go to https://github.com/settings/tokens → **Generate new token (classic)**.
   (It must be a *classic* token — fine-grained tokens can't access gists.)
2. Note: `ADCB Email forwarder` · Expiration: your choice (e.g. 1 year).
3. Tick **only** the `gist` scope. Nothing else.
4. Generate, and copy the token (`ghp_...`). You'll paste it into the Shortcut once.

## Step 2 — Create the secret Gist (the inbox)

1. Go to https://gist.github.com (sign in with your GitHub account), or let
   `setup.html` create it for you automatically.
2. Filename: `readme.md` · Content: anything (placeholder).
3. Click **Create secret gist** (the grey button, *not* public).
4. Copy the **Gist ID** — the long hex string at the end of the URL:
   `https://gist.github.com/your-username/`**`a1b2c3d4e5f6789...`**

> A "secret" gist is unlisted: it doesn't appear in search or on your profile.
> Only someone with the exact ID could view it. The app reads gist
> **comments** (not files) — each comment is one forwarded email alert.

## Step 3 — Build the iPhone Shortcut

Open the **Shortcuts** app → **+** to create a new shortcut named
`Forward ADCB Email`, with these two actions:

1. **Get Details of Emails**
   - Input: `Shortcut Input`
   - Detail: `Plain Text Content`

2. **Get Contents of URL**
   - URL: `https://api.github.com/gists/YOUR_GIST_ID/comments`
   - Tap *Show More*:
     - Method: **POST**
     - Headers:
       | Key | Value |
       |---|---|
       | `Authorization` | `Bearer ghp_YOUR_TOKEN` |
       | `Accept` | `application/vnd.github+json` |
     - Request Body: **JSON**
       - Add field → **Text**, key: `body`, value: the *Plain Text Content*
         variable from step 1 (not "Shortcut Input" directly).

## Step 4 — Make it run automatically

1. Shortcuts app → **Automation** tab → **+**.
2. Choose **Email**.
3. *Contains*: `ADCB` · *From*: leave empty, unless you want to restrict it
   to ADCB's specific sending address.
4. Select **Run Immediately** (iOS 17+; on older iOS it asks for a tap first).
5. Pick the `Forward ADCB Email` shortcut. Done.

Send yourself a test email containing "ADCB ... charged AED 10.00 at TEST on
01/01/2026" and check (via `setup.html` → Check inbox, or the gist's comments
on github.com) that a new comment appears.

## Step 5 — Connect the Budget app

1. Open the Budget app → **Settings** → **Email Auto-Sync**.
2. Paste your **Gist ID** (the full gist URL also works).
3. Go to **Import** → tap **Sync New Alerts**. New transactions appear in the
   usual review screen — assign categories and Apply.

---

## Notes

- **Privacy**: alerts (merchant, amount, card last-4) live in the unlisted
  gist, not in this public repo. The token in your Shortcut can only touch
  gists. The comments endpoint itself is read without authentication by the
  app, so anyone who learns your exact Gist ID could read your alert history
  — treat the ID like a password and avoid sharing screenshots of Settings.
  If you ever suspect it's been exposed, delete the gist, create a new one in
  `setup.html`, and update the ID in Settings.
- **Duplicates**: the app remembers which alert comments it has applied, and
  the existing duplicate detection also guards against re-imports from CSV/PDF
  statements covering the same charge.
- **Cancelling** a sync preview keeps the alerts unprocessed — they reappear
  on the next sync.
- **Housekeeping**: gist comments accumulate over time. Every few months,
  open the gist on github.com and delete old comments (or delete the gist,
  create a new one, and update the ID in Settings).
- **Paste fallback**: the manual "Paste ADCB Email Alerts" box on the Import
  page still works any time, e.g. for alerts from before the automation
  existed.
