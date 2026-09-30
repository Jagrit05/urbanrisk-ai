"""
UrbanRisk AI — M5: FastAPI backend.

Endpoints match the original spec:
  GET  /api/dashboard
  GET  /api/forecast/{location_id}
  GET  /api/risk-map
  GET  /api/explain/{location_id}
  POST /api/what-if
  GET  /api/alerts
  GET  /api/model-health
  GET  /api/data-health

Plus one dev-only endpoint (clearly marked, not part of the original spec) to seed a
test observation before M6's live ingestion exists:
  POST /api/dev/seed-observation

HONESTY NOTE carried from M2-M4: every endpoint below that needs "current conditions"
reads the latest row from weather/air_quality/traffic. Until something inserts rows
there (M6, or the dev seed endpoint), that read comes back empty — and the endpoint
says so plainly instead of fabricating a number.
"""
import os
import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import get_db, init_schema, SessionLocal
from .risk_engine import ModelRegistry
from .model_loader import run_all_seeds
from .schemas import SeedObservationRequest, WhatIfRequest

MODELS_DIR = os.environ.get("MODELS_DIR", "/app/model_artifacts")

# M6: an observation older than this is flagged stale rather than trusted silently.
# 3x the ingestion interval gives room for one missed cycle before warning.
STALE_AFTER_MINUTES = int(os.environ.get("STALE_AFTER_MINUTES", "30"))

# M8: SSE push layer. Polls the DB server-side and only pushes a fresh payload when
# something actually changed (or the heartbeat interval elapses) — the ingestion worker
# runs in a separate container (see docker-compose.yml), so this avoids needing
# cross-process signaling (e.g. Postgres LISTEN/NOTIFY) for what is, at this scale, a
# handful of cheap queries every few seconds. Documented tradeoff, not an oversight.
SSE_POLL_SECONDS = float(os.environ.get("SSE_POLL_SECONDS", "5"))
SSE_HEARTBEAT_SECONDS = float(os.environ.get("SSE_HEARTBEAT_SECONDS", "20"))

