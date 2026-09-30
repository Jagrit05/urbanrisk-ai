"""Populates the DB from what the ModelRegistry loaded — runs once at startup.
Idempotent: safe to call every time the service restarts."""
import os
import math
import pandas as pd
from sqlalchemy import text
from datetime import datetime, timezone


def _clean(v):
    """NaN/NaT -> None so psycopg2 doesn't choke on them."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def seed_locations(db, registry):
    for _, row in registry.zone_static_df.iterrows():
        db.execute(
            text("""
                INSERT INTO locations (zone_id, zone_name, latitude, longitude, elevation_m,
                    water_body_distance_km, historical_inundation_count, historical_max_depth_in,
                    historical_mean_depth_in, road_density_score, distance_to_congestion_hotspot_km)
                VALUES (:zone_id, :zone_name, :latitude, :longitude, :elevation_m,
                    :water_body_distance_km, :historical_inundation_count, :historical_max_depth_in,
                    :historical_mean_depth_in, :road_density_score, :distance_to_congestion_hotspot_km)
                ON CONFLICT (zone_id) DO UPDATE SET
                    zone_name = EXCLUDED.zone_name,
                    elevation_m = EXCLUDED.elevation_m,
                    water_body_distance_km = EXCLUDED.water_body_distance_km,
                    historical_inundation_count = EXCLUDED.historical_inundation_count,
                    historical_max_depth_in = EXCLUDED.historical_max_depth_in,
                    historical_mean_depth_in = EXCLUDED.historical_mean_depth_in,
                    road_density_score = EXCLUDED.road_density_score,
                    distance_to_congestion_hotspot_km = EXCLUDED.distance_to_congestion_hotspot_km
            """),
            {
                "zone_id": row["zone_id"], "zone_name": row["zone_name"],
                "latitude": _clean(row.get("latitude")), "longitude": _clean(row.get("longitude")),
                "elevation_m": _clean(row.get("elevation_m")),
                "water_body_distance_km": _clean(row.get("water_body_distance_km")),
                "historical_inundation_count": _clean(row.get("historical_inundation_count")),
                "historical_max_depth_in": _clean(row.get("historical_max_depth_in")),
                "historical_mean_depth_in": _clean(row.get("historical_mean_depth_in")),
                "road_density_score": _clean(row.get("road_density_score")),
                "distance_to_congestion_hotspot_km": _clean(row.get("distance_to_congestion_hotspot_km")),
            },
        )
    db.commit()


def seed_incidents(db, registry):
    """Loads the real GCC inundation points (M2) if the raw CSV is present alongside
    the flood model artifacts. Optional — skipped with a printed note if absent."""
    path = os.path.join(registry.models_dir, "flood", "gcc_inundation_points_raw.csv")
    if not os.path.exists(path):
        print(f"[seed] gcc_inundation_points_raw.csv not found at {path} — skipping incidents seed (optional).")
        return

    existing = db.execute(text("SELECT COUNT(*) FROM incidents")).scalar()
    if existing and existing > 0:
        return  # already seeded

    df = pd.read_csv(path)
    for _, row in df.iterrows():
        db.execute(
            text("""
                INSERT INTO incidents (source, latitude, longitude, depth_inches, remarks)
                VALUES ('GCC_inundation_points', :lat, :lon, :depth, :remarks)
            """),
            {
                "lat": _clean(row.get("latitude")), "lon": _clean(row.get("longitude")),
                "depth": _clean(row.get("depth_inches")), "remarks": row.get("remarks"),
            },
        )
    db.commit()
    print(f"[seed] Loaded {len(df)} real GCC inundation points into `incidents`.")


def seed_model_runs(db, registry):
    """Records exactly what's loaded and how it was selected — read from the real
    metadata files, not hand-typed, so this can never silently drift from the truth."""
    db.execute(text("DELETE FROM model_runs"))  # this table reflects "what's loaded right now"

    def _train_range(meta):
        r = meta.get("train_range") or meta.get("test_range")
        if not r or len(r) != 2:
            return None, None
        return r[0], r[1]

    # AQI — always XGBoost, one per horizon, no alternative-model comparison exists for it
    start, end = _train_range(registry.aqi_metadata)
    for h in [6, 12, 24]:
        db.execute(
            text("""INSERT INTO model_runs (model_family, horizon_hours, algorithm,
                     selected_for_serving, test_metrics, train_range_start, train_range_end,
                     source_metadata_file)
                     VALUES ('aqi', :h, 'xgboost', true, :metrics, :start, :end, 'model_metadata_multizone.json')"""),
            {"h": h, "metrics": __import__("json").dumps(registry.aqi_metadata.get("test_metrics_overall", {})),
             "start": start, "end": end},
        )

    # Flood — log all three candidates per horizon, flag which one is actually serving
    start, end = _train_range(registry.flood_metadata)
    for h in [6, 12]:
        selected = registry.flood_best_algo[h]
        for algo in ["logreg", "rf", "xgboost"]:
            key = f"{algo}_{h}h"
            metrics = registry.flood_metadata.get("test_metrics", {}).get(key, {})
            db.execute(
                text("""INSERT INTO model_runs (model_family, horizon_hours, algorithm,
                         selected_for_serving, test_metrics, train_range_start, train_range_end,
                         source_metadata_file)
                         VALUES ('flood', :h, :algo, :selected, :metrics, :start, :end, 'flood_model_metadata.json')"""),
                {"h": h, "algo": algo, "selected": (algo == selected),
                 "metrics": __import__("json").dumps(metrics), "start": start, "end": end},
            )

    # Traffic — same pattern
    start, end = _train_range(registry.traffic_metadata)
    for h in [1, 2]:
        selected = registry.traffic_best_algo[h]
        for algo in ["logreg", "rf", "xgboost"]:
            key = f"{algo}_{h}h"
            metrics = registry.traffic_metadata.get("test_metrics", {}).get(key, {})
            db.execute(
                text("""INSERT INTO model_runs (model_family, horizon_hours, algorithm,
                         selected_for_serving, test_metrics, train_range_start, train_range_end,
                         source_metadata_file)
                         VALUES ('traffic', :h, :algo, :selected, :metrics, :start, :end, 'traffic_model_metadata.json')"""),
                {"h": h, "algo": algo, "selected": (algo == selected),
                 "metrics": __import__("json").dumps(metrics), "start": start, "end": end},
            )
    db.commit()


def run_all_seeds(db, registry):
    seed_locations(db, registry)
    seed_incidents(db, registry)
    seed_model_runs(db, registry)
    print(f"[seed] Done — {len(registry.zone_static_df)} zones, model_runs populated from real metadata.")
