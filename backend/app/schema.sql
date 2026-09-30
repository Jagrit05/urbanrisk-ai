-- UrbanRisk AI — M5 database schema
-- Matches the original spec's 9 tables (locations, weather, air_quality, traffic,
-- incidents, predictions, model_runs, alerts, data_sources), adapted to the real
-- artifacts M1-M4 actually produce.
--
-- HONESTY NOTE: weather / air_quality / traffic are time-series tables meant to be
-- filled by M6's live ingestion pipeline. Until M6 exists, they stay empty except for
-- whatever the dev-only /api/dev/seed-observation endpoint inserts for testing.
-- Every endpoint that depends on them checks for emptiness and says so — it does not
-- silently fall back to a fabricated number.

CREATE TABLE IF NOT EXISTS locations (
    zone_id                     TEXT PRIMARY KEY,
    zone_name                   TEXT NOT NULL,
    latitude                    DOUBLE PRECISION NOT NULL,
    longitude                   DOUBLE PRECISION NOT NULL,
    elevation_m                 DOUBLE PRECISION,
    water_body_distance_km      DOUBLE PRECISION,
    historical_inundation_count INTEGER,
    historical_max_depth_in     DOUBLE PRECISION,
    historical_mean_depth_in    DOUBLE PRECISION,
    road_density_score          DOUBLE PRECISION,
    distance_to_congestion_hotspot_km DOUBLE PRECISION,
    -- free-form bucket for any other static per-zone column M1-M4 produced that
    -- doesn't have its own column here yet — keeps the schema from needing a
    -- migration every time a milestone notebook adds one more static feature.
    extra_static_features       JSONB DEFAULT '{}'::jsonb
);

-- Real, static GCC-documented inundation points (M2). Reference evidence, not a
-- time series — loaded once from gcc_inundation_points_raw.csv.
CREATE TABLE IF NOT EXISTS incidents (
    id             SERIAL PRIMARY KEY,
    source         TEXT NOT NULL DEFAULT 'GCC_inundation_points',
    latitude       DOUBLE PRECISION NOT NULL,
    longitude      DOUBLE PRECISION NOT NULL,
    depth_inches   DOUBLE PRECISION,
    remarks        TEXT,
    nearest_zone_id TEXT REFERENCES locations(zone_id)
);

-- Time-series tables — empty until M6 (live ingestion) exists, or until the
-- dev-only seed endpoint below inserts test rows.
CREATE TABLE IF NOT EXISTS weather (
    id             SERIAL PRIMARY KEY,
    zone_id        TEXT NOT NULL REFERENCES locations(zone_id),
    observed_at    TIMESTAMPTZ NOT NULL,
    temperature    DOUBLE PRECISION,
    humidity       DOUBLE PRECISION,
    pressure       DOUBLE PRECISION,
    rainfall_mm    DOUBLE PRECISION,
    wind_speed     DOUBLE PRECISION,
    source         TEXT NOT NULL DEFAULT 'unknown',  -- 'openmeteo_live', 'dev_seed', etc.
    UNIQUE (zone_id, observed_at, source)
);

CREATE TABLE IF NOT EXISTS air_quality (
    id             SERIAL PRIMARY KEY,
    zone_id        TEXT NOT NULL REFERENCES locations(zone_id),
    observed_at    TIMESTAMPTZ NOT NULL,
    aqi            DOUBLE PRECISION,
    pm2_5          DOUBLE PRECISION,
    pm10           DOUBLE PRECISION,
    no2            DOUBLE PRECISION,
    so2            DOUBLE PRECISION,
    o3             DOUBLE PRECISION,
    source         TEXT NOT NULL DEFAULT 'unknown',
    UNIQUE (zone_id, observed_at, source)
);

CREATE TABLE IF NOT EXISTS traffic (
    id                  SERIAL PRIMARY KEY,
    zone_id             TEXT NOT NULL REFERENCES locations(zone_id),
    observed_at         TIMESTAMPTZ NOT NULL,
    congestion_signal   DOUBLE PRECISION,
    source              TEXT NOT NULL DEFAULT 'unknown',
    UNIQUE (zone_id, observed_at, source)
);

-- Every prediction the engine has ever produced (AQI, flood, traffic, and the
-- combined urban risk score), logged for /api/forecast, /api/risk-map, /api/dashboard
-- and future drift analysis in M6.
CREATE TABLE IF NOT EXISTS predictions (
    id                 SERIAL PRIMARY KEY,
    zone_id            TEXT NOT NULL REFERENCES locations(zone_id),
    predicted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    horizon_hours      INTEGER NOT NULL,
    aqi_predicted      DOUBLE PRECISION,
    aqi_risk           DOUBLE PRECISION,
    flood_model_used   TEXT,
    flood_probability  DOUBLE PRECISION,
    flood_risk         DOUBLE PRECISION,
    traffic_model_used TEXT,
    traffic_probability DOUBLE PRECISION,
    traffic_risk       DOUBLE PRECISION,
    urban_risk_score   DOUBLE PRECISION,
    risk_category      TEXT,
    input_source       TEXT NOT NULL DEFAULT 'unknown'  -- 'live_observation', 'dev_seed', 'what_if'
);

-- What each loaded model artifact actually is, read from M1-M4's own saved metadata
-- at startup — never hand-typed, so this can't drift from the truth.
CREATE TABLE IF NOT EXISTS model_runs (
    id                SERIAL PRIMARY KEY,
    model_family       TEXT NOT NULL,   -- 'aqi', 'flood', 'traffic'
    horizon_hours      INTEGER,
    algorithm           TEXT,            -- 'xgboost', 'rf', 'logreg'
    selected_for_serving BOOLEAN NOT NULL DEFAULT false,
    test_metrics        JSONB,
    train_range_start   TIMESTAMPTZ,
    train_range_end     TIMESTAMPTZ,
    loaded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_metadata_file TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
    id             SERIAL PRIMARY KEY,
    zone_id        TEXT NOT NULL REFERENCES locations(zone_id),
    triggered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    urban_risk_score DOUBLE PRECISION NOT NULL,
    risk_category  TEXT NOT NULL,
    message        TEXT,
    prediction_id  INTEGER REFERENCES predictions(id)
);

-- Health/status of each upstream data feed — honestly empty/stale until M6.
CREATE TABLE IF NOT EXISTS data_sources (
    source_name    TEXT PRIMARY KEY,
    description    TEXT,
    last_updated   TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'not_yet_connected'  -- 'ok' | 'stale' | 'not_yet_connected'
);

-- M6 reads "latest observation per zone" and "observations in the last N minutes"
-- constantly (every dashboard/forecast/risk-map/data-health call) — index for it.
CREATE INDEX IF NOT EXISTS idx_weather_zone_time ON weather (zone_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_air_quality_zone_time ON air_quality (zone_id, observed_at DESC);

INSERT INTO data_sources (source_name, description, status) VALUES
    ('openmeteo_weather', 'Open-Meteo Historical/Forecast Weather (M1/M2/M3 source)', 'not_yet_connected'),
    ('openmeteo_air_quality', 'Open-Meteo Air Quality reanalysis (M1 source)', 'not_yet_connected'),
    ('gcc_inundation_points', 'GCC documented inundation points, static reference (M2)', 'ok'),
    ('traffic_live_feed', 'No free live Chennai traffic feed identified (see M3 notes)', 'not_yet_connected')
ON CONFLICT (source_name) DO NOTHING;
