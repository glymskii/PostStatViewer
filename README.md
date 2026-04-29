# PostStatViewer

Self-hosted tracker for **Instagram Reels**, **Threads**, and **TikTok** post
statistics. Scrapes profiles on a schedule, snapshots view/like counts over
time, charts the trend, and exports per-account data to Excel. Built with
Next.js 15, TypeScript, Playwright, and SQLite.

> Russian-language admin UI; English-language code and docs.

---

## Features

- **Multi-platform scraping**: Instagram Reels, Threads (text & media posts),
  TikTok (stub).
- **Time-series snapshots**: every scrape run records `views` / `likes` per
  post, so you can chart growth over days/weeks.
- **Manual session upload**: when an auto-login flow inevitably breaks, drop
  in fresh cookies (Cookie-Editor JSON export) via `/settings` — no redeploy
  needed.
- **Telegram alerts**: stale sessions, scrape failures, and >36h-old data
  trigger a push notification with built-in 6h dedup.
- **Health-check watchdog**: independent hourly cron surfaces "no fresh data"
  even if the main scheduler isn't ticking.
- **Excel export**: per-account workbook with summary, post list, and full
  snapshot history (3 sheets) — one click on the account page.
- **Cooldown**: after 3 consecutive session failures a platform goes on a
  6h cooldown so we don't hammer broken login UIs.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Next.js UI    │     │   API routes     │     │   SQLite + WAL  │
