# Operations runbook

Live deployment map (as of 2026-10-01):

| Piece | Where | Notes |
|---|---|---|
| Frontend | https://urbanrisk-ai.vercel.app | Vercel, root dir `frontend/`, env var `VITE_API_BASE_URL` (type: Config) |
| Backend API + SSE | https://urbanrisk-backend-4yqu.onrender.com | Render free web service (Docker), models baked into image |
| Postgres | Render `urbanrisk-db` (free) | ⚠️ **free Postgres expires 30 days after creation — migrate before then** |
| Ingestion | Runs inside the web service (`ENABLE_INGESTION=1` default) | 10-min cycle, batched Open-Meteo with MET Norway fallback |
| Watchdog | GitHub Actions cron (this repo) | Pings the API every 15 min; opens/closes the issue “Ingestion watchdog: live data stalled” |

## ⚠️ 1. Render free Postgres expires after 30 days

Render deletes free databases ~30 days after creation. Migrate to **Neon** (or
Supabase) — both have genuinely free, non-expiring tiers — while the current DB
still works:

1. Create a Neon project (region close to you; Chennai users → Singapore/Mumbai).
2. Copy the **pooled connection string** (`postgresql://user:pass@ep-...neon.tech/neondb?sslmode=require`).
3. Render dashboard → `urbanrisk-backend` → **Environment** → edit `DATABASE_URL` → paste the Neon string → **Save** (this redeploys the service).
4. Verify `https://urbanrisk-backend-4yqu.onrender.com/api/data-health` still returns sources.
5. Only after verification, delete the old Render DB.

No code change is needed — `app/database.py` uses the URL as a plain SQLAlchemy
connection string and Neon speaks the same Postgres protocol.

## 2. Fix auto-deploy (pushes stopped triggering deploys)

Render deployed `9af39d9` at 8:02 PM IST and then ignored every later push. To repair:

1. Render dashboard → `urbanrisk-backend` → **Settings → Build & Deploy → Auto-Deploy** → set **“On for `main`”**.
2. GitHub → this repo → **Settings → Webhooks** → open the `api.render.com` webhook → check **Recent Deliveries** for failures (a `403`/`404` usually means the Render GitHub App lost repo access → fix in Render → Account Settings → **GitHub Permissions** → re-grant access to `Jagrit05/urbanrisk-ai`).
3. Until it's fixed, **Manual Deploy → Deploy latest commit** is the reliable path — use it after every push.

> Deployment status check: the seeded row `metno_locationforecast` in
> `/api/data-health` only exists on commits `7a8f4e6`+. If that key is missing,
> the running service predates the hardening work and should be redeployed.

## 3. Ingestion watchdog (GitHub Actions)

`.github/workflows/watchdog.yml` runs every 15 minutes:

- Pings `/api/dashboard` + `/api/data-health` (with retries to ride out ~60 s cold starts).
- **Opens a GitHub issue** when 0 zones report or the weather/AQ sources are stale (>30 min); comments on the existing issue instead of spamming duplicates.
- **Auto-closes the issue** on recovery.
- Runs on GitHub's IPs, so it is immune to Render's provider throttling and cold starts.
- Manual runs: Actions → Ingestion watchdog → **Run workflow**.

Note: GitHub disables scheduled workflows after 60 days of repo inactivity — any
commit resets the clock (the watchdog itself failing creates activity via issues,
which does not count; a code commit does).

## 4. Storage retention

`backend/app/ingestion/worker.py` prunes `weather` / `air_quality` rows older
than `OBSERVATION_RETENTION_DAYS` (default **45**) once per UTC day. Predictions
never read history from the live DB (models come from the M1–M3 training
artifacts), so this only bounds growth (~5,800 rows/day otherwise).

## 5. Free-tier behavior to expect

- **Cold starts:** after ~15 min without traffic the web service sleeps; the next
  request takes ~50–60 s. The Vercel frontend will show a spinner meanwhile; the
  watchdog's retries are tuned for this. (Optional: a free UptimeRobot ping every
  10 min keeps it warm, at the cost of burning free instance hours.)
- **Shared egress IP:** Open-Meteo rate-limits per client IP, and Render's free
  instances share IPs — some cycles may fall back to MET Norway (check
  `/api/data-health`: weather rows may come from `metno_locationforecast`).
- **First deploy of new code takes ~5 min** (Docker layers cached after that).

## 6. Runbook: dashboard shows “0 reporting zones”

1. Open `/api/data-health` — are `openmeteo_weather` / `metno_locationforecast` /
   `openmeteo_air_quality` fresh?
2. If yes but the dashboard is empty → check the SSE stream in the browser dev tools.
3. If no → Render logs: look for `[ingestion]` lines (batch failures print there).
4. Check the watchdog issue for when it started, and Render Events for a crash loop.
5. Nuclear option: Render → **Manual Deploy → Deploy latest commit**.