app = FastAPI(title="UrbanRisk AI API", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

registry: Optional[ModelRegistry] = None

PRESET_SCENARIOS = {
    "typical_dry_midday": {
        "AQI": 95, "PM2_5": 45, "PM10": 80, "temperature": 31, "humidity": 55,
        "wind_speed": 12, "pressure": 1008, "rainfall_rate_mm_per_h": 0.0,
    },
    "evening_rush_moderate_rain": {
        "AQI": 130, "PM2_5": 65, "PM10": 110, "temperature": 27, "humidity": 85,
        "wind_speed": 18, "pressure": 1002, "rainfall_rate_mm_per_h": 8.0,
    },
    "northeast_monsoon_heavy_rain": {
        "AQI": 60, "PM2_5": 25, "PM10": 40, "temperature": 25, "humidity": 95,
        "wind_speed": 25, "pressure": 998, "rainfall_rate_mm_per_h": 25.0,
    },
}


@app.on_event("startup")
def startup():
    global registry
    init_schema()
    registry = ModelRegistry(MODELS_DIR)
    db = SessionLocal()
    try:
        run_all_seeds(db, registry)
    finally:
        db.close()
    print(f"[startup] Loaded {len(registry.zone_static_df)} zones and all M1-M4 model artifacts.")

    # The M6 ingestion loop runs in a daemon thread inside this process by default;
    # docker-compose sets ENABLE_INGESTION=0 and keeps the dedicated worker container.
    if os.environ.get("ENABLE_INGESTION", "1").lower() in ("1", "true", "yes"):
        _start_embedded_ingestion()


def _start_embedded_ingestion():
    """Run the M6 ingestion loop as a daemon thread inside the API process.

    On by default so single-service hosts (Render's free tier allows one web
    service) actually receive live observations; docker-compose sets
    ENABLE_INGESTION=0 and runs the dedicated worker container instead. Same
    run_one_cycle, same per-zone failure handling: a failed fetch is skipped,
    never fabricated.
    """
    import threading
    import time
    import traceback

    from .ingestion.worker import run_one_cycle, INTERVAL_MINUTES

    def _loop():
        print(f"[ingestion] embedded worker starting - polling every {INTERVAL_MINUTES} minutes")
        while True:
            db = SessionLocal()
            try:
                run_one_cycle(db)
            except Exception:
                print("[ingestion] cycle raised an unexpected exception:")
                traceback.print_exc()
            finally:
                db.close()
            time.sleep(INTERVAL_MINUTES * 60)

    threading.Thread(target=_loop, name="ingestion-worker", daemon=True).start()


def _require_registry():
    if registry is None:
        raise HTTPException(503, "Model registry not loaded yet — server is still starting.")
    return registry


def _calendar_from_ts(ts: datetime) -> dict:
    return {
        "hour": ts.hour, "day_of_week": ts.weekday(), "month": ts.month,
        "is_weekend": int(ts.weekday() >= 5),
    }


def _liveness(observed_at: datetime) -> dict:
    """M6: turns a raw observed_at timestamp into the LIVE/STALE + age info the
    original spec asked the dashboard to show."""
    now = datetime.now(timezone.utc)
    age_minutes = (now - observed_at).total_seconds() / 60.0
    is_stale = age_minutes > STALE_AFTER_MINUTES
    return {
        "observed_at": observed_at.isoformat(),
        "age_minutes": round(age_minutes, 1),
        "status": "STALE" if is_stale else "LIVE",
        "is_stale": is_stale,
    }


def _latest_scenario(db: Session, zone_id: str) -> Optional[dict]:
    """Builds an M4-shaped scenario dict from the latest weather + air_quality rows
    for this zone. Returns None if either is missing — callers must handle that as
    'no live data yet', not fall back to a guess."""
    weather = db.execute(
        text("""SELECT * FROM weather WHERE zone_id = :z ORDER BY observed_at DESC LIMIT 1"""),
        {"z": zone_id},
    ).mappings().first()
    aq = db.execute(
        text("""SELECT * FROM air_quality WHERE zone_id = :z ORDER BY observed_at DESC LIMIT 1"""),
        {"z": zone_id},
    ).mappings().first()

    if weather is None or aq is None:
        return None

    ts = weather["observed_at"]
    return {
        "AQI": aq["aqi"], "PM2_5": aq["pm2_5"], "PM10": aq["pm10"],
        "temperature": weather["temperature"], "humidity": weather["humidity"],
        "wind_speed": weather["wind_speed"], "pressure": weather["pressure"],
        "rainfall_rate_mm_per_h": weather["rainfall_mm"],
        "calendar": _calendar_from_ts(ts),
        "_observed_at": ts.isoformat(),
    }


# ---------------------------------------------------------------------------
def _build_dashboard_payload(db: Session) -> dict:
    """Extracted from the /api/dashboard route so M8's SSE stream can reuse the exact
    same logic — no behavior drift between the polling and push versions."""
    reg = _require_registry()
    zones_with_data, zones_without_data = [], []

    for z in reg.list_zones():
        zone_id = z["zone_id"]
        scenario = _latest_scenario(db, zone_id)
        if scenario is None:
            zones_without_data.append(zone_id)
            continue
        result = reg.run_full_prediction(zone_id, scenario)
        result.update(_liveness(datetime.fromisoformat(scenario["_observed_at"])))
        zones_with_data.append(result)

    return {
        "zones": sorted(zones_with_data, key=lambda r: -r["urban_risk_score"]),
        "zones_missing_live_data": zones_without_data,
        "note": (
            "Zones in `zones_missing_live_data` have no weather+air_quality observation "
            "yet — that's expected until M6's live ingestion runs, or use "
            "POST /api/dev/seed-observation to test."
        ) if zones_without_data else None,
    }


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    return _build_dashboard_payload(db)


# ---------------------------------------------------------------------------
# M8: live push layer. Same payload shape as GET /api/dashboard, delivered as
# Server-Sent Events so the frontend doesn't have to poll. Purely additive —
# /api/dashboard above is untouched and still works exactly as it did in M5/M6.
async def _dashboard_event_stream():
    last_fingerprint = None
    last_sent_at = 0.0
    loop = asyncio.get_event_loop()
    while True:
        db = SessionLocal()
        try:
            # Cheap fingerprint: has any zone's weather changed since we last pushed?
            fingerprint = db.execute(text("SELECT MAX(observed_at) FROM weather")).scalar()
            now = loop.time()
            should_send = (
                fingerprint != last_fingerprint
                or (now - last_sent_at) >= SSE_HEARTBEAT_SECONDS
            )
            if should_send:
                payload = _build_dashboard_payload(db)
                yield f"data: {json.dumps(payload, default=str)}\n\n"
                last_fingerprint = fingerprint
                last_sent_at = now
            else:
                # SSE comment line — keeps proxies/browsers from timing out the
                # connection during quiet periods, without triggering onmessage.
                yield ": heartbeat\n\n"
        except Exception as e:
            # Don't let one bad poll kill the whole stream — surface it as an SSE
            # event the frontend can show, then keep trying on the next cycle.
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n"
        finally:
            db.close()
        await asyncio.sleep(SSE_POLL_SECONDS)


@app.get("/api/stream/dashboard")
async def stream_dashboard():
    _require_registry()  # fail fast with the same 503 as /api/dashboard if not ready
    return StreamingResponse(
        _dashboard_event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering if ever deployed behind one
        },
    )


