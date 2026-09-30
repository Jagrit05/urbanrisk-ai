"""
UrbanRisk AI — risk engine.

This is a direct port of the M4 Colab notebook's logic (model loading, the generic
feature-row builder, per-signal prediction functions, and score combination) into a
service class that FastAPI loads once at startup and reuses across requests.

Nothing about the modeling logic changes here versus M4 — only *where* it runs.
The same honesty notes from M4 still apply:
  1. Flood/traffic model selection is argmax test ROC-AUC per horizon, read from each
     milestone's own saved metadata — never assumed.
  2. AQI risk = min(100, predicted_AQI / 5), a linear rescale of the existing 0-500 index.
  3. zone_id for XGBoost models assumes pandas' default category encoding (alphabetically
     sorted unique zone_id strings) — this is verified against the loaded metadata's
     zone_ids list, not re-derived by guessing.
  4. RISK_WEIGHTS below is a documented judgment call, not an official standard.
"""
import os
import re
import json
import joblib
import numpy as np
import pandas as pd


RISK_WEIGHTS = {"aqi": 0.35, "flood": 0.40, "traffic": 0.25}

RISK_CATEGORIES = [
    (20, "Low"),
    (40, "Moderate"),
    (60, "Elevated"),
    (80, "High"),
    (100, "Critical"),
]


def categorize_risk(score: float) -> str:
    for threshold, label in RISK_CATEGORIES:
        if score <= threshold:
            return label
    return "Critical"


def aqi_to_risk(predicted_aqi: float) -> float:
    return float(np.clip(predicted_aqi / 5.0, 0, 100))


def prob_to_risk(predicted_prob: float) -> float:
    return float(np.clip(predicted_prob * 100.0, 0, 100))


def combine_urban_risk(aqi_risk, flood_risk, traffic_risk, weights=RISK_WEIGHTS):
    total = (
        weights["aqi"] * aqi_risk
        + weights["flood"] * flood_risk
        + weights["traffic"] * traffic_risk
    )
    total = float(np.clip(total, 0, 100))
    return total, categorize_risk(total)


def _parse_feature_name(name):
    m = re.match(r"^(.*)_lag(\d+)h$", name)
    if m:
        return m.group(1), "lag"
    m = re.match(r"^(.*)_rollmean(\d+)h$", name)
    if m:
        return m.group(1), "rollmean"
    m = re.match(r"^(.*)_rollstd(\d+)h$", name)
    if m:
        return m.group(1), "rollstd"
    m = re.match(r"^rainfall_past_(\d+)h$", name)
    if m:
        return "rainfall", ("sum", int(m.group(1)))
    m = re.match(r"^rainfall_(\d+)h$", name)
    if m:
        return "rainfall", ("sum", int(m.group(1)))
    return name, "raw"


def build_feature_row(feature_columns, scenario, zone_row):
    """scenario: dict of base signal values (AQI, PM2_5, PM10, temperature, humidity,
    wind_speed, pressure, rainfall_rate_mm_per_h) + a 'calendar' sub-dict (hour,
    day_of_week, month, is_weekend). zone_row: a dict/Series of static per-zone
    evidence (elevation, water distance, historical inundation, road density, ...)."""
    row = {}
    for col in feature_columns:
        if col == "zone_id":
            row[col] = zone_row["zone_id"]  # resolved to a code later, per model
        elif col in ("latitude", "longitude"):
            row[col] = zone_row[col]
        elif col in scenario.get("calendar", {}):
            row[col] = scenario["calendar"][col]
        elif col in zone_row and zone_row[col] is not None:
            row[col] = zone_row[col]
        else:
            base, kind = _parse_feature_name(col)
            if isinstance(kind, tuple) and kind[0] == "sum":
                row[col] = scenario.get("rainfall_rate_mm_per_h", 0.0) * kind[1]
            elif kind == "rollstd":
                row[col] = scenario.get(f"{base}_std", 0.0)
            elif kind in ("lag", "rollmean", "raw"):
                row[col] = scenario.get(base, scenario.get(col, 0.0))
            else:
                row[col] = 0.0
    return row


def _get_ci(d, key):
    """Case-insensitive dict lookup (M2 metadata used 'ROC_AUC', M3 used 'roc_auc')."""
    for k, v in d.items():
        if k.lower() == key.lower():
            return v
    raise KeyError(f"{key} not found in {list(d.keys())}")


