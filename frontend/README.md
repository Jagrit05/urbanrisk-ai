# UrbanRisk AI — Frontend (M7)

React + TypeScript + Tailwind CSS, built with Vite. Implements the spec's 7 pages
(Model Health and Data Health combined into one page, since the spec lists them together)
against the real M5/M6 FastAPI backend — every type in `src/api/types.ts` was matched
field-for-field against the actual backend response shapes, not guessed.

## Command-center redesign (current state)

The frontend is now a dark "smart-city command center" with the **map as the hero**:

- **Command Center (`/`)** — immersive Chennai map with animated risk markers sized/colored
  by the real live score, soft heat-glow underlay, hover tooltips, pulse on High/Critical
  zones, and gray "no data" markers. Left rail: four animated city gauges (Overall / AQI /
  Flood / Traffic, means of the same live per-zone values) + dimension filters that re-encode
  the map. Right rail: watchlist with sparklines and a "top movers" chart driven strictly by
  updates the browser actually received. Clicking a marker opens a rich panel (gauge,
  contributions, live status, expandable technical details, links to forecast/explain) and a
  playback-style 24-hour forecast timeline below.
- **Live Risk Map (`/map`)** — same hero map + category legend + dimension filters + detail panel.
- **Forecasts (`/forecasts`)** — NOW → +6h → +12h → +24h timeline with play/pause stepping,
  real forecast bars, and a live city-trend line built from received SSE frames.
- Explain / What-If / Alerts / Health keep their M7 logic, restyled to the glass theme.

Design tokens/animations live in `tailwind.config.js` + `src/index.css` (glass panels,
`risk-marker-pulse`, `marker-ring`, `data-flash` SSE-change cue, `sweep-line`, all honoring
`prefers-reduced-motion`). Base map tiles: Esri World Dark Gray (keyless). Zone selection is
URL-driven (`?zone=CHN_XYZ`), so map clicks / watchlist clicks / deep links all share state.

**Data honesty is unchanged:** every number still comes from the API/SSE payloads. Sparklines
and the top-movers chart only show frames this browser session actually received — if the
stream has sent one frame, they say so rather than inventing history. The one SSE connection
(`/api/stream/dashboard` via `DashboardStreamProvider`) is still the only live connection the
whole app opens; `/api/risk-map` remains a one-time static geometry fetch.

## Setup

```bash
npm install
cp .env.example .env      # edit VITE_API_BASE_URL if the backend isn't on localhost:8000
npm run dev                # http://localhost:5173
```

Requires the M5/M6 backend running (`docker compose up --build` in `urbanrisk-backend/`)
with CORS already open (`allow_origins=["*"]`) — no proxy config needed for local dev.

## Pages

| Route | Page | Backend endpoint(s) |
|---|---|---|
| `/` | Dashboard | `GET /api/dashboard` |
| `/map` | Live Risk Map (Leaflet) | `GET /api/risk-map` |
| `/forecasts` | Forecasts (Recharts bar chart) | `GET /api/risk-map` (zone list) + `GET /api/forecast/{zone_id}` |
| `/explain` | Explainable AI (SHAP bar chart) | `GET /api/explain/{zone_id}?horizon=` |
| `/what-if` | What-If Simulator | `POST /api/what-if` |
| `/alerts` | Alerts | `GET /api/alerts?min_category=` |
| `/health` | Model / Data Health | `GET /api/model-health` + `GET /api/data-health` |

## Honesty notes carried through from the backend

- Zones with no live observation yet render distinctly (grey/dimmed on the map, a
  separate `zones_missing_live_data` list on the dashboard) — never silently shown as
  Low risk.
- `/api/forecast` and `/api/what-if` surface the backend's real `409` error message
  ("No live observation for X yet…") directly, rather than a generic failure banner.
- The What-If page always displays the backend's disclaimer text verbatim — it is not
  paraphrased or dropped.
- `LiveStatusBadge` shows `LIVE`/`STALE`/`no observation yet` exactly as the backend
  computes it (age vs `STALE_AFTER_MINUTES`), not a frontend-side guess.

