"""Backend model smoke test — runs in CI and locally without a database.

Loads every M1-M4 artifact exactly like app startup does (ModelRegistry is pure
filesystem + joblib), then runs full predictions through the risk engine for
sample zones across all horizons. Exits non-zero on any failure.

Run:  MODELS_DIR=./model_artifacts python smoke_test.py
"""
import os
import sys

from app.risk_engine import ModelRegistry


def main() -> int:
    models_dir = os.environ.get("MODELS_DIR", "./model_artifacts")
    reg = ModelRegistry(models_dir)
    n_zones = len(reg.zone_static_df)
    assert n_zones > 0, "zone table is empty"

    # Scenario shape mirrors app.main._latest_scenario: flat weather/AQI fields
    # plus a nested "calendar" dict (M4-shaped).
    scenario = {
        "temperature": 30.0,
        "humidity": 70.0,
        "wind_speed": 12.0,
        "pressure": 1008.0,
        "rainfall_rate_mm_per_h": 0.0,
        "AQI": 80.0,
        "PM2_5": 40.0,
        "PM10": 70.0,
        "calendar": {"hour": 10, "day_of_week": 2, "is_weekend": 0},
    }

    results = {}
    zones_checked = 0
    for zone_id in list(reg.zone_static_df.index)[:5]:
        for aqi_h, flood_h, traffic_h in [(6, 6, 1), (12, 12, 2), (24, 6, 1)]:
            result = reg.run_full_prediction(
                zone_id, scenario, aqi_horizon=aqi_h, flood_horizon=flood_h, traffic_horizon=traffic_h
            )
            for key in ("aqi_risk", "flood_risk", "traffic_risk", "risk_category", "urban_risk_score"):
                assert key in result, f"missing {key} in result for {zone_id}"
            assert 0 <= result["urban_risk_score"] <= 100, "urban risk out of range"
            results[(zone_id, aqi_h)] = result["urban_risk_score"]
        zones_checked += 1

    print(f"model smoke test OK — {n_zones} zones available, {zones_checked} exercised, "
          f"urban risk scores: {dict(list(results.items())[:3])} ...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