def pick_best_model(metrics_dict, horizon_suffix):
    """Best non-LogReg model by test ROC-AUC. LogReg excluded because its saved
    .joblib doesn't include the fitted StandardScaler, so raw features can't safely
    be passed to it outside the training notebook (same caveat as M4)."""
    candidates = {
        k: v
        for k, v in metrics_dict.items()
        if k.endswith(f"_{horizon_suffix}") and not k.startswith("logreg")
    }
    if not candidates:
        raise ValueError(f"No RF/XGBoost candidates found for {horizon_suffix}. Available: {list(metrics_dict.keys())}")
    best_key = max(candidates, key=lambda k: _get_ci(candidates[k], "roc_auc"))
    return best_key.rsplit("_", 1)[0]


class ModelRegistry:
    """Loads every M1-M4 artifact once and serves predictions. One instance lives on
    app.state for the lifetime of the FastAPI process."""

    def __init__(self, models_dir: str):
        self.models_dir = models_dir
        aqi_dir = os.path.join(models_dir, "aqi")
        flood_dir = os.path.join(models_dir, "flood")
        traffic_dir = os.path.join(models_dir, "traffic")

        for d, label in [(aqi_dir, "aqi"), (flood_dir, "flood"), (traffic_dir, "traffic")]:
            if not os.path.isdir(d):
                raise FileNotFoundError(
                    f"Expected {label} model directory at {d}. "
                    f"Copy your M1/M2/M3 saved artifacts into {models_dir}/{label}/ "
                    f"(see backend/README.md for the exact file list)."
                )

        # --- zone table + metadata ---
        self.zones_df = pd.read_csv(os.path.join(aqi_dir, "zones.csv"))
        self.flood_static_df = pd.read_csv(os.path.join(flood_dir, "flood_zones_static_features.csv"))
        self.traffic_road_df = pd.read_csv(os.path.join(traffic_dir, "traffic_zones_road_features.csv"))
        self.traffic_hotspot_df = pd.read_csv(os.path.join(traffic_dir, "traffic_zones_hotspot_distance.csv"))

        with open(os.path.join(aqi_dir, "model_metadata_multizone.json")) as f:
            self.aqi_metadata = json.load(f)
        with open(os.path.join(flood_dir, "flood_model_metadata.json")) as f:
            self.flood_metadata = json.load(f)
        with open(os.path.join(traffic_dir, "traffic_model_metadata.json")) as f:
            self.traffic_metadata = json.load(f)

        # --- models ---
        self.aqi_models = {
            h: joblib.load(os.path.join(aqi_dir, f"aqi_xgboost_multizone_{h}h.joblib"))
            for h in [6, 12, 24]
        }
        self.flood_models = {
            h: {
                algo: joblib.load(os.path.join(flood_dir, f"flood_{algo}_{h}h.joblib"))
                for algo in ["logreg", "rf", "xgboost"]
            }
            for h in [6, 12]
        }
        self.traffic_models = {
            h: {
                algo: joblib.load(os.path.join(traffic_dir, f"congestion_{algo}_{h}h.joblib"))
                for algo in ["logreg", "rf", "xgboost"]
            }
            for h in [1, 2]
        }

        # --- model selection (same as M4: argmax ROC-AUC, read from real metadata) ---
        self.flood_best_algo = {h: pick_best_model(self.flood_metadata["test_metrics"], f"{h}h") for h in [6, 12]}
        self.traffic_best_algo = {h: pick_best_model(self.traffic_metadata["test_metrics"], f"{h}h") for h in [1, 2]}

        # --- master static zone table ---
        self.zone_static_df = (
            self.zones_df
            .merge(
                self.flood_static_df[[
                    "zone_id", "elevation_m", "water_body_distance_km",
                    "historical_inundation_count", "historical_max_depth_in", "historical_mean_depth_in",
                ]],
                on="zone_id", how="left",
            )
            .merge(self.traffic_road_df, on="zone_id", how="left")
            .merge(self.traffic_hotspot_df, on="zone_id", how="left")
        )
        self.zone_static_df = self.zone_static_df.set_index("zone_id", drop=False)

        assert set(self.zones_df["zone_id"]) == set(self.aqi_metadata["zone_ids"]), \
            "Zone mismatch between zones.csv and AQI metadata — re-check your M1/M4 artifacts match."

        self.zone_id_code_map = {zid: i for i, zid in enumerate(sorted(self.aqi_metadata["zone_ids"]))}

    # ------------------------------------------------------------------
    def zone_row(self, zone_id: str) -> dict:
        if zone_id not in self.zone_static_df.index:
            raise KeyError(f"Unknown zone_id: {zone_id}")
        return self.zone_static_df.loc[zone_id].to_dict()

    def list_zones(self):
        return self.zone_static_df.to_dict(orient="records")

    # ------------------------------------------------------------------
    def predict_aqi_risk(self, zone_row: dict, scenario: dict, horizon: int):
        model = self.aqi_models[horizon]
        cols = self.aqi_metadata["feature_columns"]
        row = build_feature_row(cols, scenario, zone_row)
        X = pd.DataFrame([row])[cols].copy()
        if "zone_id" in X.columns:
            X["zone_id"] = pd.Categorical(X["zone_id"], categories=self.aqi_metadata["zone_ids"])
        pred_aqi = float(model.predict(X)[0])
        return pred_aqi, aqi_to_risk(pred_aqi)

    def predict_flood_risk(self, zone_row: dict, scenario: dict, horizon: int):
        algo = self.flood_best_algo[horizon]
        cols = self.flood_metadata["feature_columns"]
        row = build_feature_row(cols, scenario, zone_row)
        model = self.flood_models[horizon][algo]

        if algo == "rf":
            df = pd.DataFrame([row])
            df["zone_id"] = zone_row["zone_id"]
            X = pd.get_dummies(df, columns=["zone_id"]).reindex(columns=model.feature_names_in_, fill_value=0)
        elif algo == "logreg":
            lr_cols = [c for c in cols if c != "zone_id"]
            X = pd.DataFrame([row])[lr_cols]
        else:
            X = pd.DataFrame([row])[cols].copy()
            if "zone_id" in X.columns:
                X["zone_id"] = pd.Categorical(X["zone_id"], categories=self.flood_metadata["zone_ids"])

        prob = float(model.predict_proba(X)[0, 1])
        return algo, prob, prob_to_risk(prob)

    def predict_traffic_risk(self, zone_row: dict, scenario: dict, horizon: int):
        algo = self.traffic_best_algo[horizon]
        cols = self.traffic_metadata["feature_columns"]
        traffic_scenario = {
            "rainfall_mm": scenario["rainfall_rate_mm_per_h"],
            "rainfall_6h_sum": scenario["rainfall_rate_mm_per_h"] * 6,
            "calendar": {
                "hour": scenario["calendar"]["hour"],
                "day_of_week": scenario["calendar"]["day_of_week"],
                "is_weekend": scenario["calendar"]["is_weekend"],
            },
        }
        row = build_feature_row(cols, traffic_scenario, zone_row)
        model = self.traffic_models[horizon][algo]

        if algo == "rf":
            df = pd.DataFrame([row])
            df["zone_id"] = zone_row["zone_id"]
            X = pd.get_dummies(df, columns=["zone_id"]).reindex(columns=model.feature_names_in_, fill_value=0)
        elif algo == "logreg":
            lr_cols = [c for c in cols if c != "zone_id"]
            X = pd.DataFrame([row])[lr_cols]
        else:
            X = pd.DataFrame([row])[cols].copy()

            if "zone_id" in X.columns:
                X["zone_id"] = (
                    X["zone_id"]
                    .map(self.zone_id_code_map)
                    .astype("int64")
                )

        prob = float(model.predict_proba(X)[0, 1])
        return algo, prob, prob_to_risk(prob)

    # ------------------------------------------------------------------
    def run_full_prediction(self, zone_id: str, scenario: dict, aqi_horizon=6, flood_horizon=6, traffic_horizon=1):
        """The full M4 pipeline for one zone + one scenario: three model calls +
        score combination. Returns a dict ready to log into `predictions` and return
        from the API."""
        zrow = self.zone_row(zone_id)

        pred_aqi, aqi_risk = self.predict_aqi_risk(zrow, scenario, aqi_horizon)
        flood_algo, flood_prob, flood_risk = self.predict_flood_risk(zrow, scenario, flood_horizon)
        traffic_algo, traffic_prob, traffic_risk = self.predict_traffic_risk(zrow, scenario, traffic_horizon)
        urban_risk_score, risk_category = combine_urban_risk(aqi_risk, flood_risk, traffic_risk)

        return {
            "zone_id": zone_id,
            "zone_name": zrow["zone_name"],
            "aqi_horizon_hours": aqi_horizon,
            "predicted_aqi": round(pred_aqi, 1),
            "aqi_risk": round(aqi_risk, 1),
            "flood_horizon_hours": flood_horizon,
            "flood_model_used": flood_algo,
            "flood_probability": round(flood_prob, 4),
            "flood_risk": round(flood_risk, 1),
            "traffic_horizon_hours": traffic_horizon,
            "traffic_model_used": traffic_algo,
            "traffic_probability": round(traffic_prob, 4),
            "traffic_risk": round(traffic_risk, 1),
            "urban_risk_score": round(urban_risk_score, 1),
            "risk_category": risk_category,
        }
