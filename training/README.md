# Model Training — Milestones M1–M4

The code and artifacts behind the models served by `backend/` (M5–M8).
Everything here is reproducible end-to-end: run the notebooks in order and you
regenerate the `.joblib` files the API loads.

## Notebooks (`notebooks/`)

Run in milestone order:

| # | Notebook | What it does |
|---|----------|--------------|
| M1 | `01_M1_chennai_aqi_baseline.ipynb` | Single-zone AQI baseline — establishes data joins, feature lags, and evaluation protocol |
| M1 | `02_M1_multizone_chennai_aqi.ipynb` | Multi-zone AQI models (XGBoost, +6h/+12h/+24h horizons) — the models the API serves |
| M2 | `03_M2_chennai_flood_model.ipynb` | Flood probability models vs IMD rainfall thresholds + GCC inundation history (XGBoost / RF / LogReg per horizon) |
| M3 | `M3_traffic_congestion_model.ipynb` | Traffic congestion probability models from congestion patterns + road features |
| M4 | `M4_urban_risk_engine.ipynb` | Combines the three signal risks into the 0–100 urban risk score and Low→Critical categories |

> `Copy of M4_urban_risk_engine.ipynb` and `M3_traffic_congestion_model (1).ipynb`
> from the source folder were duplicate drafts and are not included.

## Artifacts (`artifacts/`)

The trained outputs the notebooks produce — the same files `backend/model_artifacts/`
serves in Docker (the `risk/` folder is consumed by M4's risk engine logic):

```
artifacts/
├── aqi/       aqi_xgboost_multizone_{6,12,24}h.joblib + metrics + zone list
├── flood/     flood_{xgboost,rf,logreg}_{6,12}h.joblib + metadata + static features
├── traffic/   congestion_{xgboost,rf,logreg}_{1,2}h.joblib + metadata + road features
└── risk/      isolation-forest anomaly demo + risk engine metadata + demo scenarios
```

## Relationship to the backend

`backend/app/model_loader.py` loads the aqi/flood/traffic joblibs at startup
(MODELS_DIR=/app/model_artifacts in Docker), and `backend/app/risk_engine.py`
implements the M4 score fusion. Retrain → copy the new joblibs into
`backend/model_artifacts/` → restart the backend container.

## Data

Notebooks read live/observed Chennai data (Open-Meteo weather+AQI, IMD rainfall
thresholds, GCC flood points) at run time; no large raw datasets are committed.