@app.get("/api/forecast/{location_id}")
def forecast(location_id: str, db: Session = Depends(get_db)):
    reg = _require_registry()
    try:
        reg.zone_row(location_id)
    except KeyError:
        raise HTTPException(404, f"Unknown zone_id: {location_id}")

    scenario = _latest_scenario(db, location_id)
    if scenario is None:
        raise HTTPException(
            409,
            f"No live weather+air_quality observation for {location_id} yet. "
            f"M6 hasn't run, or seed one via POST /api/dev/seed-observation.",
        )

    forecasts = []
    for aqi_h, flood_h, traffic_h in [(6, 6, 1), (12, 12, 2), (24, 12, 2)]:
        result = reg.run_full_prediction(location_id, scenario, aqi_h, flood_h, traffic_h)
        forecasts.append(result)

    # log every forecast run for later drift/health analysis
    for r in forecasts:
        db.execute(
            text("""INSERT INTO predictions (zone_id, horizon_hours, aqi_predicted, aqi_risk,
                     flood_model_used, flood_probability, flood_risk, traffic_model_used,
                     traffic_probability, traffic_risk, urban_risk_score, risk_category, input_source)
                     VALUES (:zone_id, :h, :aqi_pred, :aqi_risk, :flood_model, :flood_prob, :flood_risk,
                     :traffic_model, :traffic_prob, :traffic_risk, :urs, :cat, 'live_observation')"""),
            {"zone_id": location_id, "h": r["aqi_horizon_hours"], "aqi_pred": r["predicted_aqi"],
             "aqi_risk": r["aqi_risk"], "flood_model": r["flood_model_used"], "flood_prob": r["flood_probability"],
             "flood_risk": r["flood_risk"], "traffic_model": r["traffic_model_used"],
             "traffic_prob": r["traffic_probability"], "traffic_risk": r["traffic_risk"],
             "urs": r["urban_risk_score"], "cat": r["risk_category"]},
        )
    db.commit()

    liveness = _liveness(datetime.fromisoformat(scenario["_observed_at"]))
    return {"zone_id": location_id, **liveness, "forecasts": forecasts}


@app.get("/api/risk-map")
def risk_map(db: Session = Depends(get_db)):
    reg = _require_registry()
    points = []
    for z in reg.list_zones():
        zone_id = z["zone_id"]
        scenario = _latest_scenario(db, zone_id)
        point = {"zone_id": zone_id, "zone_name": z["zone_name"], "latitude": z["latitude"], "longitude": z["longitude"]}
        if scenario is None:
            point.update({"urban_risk_score": None, "risk_category": None, "has_live_data": False, "status": "NO_DATA"})
        else:
            result = reg.run_full_prediction(zone_id, scenario)
            liveness = _liveness(datetime.fromisoformat(scenario["_observed_at"]))
            point.update({
                "urban_risk_score": result["urban_risk_score"],
                "risk_category": result["risk_category"],
                "has_live_data": True,
                **liveness,
            })
        points.append(point)
    return {"points": points}


