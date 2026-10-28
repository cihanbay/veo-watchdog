# Veo Watchdog — setup (10 minutes, free)

A GitHub Actions bot that runs **every 5 minutes** and:
- 🔔 Telegram-messages you the moment any server goes DOWN (and when it's back)
- 🛠 **auto-fixes**: Falix 502 (proxy toggle), Bot-Hosting offline (auto power-start)
- quietly skips jahan auto-start (Falix policy — it only notifies)

---

## Step 1 — GitHub repo

1. Log in at **github.com** (you already have — Bot-Hosting uses it)
2. **+ (top right) → New repository**
3. Name: `veo-watchdog` · Visibility: **Public** (needed for unlimited free actions; secrets stay hidden) → Create

## Step 2 — Secrets

Repo page → **Settings → Secrets and variables → Actions → New repository secret**

Add these 5 (exact names, paste values exactly):

| Name | Value |
|---|---|
| `FALIX_KEY` | (netcheckgate API key — flx_live_wpH2…) |
| `FALIX_KEY2` | (jahan API key — flx_live_KVUS…) |
| `BH_KEY` | (bot-hosting key — bhk_…) |
| `TG_TOKEN` | 8509956232:AAEJHeViKvSddPvdvcc7KTbTIPsC2wNtavY |
| `TG_CHAT` | 795569949 |

## Step 3 — Files

In the repo: **Add file → Create new file** — type the full path to create folders as you add each:

1. `watchdog.js` ← paste content from this folder's `watchdog.js`
2. `.github/workflows/watchdog.yml` ← paste content from this folder's `watchdog.yml`
   (typing `.github/workflows/watchdog.yml` as the filename auto-creates the folders)
3. Commit each: **Commit new file**

## Step 4 — First run + verify

1. **Actions** tab → **veo-watchdog** → **Run workflow** → Run
2. Watch it go green (~1-2 min)
3. That's it — it now runs itself every 5 minutes

## Alerts you'll receive on Telegram

- `🚨 netcheckgate: DOWN (…) — auto-repair attempted` → and `🛠 …auto-fixed and back UP`
- Jahan-down alerts include `needs manual Start on the dashboard (captcha)` when only you can fix it.
