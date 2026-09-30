# UrbanRisk AI — M5 + M6: Backend (PostgreSQL + FastAPI) + Live Ingestion

**Milestones 5-6 of 9.** M5 is where the project stopped being Colab notebooks and
became a real, running service, serving the M4 risk-engine logic behind the 8
endpoints your original spec listed. M6 (added on top of the same backend) is the
live ingestion worker that actually fills the `weather`/`air_quality` tables M5 was
already built to read — a separate container (`ingestion`), same codebase.

## What M6 does
- A standalone worker (`app/ingestion/worker.py`) polls **Open-Meteo's forecast
  `current=` endpoints** (near-real-time, keyless — NOT the archive endpoint M1-M3
  used for historical backfill) for every zone in `locations`, every
  `INGESTION_INTERVAL_MINUTES` (default 10, within the spec's 5-15 minute target).
- Each successful fetch is written to `weather`/`air_quality` with
  `source='openmeteo_live'`. Every API endpoint already reads "the latest row per
  zone" — so if a fetch fails for one zone in one cycle, that zone's *last valid*
  observation is what gets served automatically. There's no separate fallback
  mechanism to build; not overwriting a good row IS the fallback.
- **Traffic still has no live feed** (same finding as M3 — nothing free exists for
  Chennai) — there's no `fetch_current_traffic()`. The traffic model's real inputs
  (calendar + current rainfall) are already covered by the weather fetch.
- **Staleness**: every response that includes live data now carries
  `observed_at`, `age_minutes`, and a `status: "LIVE"` / `"STALE"` field
  (threshold: `STALE_AFTER_MINUTES`, default 30 — 3x the ingestion interval, so one
  missed cycle doesn't falsely flag as stale). `GET /api/data-health` computes this
  live from `data_sources.last_updated`, not from a value the worker "remembers" —
  so it correctly reports a dead worker as stale even if the worker process itself
  crashed silently.

## What this does NOT do yet
Until the `ingestion` container completes its first cycle, `weather`/`air_quality`
are empty and endpoints that need "current conditions" say so explicitly (`409` with
a clear message, or a `zones_missing_live_data` list) — they never fabricate a
number to fill the gap. Use `POST /api/dev/seed-observation` (dev-only, remove
before any real deployment) to test immediately without waiting for the first
ingestion cycle.

## 1. Copy your model artifacts in

Create `model_artifacts/` next to `docker-compose.yml` (already scaffolded, empty)
and copy in exactly these files, from your M1/M2/M3 Colab `models/` output:

```
model_artifacts/
├── aqi/
│   ├── zones.csv
│   ├── model_metadata_multizone.json
│   ├── aqi_xgboost_multizone_6h.joblib
│   ├── aqi_xgboost_multizone_12h.joblib
│   └── aqi_xgboost_multizone_24h.joblib
├── flood/
│   ├── flood_zones_static_features.csv
│   ├── flood_model_metadata.json
│   ├── gcc_inundation_points_raw.csv        # optional — enables /incidents seeding
│   ├── flood_logreg_6h.joblib   flood_rf_6h.joblib   flood_xgboost_6h.joblib
│   └── flood_logreg_12h.joblib  flood_rf_12h.joblib  flood_xgboost_12h.joblib
└── traffic/
    ├── traffic_zones_road_features.csv
    ├── traffic_zones_hotspot_distance.csv
    ├── traffic_model_metadata.json
    ├── congestion_logreg_1h.joblib  congestion_rf_1h.joblib  congestion_xgboost_1h.joblib
    └── congestion_logreg_2h.joblib  congestion_rf_2h.joblib  congestion_xgboost_2h.joblib
```

If a file is missing, the backend fails at startup with a clear error naming exactly
which directory/file it expected — it won't start half-loaded.

## 2. Run it

```bash
docker compose up --build
```

This starts three containers: `db` (Postgres), `backend` (the API), and `ingestion`
(the M6 worker) — waits for Postgres to be healthy, then starts the other two. On
first startup the backend:
1. Runs `schema.sql` (idempotent — safe on every restart)
2. Loads every model + metadata file into memory
3. Seeds `locations` from the real zone table, `incidents` from the real GCC data
   (if present), and `model_runs` from each milestone's own saved metrics — nothing
   here is hand-typed, so it can't silently drift from what the notebooks actually produced

The `ingestion` container starts polling immediately once `locations` is populated —
watch it with `docker compose logs -f ingestion`. Give it one full interval
(10 minutes by default) before expecting `/api/dashboard` to show live data for
every zone; check `/api/data-health` in the meantime to see per-zone progress.

API docs: **http://localhost:8000/docs** (FastAPI's interactive Swagger UI).

## 3. Test it end-to-end (before M6 exists)

```bash
curl -X POST http://localhost:8000/api/dev/seed-observation \
  -H "Content-Type: application/json" \
  -d '{"zone_id": "CHN_VELACHRY", "scenario_name": "evening_rush_moderate_rain"}'

curl http://localhost:8000/api/forecast/CHN_VELACHRY
curl http://localhost:8000/api/dashboard
curl http://localhost:8000/api/risk-map
curl http://localhost:8000/api/model-health
curl http://localhost:8000/api/data-health
```

## Endpoints (matches the original spec)

| Endpoint | Notes |
|---|---|
| `GET /api/dashboard` | All zones' current risk; zones with no observation yet are listed separately, not silently dropped |
| `GET /api/forecast/{location_id}` | AQI/flood/traffic across horizons; `409` if no live observation exists for that zone |
| `GET /api/risk-map` | Same as dashboard, shaped for map plotting (`has_live_data` flag per point) |
| `GET /api/explain/{location_id}` | Real SHAP TreeExplainer run against the loaded AQI model, top 10 factors |
| `POST /api/what-if` | Current vs simulated risk; response includes an explicit "not a causal claim" disclaimer, per spec |
| `GET /api/alerts` | Zones at/above `min_category` (default `High`); logs each trigger to `alerts` |
| `GET /api/model-health` | Every candidate model per horizon, which one is `selected_for_serving`, and why (real ROC-AUC comparison from `model_runs`) |
| `GET /api/data-health` | Per-source status; honestly shows `not_yet_connected` for anything M6 hasn't wired up |
| `POST /api/dev/seed-observation` | **Not in the original spec.** Dev-only test data injector. Delete or auth-gate before real deployment. |

All live-data responses (`dashboard`, `forecast`, `risk-map`, `data-health`) now
include `status: "LIVE"` or `"STALE"`, `observed_at`, and `age_minutes` per the
original spec's "show LIVE, last updated timestamp, stale-data warnings" requirement.

## Honesty notes carried forward from M1-M4

- **Flood/traffic model selection** is `argmax(test ROC-AUC)` per horizon, read live
  from each milestone's saved metadata at startup — not assumed, not hardcoded.
- **LogReg is loaded but never served** for flood/traffic — its saved `.joblib` doesn't
  include the fitted `StandardScaler`, so raw features can't safely reach it outside
  the training notebook. `model-health` still reports its test metrics for comparison.
- **AQI risk** = `min(100, predicted_AQI / 5)` — a linear rescale of the existing
  0–500 index, not a new methodology.
- **`RISK_WEIGHTS`** (AQI 0.35 / Flood 0.40 / Traffic 0.25) in `risk_engine.py` is a
  documented judgment call, not an official standard — change it and cite your reasoning.
- **What-If simulations** are scenario comparisons using the models' learned
  associations, not causal claims — the API response says this explicitly, every time.

## What's still missing before this is "production"

- Authentication/authorization on every endpoint (currently open — fine for a
  student project demo, not for anything real)
- Alembic migrations instead of a single `schema.sql` (fine for now; matters once
  the schema needs to evolve without dropping data)
- The `ingestion` container currently has no restart backoff beyond Docker's own
  `restart: unless-stopped` and no alerting if it stays down — fine for a student
  project, worth hardening (e.g. a healthcheck + external monitor) before anything real
- No historical retention/rollup policy on `weather`/`air_quality` — they'll grow
  unbounded at 20 zones x every 10 minutes; fine for a demo, needs a retention job eventually

## M8 update — SSE live-push endpoint

Added `GET /api/stream/dashboard`, purely additive — `GET /api/dashboard` above is
byte-for-byte unchanged (both now call a shared `_build_dashboard_payload(db)` helper,
so there's no behavioral drift between the polling and push versions).

The stream polls the DB server-side every `SSE_POLL_SECONDS` (default 5) and only pushes
a fresh payload when `MAX(observed_at)` on `weather` has actually changed since the last
push, or `SSE_HEARTBEAT_SECONDS` (default 20) has elapsed with no change — sending an SSE
comment line (`: heartbeat`) otherwise to keep the connection alive without triggering
the frontend's `onmessage`.

**Why polling-the-DB instead of Postgres LISTEN/NOTIFY from the ingestion worker:** the
ingestion worker runs in a separate container (see `docker-compose.yml`) — wiring
cross-process NOTIFY would mean the worker also needs a persistent connection and the
backend needs a listener task, for a modest gain over a handful of cheap `SELECT MAX(...)`
queries every few seconds at this scale (20 zones). Documented tradeoff; revisit if this
ever needs to scale past a student-project deployment.

A bad poll cycle sends an `event: error` SSE frame and keeps the connection open rather
than killing the stream — the frontend surfaces that message but keeps showing the last
good payload underneath it.

