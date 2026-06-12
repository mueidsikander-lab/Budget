# ADCB SMS Auto-Sync — One-Time Setup (iPhone)

> **Easiest path:** open **`setup.html`** on your phone (same place the app is
> hosted, e.g. `https://mueidsikander-lab.github.io/Budget/setup.html`, or via
> *Settings → SMS Auto-Sync → Setup Assistant*). It creates the secret Gist for
> you, connects it to the app automatically, gives you copy-paste values for
> the Shortcut, and tests the whole pipeline. The manual steps below do the
> same thing by hand.

After this setup, every ADCB credit card SMS alert is forwarded automatically
from your iPhone to a private GitHub Gist. When you open the Budget app and tap
**Sync New Alerts**, new transactions appear in the normal review screen — no
typing, no statement uploads.

How it works:

```
ADCB sends SMS → iPhone Shortcut runs automatically → appends alert to your secret Gist
                                                              ↓
Budget app (Import page) → "Sync New Alerts" → fetches Gist → review & apply
```

---

## Step 1 — Create a secret Gist (the inbox)

1. Go to https://gist.github.com (sign in with your GitHub account).
2. Filename: `inbox.md` · Content: `ADCB SMS inbox` (placeholder, anything works).
3. Click **Create secret gist** (the grey button, *not* public).
4. Copy the **Gist ID** — the long hex string at the end of the URL:
   `https://gist.github.com/your-username/`**`a1b2c3d4e5f6789...`**

> A "secret" gist is unlisted: it doesn't appear in search or on your profile.
> Only someone with the exact ID could view it.

## Step 2 — Create a GitHub token (lets the Shortcut write to the Gist)

1. Go to https://github.com/settings/tokens → **Generate new token (classic)**.
   (It must be a *classic* token — fine-grained tokens can't access gists.)
2. Note: `ADCB SMS forwarder` · Expiration: your choice (e.g. 1 year).
3. Tick **only** the `gist` scope. Nothing else.
4. Generate, and copy the token (`ghp_...`). You'll paste it into the Shortcut once.

## Step 3 — Build the iPhone Shortcut

Open the **Shortcuts** app → **Shortcuts** tab → **+** to create a new shortcut
named `Forward ADCB SMS`, with these two actions:

1. **Format Date**
   - Date: `Current Date`
   - Format: `Custom` → `yyyyMMddHHmmss`

2. **Get Contents of URL**
   - URL: `https://api.github.com/gists/YOUR_GIST_ID`
   - Tap *Show More*:
     - Method: **PATCH**
     - Headers:
       | Key | Value |
       |---|---|
       | `Authorization` | `Bearer ghp_YOUR_TOKEN` |
       | `Accept` | `application/vnd.github+json` |
     - Request Body: **JSON**
       - Add field → **Dictionary**, key: `files`
         - Inside it, add field → **Dictionary**, key: `sms-` `[Formatted Date]` `.txt`
           (tap the key field and insert the *Formatted Date* variable between the text)
           - Inside it, add field → **Text**, key: `content`, value: `Shortcut Input`

## Step 4 — Make it run automatically

1. Shortcuts app → **Automation** tab → **+**.
2. Choose **Message**.
3. *Message Contains*: `ADCB` · *From*: leave empty (sender IDs vary).
4. Select **Run Immediately** (iOS 17+; on older iOS it asks for a tap first).
5. Pick the `Forward ADCB SMS` shortcut. Done.

Send yourself a test message containing "ADCB ... charged AED 10.00 at TEST on
01/01/2026" and check that a new `sms-....txt` file appears in your gist.

## Step 5 — Connect the Budget app

1. Open the Budget app → **Settings** → **SMS Auto-Sync**.
2. Paste your **Gist ID** (the full gist URL also works).
3. Go to **Import** → tap **Sync New Alerts**. New transactions appear in the
   usual review screen — assign categories and Apply.

---

## Notes

- **Privacy**: alerts (merchant, amount, card last-4) live in the unlisted gist,
  not in this public repo. The token in your Shortcut can only touch gists.
- **Duplicates**: the app remembers which alert files it has applied, and the
  existing duplicate detection also guards against re-imports.
- **Cancelling** a sync preview keeps the alerts unprocessed — they reappear on
  the next sync.
- **Housekeeping**: the GitHub API returns at most ~300 files per gist. Every
  few months, open the gist → Edit → delete old `sms-*.txt` files (or delete the
  gist, create a new one, and update the ID in Settings).
- **Paste fallback**: the manual "Paste ADCB Message Alerts" box on the Import
  page still works any time, e.g. for alerts from before the automation existed.
