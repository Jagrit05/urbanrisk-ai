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
from app.ingestion.fetch import fetch_current_weather, fetch_current_air_quality, FetchError

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
        print("[ingestion] `locations` table is empty — backend hasn't seeded zones yet. Skipping this cycle.")
        return

    weather_ok, weather_fail = 0, 0
    aq_ok, aq_fail = 0, 0

    for zone in zones:
        zone_id, lat, lon = zone["zone_id"], zone["latitude"], zone["longitude"]

        try:
            w = fetch_current_weather(lat, lon)
            db.execute(
                text("""INSERT INTO weather (zone_id, observed_at, temperature, humidity, pressure,
                         rainfall_mm, wind_speed, source)
                         VALUES (:z, :t, :temp, :hum, :pres, :rain, :wind, 'openmeteo_live')
                         ON CONFLICT (zone_id, observed_at, source) DO NOTHING"""),
                {"z": zone_id, "t": w["observed_at"], "temp": w["temperature"], "hum": w["humidity"],
                 "pres": w["pressure"], "rain": w["rainfall_mm"], "wind": w["wind_speed"]},
            )
            weather_ok += 1
        except FetchError as e:
            weather_fail += 1
            print(f"[ingestion] weather fetch FAILED for {zone_id}: {e} — keeping last valid observation.")

        try:
            aq = fetch_current_air_quality(lat, lon)
            db.execute(
                text("""INSERT INTO air_quality (zone_id, observed_at, aqi, pm2_5, pm10, source)
                         VALUES (:z, :t, :aqi, :pm25, :pm10, 'openmeteo_live')
                         ON CONFLICT (zone_id, observed_at, source) DO NOTHING"""),
                {"z": zone_id, "t": aq["observed_at"], "aqi": aq["aqi"], "pm25": aq["pm2_5"], "pm10": aq["pm10"]},
            )
            aq_ok += 1
        except FetchError as e:
            aq_fail += 1
            print(f"[ingestion] air quality fetch FAILED for {zone_id}: {e} — keeping last valid observation.")

    db.commit()

    now = datetime.now(timezone.utc)
    if weather_ok > 0:
        db.execute(
            text("""UPDATE data_sources SET last_updated = :t, status = 'ok' WHERE source_name = 'openmeteo_weather'"""),
            {"t": now},
        )
    if aq_ok > 0:
        db.execute(
            text("""UPDATE data_sources SET last_updated = :t, status = 'ok' WHERE source_name = 'openmeteo_air_quality'"""),
            {"t": now},
        )
    db.commit()

    print(f"[ingestion] cycle done — weather {weather_ok}/{len(zones)} ok, "
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
