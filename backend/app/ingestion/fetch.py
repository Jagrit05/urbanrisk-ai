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


def _get_with_retry(url, params, max_retries=3, timeout=15):
    last_err = None
    for attempt in range(max_retries):
        try:
            r = requests.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except requests.exceptions.RequestException as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise FetchError(f"{url} failed after {max_retries} attempts: {last_err}")


def fetch_current_weather(lat: float, lon: float) -> dict:
    """Returns temperature/humidity/pressure/rainfall/wind for right now, in UTC."""
    params = {"latitude": lat, "longitude": lon, "current": WEATHER_VARS, "timezone": "UTC"}
    data = _get_with_retry(WEATHER_URL, params)
    c = data.get("current")
    if c is None:
        raise FetchError(f"No 'current' block in weather response: {data}")

    observed_at = datetime.fromisoformat(c["time"]).replace(tzinfo=timezone.utc)
    return {
        "observed_at": observed_at,
        "temperature": c.get("temperature_2m"),
        "humidity": c.get("relative_humidity_2m"),
        "pressure": c.get("pressure_msl"),
        "rainfall_mm": c.get("precipitation"),
        "wind_speed": c.get("wind_speed_10m"),
    }


def fetch_current_air_quality(lat: float, lon: float) -> dict:
    """Returns AQI/PM2.5/PM10 for right now, in UTC. Same CAMS-reanalysis caveat as
    M1/M2/M3: this is modeled air quality, not a raw CPCB ground reading."""
    params = {"latitude": lat, "longitude": lon, "current": AIR_QUALITY_VARS, "timezone": "UTC"}
    data = _get_with_retry(AIR_QUALITY_URL, params)
    c = data.get("current")
    if c is None:
        raise FetchError(f"No 'current' block in air quality response: {data}")

    observed_at = datetime.fromisoformat(c["time"]).replace(tzinfo=timezone.utc)
    return {
        "observed_at": observed_at,
        "aqi": c.get("us_aqi"),
        "pm2_5": c.get("pm2_5"),
        "pm10": c.get("pm10"),
    }