@app.get("/api/explain/{location_id}")
def explain(location_id: str, horizon: int = 6, db: Session = Depends(get_db)):
    """SHAP explanation for the AQI prediction at this zone."""

    import pandas as pd
    import xgboost as xgb

    reg = _require_registry()

    # ---------------------------------------------------------
    # 1. Validate zone
    # ---------------------------------------------------------
    try:
        zrow = reg.zone_row(location_id)
    except KeyError:
        raise HTTPException(
            404,
            f"Unknown zone_id: {location_id}"
        )

    # ---------------------------------------------------------
    # 2. Get latest live scenario
    # ---------------------------------------------------------
    scenario = _latest_scenario(db, location_id)

    if scenario is None:
        raise HTTPException(
            409,
            f"No live observation for {location_id} yet — nothing to explain."
        )

    # ---------------------------------------------------------
    # 3. Validate horizon
    # ---------------------------------------------------------
    if horizon not in reg.aqi_models:
        raise HTTPException(
            400,
            f"horizon must be one of {list(reg.aqi_models.keys())}"
        )

    # ---------------------------------------------------------
    # 4. Load model and feature metadata
    # ---------------------------------------------------------
    model = reg.aqi_models[horizon]
    cols = reg.aqi_metadata["feature_columns"]

    from .risk_engine import build_feature_row

    row = build_feature_row(
        cols,
        scenario,
        zrow
    )

    X = pd.DataFrame([row])[cols].copy()

    # ---------------------------------------------------------
    # 5. IMPORTANT:
    # AQI XGBoost was trained with zone_id as categorical.
    # Keep zone_id as pandas Categorical.
    # ---------------------------------------------------------
    if "zone_id" in X.columns:
        X["zone_id"] = pd.Categorical(
            X["zone_id"],
            categories=reg.aqi_metadata["zone_ids"]
        )

    # ---------------------------------------------------------
    # 6. Native XGBoost SHAP contributions
    # ---------------------------------------------------------
    booster = model.get_booster()

    dmatrix = xgb.DMatrix(
        X,
        enable_categorical=True
    )

    contribs = booster.predict(
        dmatrix,
        pred_contribs=True
    )[0]

    # Last value = base value / bias contribution
    shap_contributions = contribs[:-1]

    # ---------------------------------------------------------
    # 7. Predict AQI
    # ---------------------------------------------------------
    pred_aqi = float(
    booster.predict(dmatrix)[0]
)

    # ---------------------------------------------------------
    # 8. Build top SHAP factors
    # ---------------------------------------------------------
    contributions = sorted(
        [
            {
                "feature": f,

                "value": (
                    str(X.iloc[0][f])
                    if f == "zone_id"
                    else float(X.iloc[0][f])
                    if f in X.columns
                    else None
                ),

                "shap_contribution": float(v),
            }
            for f, v in zip(
                cols,
                shap_contributions
            )
        ],
        key=lambda r: -abs(
            r["shap_contribution"]
        ),
    )[:10]

    # ---------------------------------------------------------
    # 9. Return response
    # ---------------------------------------------------------
    return {
        "zone_id": location_id,
        "horizon_hours": horizon,
        "predicted_aqi": round(pred_aqi, 1),
        "top_factors": contributions,
    }

@app.post("/api/what-if")
def what_if(req: WhatIfRequest, db: Session = Depends(get_db)):
    """Scenario simulation: current conditions vs a hypothetical override.
    Explicitly NOT a causal claim — the response says so, per the original spec."""
    reg = _require_registry()
    try:
        reg.zone_row(req.zone_id)
    except KeyError:
        raise HTTPException(404, f"Unknown zone_id: {req.zone_id}")

    current = _latest_scenario(db, req.zone_id)
    if current is None:
        raise HTTPException(409, f"No live observation for {req.zone_id} yet — nothing to simulate against.")

    simulated = dict(current)
    for field in ["rainfall_rate_mm_per_h", "temperature", "humidity", "wind_speed", "pressure"]:
        override = getattr(req, field)
        if override is not None:
            simulated[field] = override
    if req.aqi is not None:
        simulated["AQI"] = req.aqi
    if req.pm2_5 is not None:
        simulated["PM2_5"] = req.pm2_5
    if req.pm10 is not None:
        simulated["PM10"] = req.pm10

    current_result = reg.run_full_prediction(req.zone_id, current)
    simulated_result = reg.run_full_prediction(req.zone_id, simulated)

    return {
        "zone_id": req.zone_id,
        "disclaimer": (
            "This is a scenario simulation using the trained models' learned associations, "
            "not a causal claim — changing rainfall in this tool does not mean rainfall causes "
            "exactly this change in the real world."
        ),
        "current": current_result,
        "simulated": simulated_result,
        "delta_urban_risk_score": round(simulated_result["urban_risk_score"] - current_result["urban_risk_score"], 1),
    }


@app.get("/api/alerts")
def alerts(min_category: str = "High", db: Session = Depends(get_db)):
    reg = _require_registry()
    order = ["Low", "Moderate", "Elevated", "High", "Critical"]
    if min_category not in order:
        raise HTTPException(400, f"min_category must be one of {order}")
    min_idx = order.index(min_category)

    triggered = []
    for z in reg.list_zones():
        zone_id = z["zone_id"]
        scenario = _latest_scenario(db, zone_id)
        if scenario is None:
            continue
        result = reg.run_full_prediction(zone_id, scenario)
        if order.index(result["risk_category"]) >= min_idx:
            triggered.append(result)
            db.execute(
                text("""INSERT INTO alerts (zone_id, urban_risk_score, risk_category, message)
                         VALUES (:z, :s, :c, :m)"""),
                {"z": zone_id, "s": result["urban_risk_score"], "c": result["risk_category"],
                 "m": f"{result['zone_name']}: urban risk score {result['urban_risk_score']} ({result['risk_category']})"},
            )
    db.commit()

    return {"min_category": min_category, "alerts": sorted(triggered, key=lambda r: -r["urban_risk_score"])}