## What this milestone does NOT include

- No auth (matches the backend, which also has none yet — noted there as a pre-production gap)
- No offline/optimistic UI — most pages are still plain fetch-on-mount, no caching layer
- No design system beyond Tailwind utility classes — acceptable for a working student
  project dashboard, not a polished production UI

## M8 update — live push (SSE)

The Dashboard page now consumes `GET /api/stream/dashboard` (Server-Sent Events, added to
the backend in M8) via `src/api/useDashboardStream.ts`, instead of a one-time fetch. The
header shows connection status (`Live (SSE)` / `Polling (SSE unavailable)` / reconnecting).

If the SSE connection drops or was never reachable (e.g. a proxy that doesn't support
`text/event-stream`, or the backend restarting), the hook retries once after 5s, then
falls back to plain 15s polling of `GET /api/dashboard` — the page never gets stuck, it
just degrades. Already-loaded data stays on screen through any of this; only the status
indicator changes.

The map page (`/map`) now also consumes this same shared connection (via
`DashboardStreamProvider`/`useDashboardStreamContext`, added in the UI redesign below) to
enrich its popups — so there are still only ever **one** SSE connection open for the whole
app, not one per page.

## UI redesign — "understand it in 10 seconds"

The Dashboard, Live Risk Map, Forecasts, Explainable AI, What-If, and Alerts pages were
redesigned around a plain-language narrative layer instead of raw numbers-first tables.
Nothing below changes an API contract or invents data — every sentence is generated from
real response fields via `src/lib/riskStory.ts`.

- **Dashboard**: hero radial gauge (city-wide mean of the same per-zone `urban_risk_score`
  values shown in the table below — not a separate model), three "what's happening now"
  condition panels (Air quality / Flood / Traffic), a "why is risk at this level" sentence
  generated by comparing the three real `*_risk` values, an "areas to watch" grid (top 4
  zones by risk category then score), and the original full zone table kept below as the
  technical detail level.
- **Live Risk Map**: added a Low→Critical→No data legend, a pulse animation on
  Critical/High markers (respects `prefers-reduced-motion`), and popups enriched with the
  real AQI/flood/traffic breakdown pulled from the shared SSE stream (see above) — the
  `/api/risk-map` endpoint itself is unchanged and still only returns
  `urban_risk_score`/`risk_category`.
- **Forecasts**: reframed as a NOW → +6h → +12h → +24h timeline. "NOW" is the zone's
  current entry from the shared live stream (not a 4th forecast horizon the API doesn't
  provide); if that zone has no live data yet, the NOW card honestly shows "No data"
  instead of a fabricated value. The bar chart gained a custom tooltip that spells out
  real predicted AQI / flood probability / traffic probability per horizon.
- **Explainable AI**: added a plain-language "what's pushing it up / down" summary (top 3
  positive/negative SHAP contributors) above the existing technical chart, which is now
  behind a "View technical SHAP details" toggle — same real `TreeExplainer` values as
  before, just progressive disclosure.
- **What-If**: same form and same `POST /api/what-if` call as before; the result is now a
  current→simulated gauge comparison plus one sentence naming the largest contributor in
  the simulated scenario, generated from the response's actual risk breakdown.
- **Alerts**: restyled as an icon-led list with a real "No active alerts" empty state.
  **Not** rendered as a literal clock-time timeline — `/api/alerts` records a row to the DB
  but never returns a timestamp in its response, so a per-alert time would have to be
  invented. The page says this explicitly rather than faking clock times.
- **Model/Data Health**: left as the deliberately technical page (per the redesign brief),
  just relabeled to "AI Models" / "Data Pipelines & Live Connection".
- **Live clock**: `src/components/LiveClock.tsx` owns its own `setInterval` and state
  entirely inside that one small component — the once-a-second tick re-renders only the
  clock, not the Dashboard or anything above it in the tree.

### What's still just the M7/M8 version

The zone risk table on Dashboard, the health page's technical detail, and the honesty
notes in the section above are unchanged from before this redesign — this was a visual/UX
pass, not a rebuild.

