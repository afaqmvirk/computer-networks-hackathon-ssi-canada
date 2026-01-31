#!/usr/bin/env python3
"""
Append one new synthetic uplink every 30 seconds for a synthetic device.
Run while the API is running; use "Live / auto-refresh (15 s)" on the dashboard
to see new points appear (e.g. select "Synthetic Soil 1 [Synthetic]" in Soil view).

Stop with Ctrl+C.
"""

import json
import random
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = APP_ROOT / "data" / "uplinks.db"

SYNTHETIC_GATEWAY_ID = "synthetic-gateway-01"
SYNTHETIC_LAT = 45.42
SYNTHETIC_LON = -75.69

# Device to append to (must exist from generate_synthetic.py)
LIVE_DEV_EUI = "syn_soil_1"
LIVE_DEVICE_NAME = "Synthetic Soil 1"
LIVE_PROFILE = "Makerfabs Soil Moisture Sensor"
INTERVAL_SEC = 30


def main() -> int:
    if not DB_PATH.is_file():
        print("DB not found. Run ingest.py and generate_synthetic.py first.", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB_PATH)

    row = conn.execute(
        "SELECT 1 FROM uplinks WHERE dev_eui = ? AND synthetic = 1 LIMIT 1",
        (LIVE_DEV_EUI,),
    ).fetchone()
    if not row:
        print(f"Synthetic device {LIVE_DEV_EUI} not found. Run generate_synthetic.py first.", file=sys.stderr)
        conn.close()
        return 1

    print(f"Appending one uplink every {INTERVAL_SEC}s for {LIVE_DEVICE_NAME} ({LIVE_DEV_EUI}).")
    print("In the dashboard: Soil → Synthetic Soil 1 [Synthetic] → check Live / auto-refresh (15 s).")
    print("Stop with Ctrl+C.\n")

    step = 0
    try:
        while True:
            now = datetime.now(timezone.utc)
            time_str = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
            event_id = str(uuid.uuid4())
            soil = 400 + random.gauss(0, 15)
            soil = max(0, min(1023, soil))
            temp = 22.0 + random.gauss(0, 0.5)
            obj = {"soil_val": round(soil, 1), "temp": round(temp, 2)}
            object_json = json.dumps(obj)
            gateway_ids = json.dumps([SYNTHETIC_GATEWAY_ID])
            rssi = random.randint(-115, -75)
            snr = round(random.uniform(2, 9), 1)

            conn.execute(
                """
                INSERT INTO uplinks (
                    event_id, time, dev_eui, device_name, device_profile_name,
                    application_id, application_name, gateway_ids, rssi, snr,
                    location_lat, location_lon, location_alt, battery_normalized, object_json,
                    f_port, dev_addr, f_cnt, margin, external_power_source,
                    battery_level_unavailable, battery_level_join, frequency, spreading_factor, region_config_id, synthetic
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    time_str,
                    LIVE_DEV_EUI,
                    LIVE_DEVICE_NAME,
                    LIVE_PROFILE,
                    "synthetic-app",
                    "Synthetic",
                    gateway_ids,
                    rssi,
                    snr,
                    SYNTHETIC_LAT,
                    SYNTHETIC_LON,
                    None,
                    3.0 + random.gauss(0, 0.05),
                    object_json,
                    1,
                    None,
                    step,
                    None,
                    None,
                    None,
                    None,
                    868100000,
                    7,
                    None,
                    1,
                ),
            )
            conn.commit()
            step += 1
            print(f"  {time_str}  soil={obj['soil_val']}, temp={obj['temp']}°C (count={step})")
            time.sleep(INTERVAL_SEC)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