@app.get("/api/model-health")
def model_health(db: Session = Depends(get_db)):
    rows = db.execute(text("""SELECT model_family, horizon_hours, algorithm, selected_for_serving,
                                      test_metrics, train_range_start, train_range_end, loaded_at,
                                      source_metadata_file
                               FROM model_runs ORDER BY model_family, horizon_hours, algorithm""")).mappings().all()
    return {"models": [dict(r) for r in rows]}


@app.get("/api/data-health")
def data_health(db: Session = Depends(get_db)):
    reg = _require_registry()
    sources = db.execute(text("SELECT * FROM data_sources")).mappings().all()

    # Live staleness computed here (age vs STALE_AFTER_MINUTES), not just the stored
    # 'status' column — so this reflects reality even if the ingestion worker itself
    # has silently died since its last successful write.
    enriched_sources = []
    for s in sources:
        s = dict(s)
        if s["last_updated"] is not None:
            s.update(_liveness(s["last_updated"]))
        else:
            s.update({"status": "not_yet_connected", "is_stale": None, "age_minutes": None})
        enriched_sources.append(s)

    zones_with_any_weather = db.execute(text("SELECT COUNT(DISTINCT zone_id) FROM weather")).scalar()
    zones_with_recent_weather = db.execute(
        text("SELECT COUNT(DISTINCT zone_id) FROM weather WHERE observed_at > now() - make_interval(mins => :m)"),
        {"m": STALE_AFTER_MINUTES},
    ).scalar()
    total_zones = len(reg.zone_static_df)

    return {
        "sources": enriched_sources,
        "stale_after_minutes": STALE_AFTER_MINUTES,
        "zones_with_any_weather_observation": zones_with_any_weather,
        "zones_with_recent_weather": zones_with_recent_weather,
        "total_zones": total_zones,
        "note": (
            f"{zones_with_recent_weather}/{total_zones} zones have a weather observation within "
            f"the last {STALE_AFTER_MINUTES} minutes. If this is 0, either the ingestion worker "
            f"hasn't completed its first cycle yet, or it's failing — check its container logs."
        ),
    }


# ---------------------------------------------------------------------------
# DEV-ONLY — not part of the original spec's endpoint list. Lets you exercise the
# whole stack before M6 exists. Remove or auth-gate this before any real deployment.
@app.post("/api/dev/seed-observation")
def dev_seed_observation(req: SeedObservationRequest, db: Session = Depends(get_db)):
    reg = _require_registry()
    try:
        reg.zone_row(req.zone_id)
    except KeyError:
        raise HTTPException(404, f"Unknown zone_id: {req.zone_id}")

    if req.custom_scenario:
        s = req.custom_scenario
    elif req.scenario_name and req.scenario_name in PRESET_SCENARIOS:
        s = PRESET_SCENARIOS[req.scenario_name]
    else:
        raise HTTPException(400, f"Provide scenario_name (one of {list(PRESET_SCENARIOS)}) or custom_scenario.")

    now = datetime.now(timezone.utc)
    db.execute(
        text("""INSERT INTO weather (zone_id, observed_at, temperature, humidity, pressure, rainfall_mm, wind_speed, source)
                 VALUES (:z, :t, :temp, :hum, :pres, :rain, :wind, 'dev_seed')
                 ON CONFLICT (zone_id, observed_at, source) DO NOTHING"""),
        {"z": req.zone_id, "t": now, "temp": s["temperature"], "hum": s["humidity"],
         "pres": s["pressure"], "rain": s["rainfall_rate_mm_per_h"], "wind": s["wind_speed"]},
    )
    db.execute(
        text("""INSERT INTO air_quality (zone_id, observed_at, aqi, pm2_5, pm10, source)
                 VALUES (:z, :t, :aqi, :pm25, :pm10, 'dev_seed')
                 ON CONFLICT (zone_id, observed_at, source) DO NOTHING"""),
        {"z": req.zone_id, "t": now, "aqi": s["AQI"], "pm25": s["PM2_5"], "pm10": s["PM10"]},
    )
    db.commit()
    return {"status": "seeded", "zone_id": req.zone_id, "observed_at": now.isoformat(), "scenario": s}


@app.get("/")
def root():
    return {"service": "UrbanRisk AI API", "docs": "/docs"}
