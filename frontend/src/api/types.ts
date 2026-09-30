// Mirrors app/main.py + app/risk_engine.py's ModelRegistry.run_full_prediction() output
// (backend M5/M6) field-for-field. If a backend response shape changes, update here first.

export type RiskCategory = "Low" | "Moderate" | "Elevated" | "High" | "Critical";

export interface Liveness {
  observed_at: string;
  age_minutes: number;
  status: "LIVE" | "STALE";
  is_stale: boolean;
}

// The dict returned by ModelRegistry.run_full_prediction(), used (with Liveness merged
// in) by /api/dashboard and /api/alerts, and standalone by /api/forecast and /api/what-if.
export interface PredictionResult {
  zone_id: string;
  zone_name: string;
  aqi_horizon_hours: number;
  predicted_aqi: number;
  aqi_risk: number;
  flood_horizon_hours: number;
  flood_model_used: string;
  flood_probability: number;
  flood_risk: number;
  traffic_horizon_hours: number;
  traffic_model_used: string;
  traffic_probability: number;
  traffic_risk: number;
  urban_risk_score: number;
  risk_category: RiskCategory;
}

export type DashboardZone = PredictionResult & Liveness;

export interface DashboardResponse {
  zones: DashboardZone[];
  zones_missing_live_data: string[];
  note: string | null;
}

export interface ForecastResponse extends Liveness {
  zone_id: string;
  forecasts: PredictionResult[];
}

// /api/risk-map: NO_DATA points omit the Liveness fields entirely (see main.py) —
// everything from Liveness is optional here to reflect that honestly.
export interface RiskMapPoint extends Partial<Omit<Liveness, "status">> {
  zone_id: string;
  zone_name: string;
  latitude: number;
  longitude: number;
  urban_risk_score: number | null;
  risk_category: RiskCategory | null;
  has_live_data: boolean;
  status: "LIVE" | "STALE" | "NO_DATA";
}

export interface RiskMapResponse {
  points: RiskMapPoint[];
}

export interface ExplainFactor {
  feature: string;
  value: number | null;
  shap_contribution: number;
}

export interface ExplainResponse {
  zone_id: string;
  horizon_hours: number;
  predicted_aqi: number;
  top_factors: ExplainFactor[];
}

export interface WhatIfRequest {
  zone_id: string;
  rainfall_rate_mm_per_h?: number;
  temperature?: number;
  humidity?: number;
  wind_speed?: number;
  pressure?: number;
  aqi?: number;
  pm2_5?: number;
  pm10?: number;
}

export interface WhatIfResponse {
  zone_id: string;
  disclaimer: string;
  current: PredictionResult;
  simulated: PredictionResult;
  delta_urban_risk_score: number;
}

export interface AlertsResponse {
  min_category: RiskCategory;
  alerts: PredictionResult[];
}

export interface ModelRunRow {
  model_family: "aqi" | "flood" | "traffic";
  horizon_hours: number;
  algorithm: "xgboost" | "rf" | "logreg";
  selected_for_serving: boolean;
  test_metrics: Record<string, number> | null;
  train_range_start: string | null;
  train_range_end: string | null;
  loaded_at: string;
  source_metadata_file: string;
}

export interface ModelHealthResponse {
  models: ModelRunRow[];
}

export interface DataSourceRow {
  source_name: string;
  description: string | null;
  last_updated: string | null;
  status: string;
  age_minutes?: number | null;
  is_stale?: boolean | null;
}

export interface DataHealthResponse {
  sources: DataSourceRow[];
  stale_after_minutes: number;
  zones_with_any_weather_observation: number;
  zones_with_recent_weather: number;
  total_zones: number;
  note: string;
}

export interface SeedObservationRequest {
  zone_id: string;
  scenario_name?: "typical_dry_midday" | "evening_rush_moderate_rain" | "northeast_monsoon_heavy_rain";
  custom_scenario?: Record<string, unknown>;
}
