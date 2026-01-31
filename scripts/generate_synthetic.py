#!/usr/bin/env python3
"""
Generate synthetic device uplinks for demo/testing when real data is sparse.
Inserts into data/uplinks.db with synthetic=1 and device_name like "Synthetic Soil 1".
Run after ingest.py. Label synthetic devices clearly in the UI.
"""

import json
import random
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = APP_ROOT / "data" / "uplinks.db"

# Synthetic devices: (dev_eui_prefix, device_profile_name, device_name_label, payload generator)
SYNTHETIC_SPECS = [
    ("syn_soil_1", "Makerfabs Soil Moisture Sensor", "Synthetic Soil 1", "soil"),
    ("syn_soil_2", "Makerfabs Soil Moisture Sensor", "Synthetic Soil 2", "soil"),
    ("syn_level_1", "Dragino DDS75-LB Ultrasonic Distance Sensor", "Synthetic Level 1", "level"),
    ("syn_climate_1", "rbs305-ath", "Synthetic Climate 1", "climate"),
    ("syn_climate_2", "rbs305-ath", "Synthetic Climate 2", "climate"),
    ("syn_door_1", "rbs301-dws", "Synthetic Door 1", "door"),
    ("syn_sw3l_1", "SW3L", "Synthetic SW3L 1", "sw3l"),
]

# Real device payload reference: Makerfabs soil_val ~100–1500, temp 15–25°C; DDS75 distance 80–350 cm;
# rbs305-ath temp 21–23°C, humidity 9–60%; rbs301-dws open 0/1 + eventType; SW3L BAT 2.8–3.7 V.


def generate_soil(step: int, base_soil: float = 600, base_temp: float = 19.0) -> dict:
    # Conform to Makerfabs: soil_val typical 200–1200, temp 15–24°C; optional hum, battery_v
    temp = base_temp + random.gauss(0, 0.6)
    if step % 47 == 23:
        temp = base_temp - 3.2  # anomaly dip (rule-based detector)
    soil = base_soil + random.gauss(0, 80)
    soil = max(100, min(1400, soil))
    hum = 18 + random.gauss(0, 3)
    hum = max(5, min(40, hum))
    return {"soil_val": round(soil, 1), "temp": round(temp, 2), "hum": round(hum, 1)}


def generate_level(step: int) -> dict:
    # Conform to Dragino DDS75: distance in cm, typical 80–350; Bat optional
    dist = 180 + random.gauss(0, 25)
    if step % 31 == 15:
        dist = 180 + random.randint(80, 120)  # jump anomaly
    dist = max(50, min(400, dist))
    return {"distance": int(dist)}


def generate_climate(step: int) -> dict:
    # Conform to rbs305-ath: temperature 20–24°C, humidity often low (9–25) or up to 60
    temp = 22 + random.gauss(0, 0.8)
    if step % 41 == 20:
        temp = 22 + random.gauss(3.5, 0.4)  # swing anomaly
    hum = 12 + random.gauss(0, 6)
    hum = max(5, min(65, hum))
    return {"temperature": round(temp, 2), "humidity": round(hum, 1)}


def generate_door(step: int) -> dict:
    # Conform to rbs301-dws: open 0/1, eventType OPEN/CLOSED
    open_val = 1 if step % 20 < 8 else 0
    return {"open": open_val, "eventType": "OPEN" if open_val else "CLOSED"}


def generate_sw3l(step: int) -> dict:
    # Conform to SW3L: BAT 2.8–3.7 V; optional FREQUENCY_BAND, SUB_BAND
    bat = 3.3 - step * 0.00008 + random.gauss(0, 0.03)
    if step % 50 == 25:
        bat = bat - 0.22  # drop anomaly
    bat = max(2.6, min(3.7, bat))
    return {"BAT": round(bat, 2), "FREQUENCY_BAND": "US915", "SUB_BAND": 0}


def main() -> int:
    if not DB_PATH.is_file():
        print("DB not found. Run ingest.py first.", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB_PATH)
    # Ensure synthetic column exists
    try:
        conn.execute("ALTER TABLE uplinks ADD COLUMN synthetic INTEGER")
    except sqlite3.OperationalError:
        pass

    # Synthetic data synced to today (Jan 31): last ~48h so it appears in "24h" / "7d" views
    utc = timezone.utc
    t_end = datetime(2026, 1, 31, 23, 59, 0, tzinfo=utc)
    t_start = datetime(2026, 1, 30, 0, 0, 0, tzinfo=utc)
    # Dedicated synthetic gateway and location (so synthetic devices appear under one "site")
    SYNTHETIC_GATEWAY_ID = "synthetic-gateway-01"
    SYNTHETIC_LAT = 45.42  # Ottawa area, clearly for demo
    SYNTHETIC_LON = -75.69
    gateway_ids_json = json.dumps([SYNTHETIC_GATEWAY_ID])

    payload_gens = {
        "soil": generate_soil,
        "level": generate_level,
        "climate": generate_climate,
        "door": generate_door,
        "sw3l": generate_sw3l,
    }

    inserted = 0
    for dev_eui_prefix, profile, name_label, payload_kind in SYNTHETIC_SPECS:
        gen = payload_gens.get(payload_kind, lambda s: {})
        # ~1 point per 2 hours over the range
        num_points = max(24, int((t_end - t_start).total_seconds() / 7200))
        for step in range(num_points):
            t = t_start + (t_end - t_start) * (step / max(1, num_points - 1)) + timedelta(minutes=random.randint(-30, 30))
            time_str = t.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
            event_id = str(uuid.uuid4())
            obj = gen(step)
            object_json = json.dumps(obj)
            battery = None
            if payload_kind == "soil":
                battery = 2.9 + random.gauss(0, 0.08)  # Makerfabs-style battery_v ~2.8–3.1
            elif payload_kind == "level":
                battery = 3.2 + random.gauss(0, 0.06)  # DDS75 Bat in payload sometimes
            elif payload_kind == "sw3l":
                battery = obj.get("BAT")
            rssi = random.randint(-115, -75)
            snr = round(random.uniform(2, 9), 1)
            try:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO uplinks (
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
                        dev_eui_prefix,
                        name_label,
                        profile,
                        "synthetic-app",
                        "Synthetic",
                        gateway_ids_json,
                        rssi,
                        snr,
                        SYNTHETIC_LAT + random.gauss(0, 0.002),
                        SYNTHETIC_LON + random.gauss(0, 0.002),
                        None,
                        float(battery) if battery is not None else None,
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
                inserted += 1
            except sqlite3.IntegrityError:
                pass

    conn.commit()
    conn.close()
    print("Synthetic data generated:", inserted, "rows (synthetic=1).")
    print("Devices:", [s[2] for s in SYNTHETIC_SPECS])
    return 0


if __name__ == "__main__":
    sys.exit(main())
