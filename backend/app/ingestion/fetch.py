"""
Live data fetch for M6. Uses Open-Meteo's *forecast* endpoints' `current=` parameter
(near-real-time current conditions) — NOT the `archive-api` endpoint M1/M2/M3 used for
historical backfill. Same provider, same variable names, different endpoint, same
keyless/free access.

Traffic has no free live Chennai feed (same finding as M3) — there is deliberately no
fetch_current_traffic() here. The traffic model's inputs (calendar + current rainfall)
are already fully covered by fetch_current_weather().
"""
import time
import requests
from datetime import datetime, timezone

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

WEATHER_VARS = "temperature_2m,relative_humidity_2m,pressure_msl,precipitation,wind_speed_10m"
AIR_QUALITY_VARS = "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi"


class FetchError(Exception):
    pass


def _get_with_retry(url, params, max_retries=4, timeout=15):
    last_err = None
    for attempt in range(max_retries):
        try:
            r = requests.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except requests.exceptions.RequestException as e:
            last_err = e
            # Shared-egress hosts (Render free tier) hit provider per-IP rate limits:
            # back off harder on 429 than on transient network errors.
            wait = min(30.0, 2.0 * (2 ** attempt)) if "429" in str(e) else 1.5 * (attempt + 1)
            time.sleep(wait)
    raise FetchError(f"{url} failed after {max_retries} attempts: {last_err}")


def _batch_params(coords, variables: str) -> dict:
    lats = ",".join(str(lat) for lat, _ in coords)
    lons = ",".join(str(lon) for _, lon in coords)
    return {"latitude": lats, "longitude": lons, "current": variables, "timezone": "UTC"}


def _rows_from_batch(data, extract) -> list:
    """Batched Open-Meteo responses are a JSON array with one entry per requested
    location in request order (per-entry lat/lon are grid-snapped, so match by
    position, not coordinates). A single-location response is one object."""
    entries = data if isinstance(data, list) else [data]
    rows = []
    for entry in entries:
        c = entry.get("current") if isinstance(entry, dict) else None
        rows.append(extract(c) if c else None)  # None = this location's block was unusable
    return rows


def fetch_current_weather_batch(coords) -> list:
    """One request for ALL (lat, lon) pairs; returns dicts aligned with coords.

    Open-Meteo accepts comma-separated coordinate lists (up to 1000 locations), so a
    full 20-zone cycle costs 1 request instead of 20 -- that matters on hosts sharing
    an egress IP (Render free tier), where per-zone requests exhaust the provider's
    per-IP quota and every call comes back HTTP 429. Entries can be None if that
    location's block is unusable; FetchError is reserved for whole-request failure.
    """
    if not coords:
        return []

    def _extract(c):
        return {
            "observed_at": datetime.fromisoformat(c["time"]).replace(tzinfo=timezone.utc),
            "temperature": c.get("temperature_2m"),
            "humidity": c.get("relative_humidity_2m"),
            "pressure": c.get("pressure_msl"),
            "rainfall_mm": c.get("precipitation"),
            "wind_speed": c.get("wind_speed_10m"),
        }

    return _rows_from_batch(_get_with_retry(WEATHER_URL, _batch_params(coords, WEATHER_VARS)), _extract)


def fetch_current_air_quality_batch(coords) -> list:
    """Same contract as fetch_current_weather_batch, for AQI/PM2.5/PM10. Same
    CAMS-reanalysis caveat as M1/M2/M3: modeled air quality, not raw CPCB readings."""

    def _extract(c):
        return {
            "observed_at": datetime.fromisoformat(c["time"]).replace(tzinfo=timezone.utc),
            "aqi": c.get("us_aqi"),
            "pm2_5": c.get("pm2_5"),
            "pm10": c.get("pm10"),
        }

    return _rows_from_batch(_get_with_retry(AIR_QUALITY_URL, _batch_params(coords, AIR_QUALITY_VARS)), _extract)


def fetch_current_weather(lat: float, lon: float) -> dict:
    """Single-location convenience wrapper over the batched fetch."""
    row = fetch_current_weather_batch([(lat, lon)])[0]
    if row is None:
        raise FetchError("No 'current' block in weather response")
    return row


def fetch_current_air_quality(lat: float, lon: float) -> dict:
    """Single-location convenience wrapper over the batched fetch."""
    row = fetch_current_air_quality_batch([(lat, lon)])[0]
    if row is None:
        raise FetchError("No 'current' block in air quality response")
    return row