│  (Tailwind +    │────▶│  /api/accounts   │────▶│   (Drizzle ORM) │
│   shadcn/ui)    │     │  /api/posts      │     │                 │
└─────────────────┘     │  /api/scrape     │     └─────────────────┘
                        │  /api/sessions/* │             │
                        │  /api/notifs/*   │             │
                        └──────────────────┘             │
                                 │                       │
┌─────────────────┐              │                       │
│ instrumentation │──────────────┴───────────────────────┤
│  (boots cron +  │                                      │
│   scheduler)    │              ┌───────────────────────┴──────┐
└─────────────────┘              ▼                              ▼
        │              ┌───────────────────┐         ┌────────────────┐
        ▼              │  scheduler.ts     │         │ healthCheck.ts │
   storageState        │  (per-day cron)   │         │ (hourly cron)  │
   /app/data/          └─────────┬─────────┘         └────────┬───────┘
   browser-data/                 │                            │
   *-state.json                  ▼                            ▼
                        ┌───────────────────┐         ┌────────────────┐
                        │   runner.ts       │         │  notify.ts     │
                        │   (Playwright +   │────────▶│ (Telegram API) │
                        │    stealth)       │         └────────────────┘
                        └─────────┬─────────┘
                                  │
                        ┌─────────┴─────────┐
                        │  per-platform     │
                        │  scrapers:        │
                        │  - instagram      │
                        │  - threads        │
                        │  - tiktok (stub)  │
                        └───────────────────┘
```

Per-platform sessions are stored as Playwright `storageState` JSON files in
`data/browser-data/`. Each platform has its own file — Threads no longer
depends on Instagram's session.

---

## Local development

### Prerequisites

- Node.js **20.x** (the codebase uses APIs not in 18; v23 also works locally).
- macOS, Linux, or WSL (Playwright Chromium is bundled).

### One-time setup

```sh
git clone https://github.com/glymskii/PostStatViewer.git
cd PostStatViewer
nvm use 20
npm install
npx playwright install chromium

# bootstrap the database
mkdir -p data
npm run db:push        # creates SQLite schema (runs migrations)
npm run db:seed        # optional: insert a sample account
```

### Environment variables

Create `.env.local` for local dev (gitignored). Production uses Railway env
vars set via dashboard.

```sh
# Auth (admin login for the dashboard)
JWT_SECRET=change-me-to-something-long
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me

# Optional: automated Instagram login fallback (manual cookie upload preferred)
INSTAGRAM_USERNAME=your_ig_handle
INSTAGRAM_PASSWORD=your_ig_password
INSTAGRAM_TOTP_SECRET=base32-totp-from-2fa-setup

# Telegram alerts (optional but strongly recommended for prod)
TELEGRAM_BOT_TOKEN=123456789:AABBcc...
TELEGRAM_CHAT_ID=123456789

# Optional: override storage paths
BROWSER_DATA_DIR=/absolute/path/to/browser-data
```

### Run

```sh
npm run dev          # next dev — http://localhost:3000
```

Login at `/login` with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server with hot reload |
| `npm run build` | Production build (run before deploying) |
| `npm run lint` | ESLint with the Next.js config |
| `npm run scrape` | Manually run the scraper for all active accounts (no cron) |
| `npm run db:push` | Apply Drizzle migrations to local SQLite |
| `npm run db:generate` | Generate a new migration after schema changes |
| `npm run db:seed` | Insert a sample account for dev |

---

## Deployment (Railway)

The repo is configured for Railway auto-deploy:

- **Builder**: Dockerfile (`railway.json` → `Dockerfile`).
- **Branch**: `main` — every push triggers a build.
- **Volume**: a single persistent volume mounted at `/app/data` holds the
  SQLite DB and the per-platform browser cookies.
- **Migrations**: `instrumentation.ts` applies pending Drizzle migrations on
  boot (idempotent, tracked in `__drizzle_migrations`).

### Required Railway env vars

Same as local `.env.local` minus the dev ones. At minimum:

```
JWT_SECRET
ADMIN_USERNAME
ADMIN_PASSWORD
TELEGRAM_BOT_TOKEN     # for alerts
TELEGRAM_CHAT_ID       # for alerts
```

### Manual fallback deploy

If the GitHub integration is offline:

```sh
railway up
```

---

## Operations

### "Сбор не работает N дней" appears in the UI

The dashboard banner means the last successful scrape for that account is
older than 36h. Same condition triggers a Telegram `⏰ No fresh data` alert
once per 12h.

Most common root cause: session cookies expired or the platform's login UI
changed. Fix path:

1. Open `instagram.com` (or `threads.com`) in regular Chrome.
2. Make sure you're logged in (feed loads, no login wall).
3. Click [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
   → Export → JSON.
4. Save the clipboard to a file: `pbpaste > ~/Desktop/instagram-cookies.json`.
5. Upload via `/settings` → Сессии браузера → Загрузить cookies.
6. Trigger a scrape from the home page; the banner clears once a successful
   run is recorded.

### "🔒 Session expired" alert

Same fix as above — automated login is misbehaving and only fresh cookies will
unblock the platform. After 3 consecutive `NEEDS_MANUAL_SESSION` errors the
runner puts that platform on a 6h cooldown to avoid hammering the broken
login flow; a successful scrape clears the cooldown.

### "⚠️ Scrape failed" alert

A non-session error (network, DOM parse failure, Playwright crash). Inspect
Railway logs:

```sh
railway logs --deployment
```

### Excel export

Open any account page → "Экспорт в Excel" button. Produces
`{platform}-{username}-{YYYY-MM-DD}.xlsx` with three sheets (Сводка / Посты /
Динамика).

---

## Database

SQLite + better-sqlite3 + Drizzle ORM. Schema in `src/db/schema.ts`:

- `accounts` — tracked profiles (one per platform × username).
- `posts` — post metadata (caption, thumbnail, URL).
- `post_snapshots` — time-series of view/like counts (one row per scrape run
  per post).
- `scrape_runs` — log of every scrape attempt (status, error, duration).
- `settings` — KV store for cron schedule, Telegram config, alert dedup,
  per-platform cooldown state.

Migrations live in `src/db/migrations/`. To change the schema:

```sh
# 1. edit src/db/schema.ts
npm run db:generate      # produces src/db/migrations/0003_*.sql
npm run db:push          # apply locally
# 2. commit migration + schema together
```

On Railway, migrations apply automatically at boot via `instrumentation.ts`.

---

## Contributing

This is a personal project but the workflow is normal:

1. Branch from `main`: `git checkout -b feature/<short-name>`.
2. Atomic commits, [Conventional Commits](https://www.conventionalcommits.org/)
   prefixes (`feat`, `fix`, `chore`, `debug`, `refactor`).
3. PR to `main` via `gh pr create`.
4. CI must pass (build + lint).
5. Merge → Railway auto-deploys from `main`.

---

## License

Private — all rights reserved.
