"""
UrbanRisk AI — M6 live ingestion worker.

Runs as its own long-lived process (separate container in docker-compose), polling
every zone in `locations` on a fixed interval and writing into `weather` /
`air_quality`. Deliberately simple (a sleep loop, not a cron daemon or task queue) —
appropriate for 20 zones on a 5-15 minute cadence; revisit if this ever needs to scale
to hundreds of zones or sub-minute intervals.

Failure handling, per the original spec: if a zone's fetch fails, we skip it and move
on — we do NOT write a bad row, and we do NOT crash the loop. Every endpoint in
main.py already reads "the latest row for this zone", so skipping a failed fetch is
exactly the "gracefully fall back to the latest valid observation" behavior the spec
asked for — there's nothing extra to implement for the fallback itself.
"""
import os
import sys
import time
import traceback
from datetime import datetime, timezone

from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from app.database import SessionLocal, init_schema
from app.ingestion.fetch import (
    fetch_current_weather_batch, fetch_current_air_quality_batch,
    fetch_current_weather_met_batch, FetchError,
)

INTERVAL_MINUTES = int(os.environ.get("INGESTION_INTERVAL_MINUTES", "10"))
if not (5 <= INTERVAL_MINUTES <= 15):
    print(f"[ingestion] WARNING: INGESTION_INTERVAL_MINUTES={INTERVAL_MINUTES} is outside "
          f"the spec's 5-15 minute target range — proceeding anyway, but consider adjusting.")


def get_zones(db):
    rows = db.execute(text("SELECT zone_id, latitude, longitude FROM locations")).mappings().all()
    return [dict(r) for r in rows]


def run_one_cycle(db):
    zones = get_zones(db)
    if not zones:
        print("[ingestion] `locations` table is empty -- backend hasn't seeded zones yet. Skipping this cycle.")
        return

    coords = [(zone["latitude"], zone["longitude"]) for zone in zones]

    # Batched fetching: Open-Meteo accepts comma-separated coordinate lists, so a full
    # 20-zone cycle costs 2 requests instead of 40. On shared-egress hosts (Render free
    # tier) the old per-zone loop exhausted the provider's per-IP quota (HTTP 429 on
    # every call); batching stays comfortably inside it. Same honesty rule as before:
    # a failed fetch is skipped -- never fabricated, never crashes the cycle.
    weather_source = "openmeteo_weather"
    try:
        weather_rows = fetch_current_weather_batch(coords)
        weather_fail = sum(1 for row in weather_rows if row is None)
        weather_ok = len(zones) - weather_fail
    except FetchError as e:
        weather_rows, weather_ok, weather_fail = [None] * len(zones), 0, len(zones)
        print(f"[ingestion] weather batch fetch FAILED: {e} -- keeping last valid observation for all zones.")

    if weather_ok == 0:
        # Primary weather provider returned nothing (rate-limited on shared-egress
        # hosts) -- fall back to MET Norway instead of shipping a weatherless cycle.
        weather_source = "metno_locationforecast"
        weather_rows = fetch_current_weather_met_batch(coords)
        weather_fail = sum(1 for row in weather_rows if row is None)
        weather_ok = len(zones) - weather_fail
        print(f"[ingestion] weather fallback (met.no): {weather_ok}/{len(zones)} ok.")

    try:
        aq_rows = fetch_current_air_quality_batch(coords)
        aq_fail = sum(1 for row in aq_rows if row is None)
        aq_ok = len(zones) - aq_fail
    except FetchError as e:
        aq_rows, aq_ok, aq_fail = [None] * len(zones), 0, len(zones)
        print(f"[ingestion] air quality batch fetch FAILED: {e} -- keeping last valid observation for all zones.")

    for zone, w, aq in zip(zones, weather_rows, aq_rows):
        if w is not None:
            db.execute(
                text("""INSERT INTO weather (zone_id, observed_at, temperature, humidity, pressure,
                         rainfall_mm, wind_speed, source)
                         VALUES (:z, :t, :temp, :hum, :pres, :rain, :wind, :src)
                         ON CONFLICT (zone_id, observed_at, source) DO NOTHING"""),
                {"z": zone["zone_id"], "t": w["observed_at"], "temp": w["temperature"], "hum": w["humidity"],
                 "pres": w["pressure"], "rain": w["rainfall_mm"], "wind": w["wind_speed"], "src": weather_source},
            )
        if aq is not None:
            db.execute(
                text("""INSERT INTO air_quality (zone_id, observed_at, aqi, pm2_5, pm10, source)
                         VALUES (:z, :t, :aqi, :pm25, :pm10, 'openmeteo_live')
                         ON CONFLICT (zone_id, observed_at, source) DO NOTHING"""),
                {"z": zone["zone_id"], "t": aq["observed_at"], "aqi": aq["aqi"], "pm25": aq["pm2_5"], "pm10": aq["pm10"]},
            )

    db.commit()

    now = datetime.now(timezone.utc)
    if weather_ok > 0:
        db.execute(
            text("""UPDATE data_sources SET last_updated = :t, status = 'ok' WHERE source_name = :s"""),
            {"t": now, "s": weather_source},
        )
    if aq_ok > 0:
        db.execute(
            text("""UPDATE data_sources SET last_updated = :t, status = 'ok' WHERE source_name = 'openmeteo_air_quality'"""),
            {"t": now},
        )
    db.commit()

    print(f"[ingestion] cycle done -- weather {weather_ok}/{len(zones)} ok, "
          f"air_quality {aq_ok}/{len(zones)} ok "
          f"({weather_fail} weather failures, {aq_fail} AQ failures)")

def main():
    print(f"[ingestion] starting — polling every {INTERVAL_MINUTES} minutes")
    init_schema()  # idempotent — safe even if the backend container already ran it

    while True:
        db = SessionLocal()
        try:
            run_one_cycle(db)
        except Exception:
            # A whole-cycle crash (e.g. DB connection dropped) should not kill the
            # worker permanently — log it and retry next interval.
            print("[ingestion] cycle raised an unexpected exception:")
            traceback.print_exc()
        finally:
            db.close()

        time.sleep(INTERVAL_MINUTES * 60)


if __name__ == "__main__":
    main()
