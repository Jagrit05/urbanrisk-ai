# UrbanRisk AI — Chennai Urban Intelligence Platform

Monorepo containing the full UrbanRisk AI stack: a FastAPI + XGBoost prediction
backend and a React "smart-city command center" frontend, connected over a single
live Server-Sent Events stream.

```
urbanrisk/
├── backend/    # FastAPI API + ingestion worker + ML models + Postgres (Docker)
├── frontend/   # React + TypeScript + Vite dashboard (map-hero command center)
└── training/   # M1–M4 training notebooks + artifacts behind the served models
```

## Quick start

**1. Backend** (requires Docker):

```bash
cd backend
docker compose up --build
# API on http://localhost:8000 — docs at http://localhost:8000/docs
# Postgres on localhost:5432 (user/pass/db: urbanrisk)
```

The compose file serves the pre-trained models from `backend/model_artifacts/`
(aqi / flood / traffic). The ingestion worker polls live data sources every
10 minutes; until it completes its first cycle, endpoints return the backend's
informative "no live observation yet" responses rather than errors.

**2. Frontend** (requires Node 18+):

```bash
cd frontend
npm install
cp .env.example .env      # defaults to http://localhost:8000
npm run dev               # http://localhost:5173
```

Open the Command Center and you should see the LIVE (SSE) indicator turn green
within a few seconds of the backend starting.

## What each part does

| Folder | Stack | Details |
|---|---|---|
| `backend/` | FastAPI, SQLAlchemy, Postgres 16, XGBoost/sklearn, APScheduler | REST API (`/api/*`), SSE stream (`/api/stream/dashboard`), ingestion worker, model registry & explainability (SHAP) |
| `frontend/` | React 18, TypeScript, Vite, Tailwind, Leaflet, Recharts | Command-center dashboard with hero map, animated gauges, forecast playback timeline, live charts |
| `training/` | Jupyter notebooks (M1–M4) | AQI / flood / traffic model training + the M4 risk engine; produces the `.joblib` artifacts the backend serves |

See `backend/README.md`, `frontend/README.md`, and `training/README.md` for full
documentation, endpoint lists, and architecture notes.
