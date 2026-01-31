#!/usr/bin/env python3
"""
Phase 1 — Ingest and normalize LoRaWAN uplink JSON into SQLite.

- Walks dataset/<DeviceType>/<devEui>/*.json
- Parses each JSON; skips or tags records missing time or devEui
- Extracts: event_id, time, devEui, deviceName, deviceProfileName, applicationId,
  applicationName, gatewayIds, rssi, snr, location (lat/lon/alt), object fields,
  fPort, devAddr, fCnt, margin, externalPowerSource, batteryLevelUnavailable, batteryLevel,
  frequency, spreadingFactor, regionConfigId
- Normalizes battery into battery_normalized (Bat | battery_v | battery | batteryLevel)
- Writes to data/uplinks.db (unified table uplinks)
"""

import json
import sqlite3
import sys
from pathlib import Path

# Canonical battery field names per device (from object)
BATTERY_KEYS = ("Bat", "battery_v", "battery", "batteryLevel")


def normalize_battery(obj: dict) -> float | None:
    """Extract battery from object using known keys; return None if missing."""
    if not obj:
        return None
    for key in BATTERY_KEYS:
        if key in obj:
            val = obj[key]
            if isinstance(val, (int, float)):
                return float(val)
            # battery can be percentage (0-100) or voltage; store as-is
    return None


def get_first_rx(rx_info: list) -> dict | None:
    """First rxInfo entry for rssi/snr/location."""
    if not rx_info or not isinstance(rx_info, list):
        return None
    return rx_info[0] if rx_info else None


def get_gateway_ids(rx_info: list) -> list[str]:
    """Collect all gatewayId from rxInfo."""
    if not rx_info or not isinstance(rx_info, list):
        return []
    ids = []
    for rx in rx_info:
        if isinstance(rx, dict) and "gatewayId" in rx:
            ids.append(rx["gatewayId"])
    return ids


def get_location(rx: dict | None) -> tuple[float | None, float | None, float | None]:
    """(lat, lon, alt) from rx.location; None for missing."""
    if not rx or "location" not in rx:
        return None, None, None
    loc = rx["location"]
    if not isinstance(loc, dict):
        return None, None, None
    lat = loc.get("latitude")
    lon = loc.get("longitude")
    alt = loc.get("altitude")
    return (
        float(lat) if lat is not None else None,
        float(lon) if lon is not None else None,
        float(alt) if alt is not None else None,
    )


def extract_event(file_path: Path, raw: dict) -> dict | None:
    """
    Extract normalized event from raw ChirpStack uplink JSON.
    Returns None if missing time or devEui (invalid).
    """
    time_val = raw.get("time")
    device_info = raw.get("deviceInfo") or {}
    dev_eui = device_info.get("devEui") or raw.get("devEui")
    if not time_val or not dev_eui:
        return None

    event_id = raw.get("deduplicationId") or file_path.stem
    rx = get_first_rx(raw.get("rxInfo") or [])
    gateway_ids = get_gateway_ids(raw.get("rxInfo") or [])
    lat, lon, alt = get_location(rx)

    obj = raw.get("object")
    if obj is not None and not isinstance(obj, dict):
        obj = None
    battery = normalize_battery(obj) if obj else None

    # LoRaWAN link
    f_port = raw.get("fPort")
    if f_port is not None and not isinstance(f_port, int):
        f_port = None
    dev_addr = raw.get("devAddr")
    if dev_addr is not None:
        dev_addr = str(dev_addr).strip() or None
    f_cnt = raw.get("fCnt")
    if f_cnt is not None and not isinstance(f_cnt, int):
        f_cnt = None

    # Join/status (top-level)
    margin = raw.get("margin")
    if margin is not None and not isinstance(margin, (int, float)):
        margin = None
    external_power = raw.get("externalPowerSource")
    if isinstance(external_power, bool):
        external_power = 1 if external_power else 0
    elif external_power is not None:
        external_power = None
    battery_unavail = raw.get("batteryLevelUnavailable")
    if isinstance(battery_unavail, bool):
        battery_unavail = 1 if battery_unavail else 0
    elif battery_unavail is not None:
        battery_unavail = None
    battery_level_join = raw.get("batteryLevel")
    if battery_level_join is not None and not isinstance(battery_level_join, (int, float)):
        battery_level_join = None

    # txInfo
    frequency = None
    spreading_factor = None
    tx = raw.get("txInfo")
    if isinstance(tx, dict):
        freq = tx.get("frequency")
        if isinstance(freq, (int, float)):
            frequency = int(freq)
        mod = tx.get("modulation") or {}
        lora = mod.get("lora") if isinstance(mod, dict) else None
        if isinstance(lora, dict) and "spreadingFactor" in lora:
            sf = lora["spreadingFactor"]
            if isinstance(sf, int):
                spreading_factor = sf

    region_config = raw.get("regionConfigId")
    if region_config is not None:
        region_config = str(region_config).strip() or None

    return {
        "event_id": event_id,
        "time": time_val,
        "dev_eui": dev_eui,
        "device_name": (device_info.get("deviceName") or "").strip() or None,
        "device_profile_name": (device_info.get("deviceProfileName") or "").strip() or None,
        "application_id": device_info.get("applicationId"),
        "application_name": (device_info.get("applicationName") or "").strip() or None,
        "gateway_ids": json.dumps(gateway_ids) if gateway_ids else None,
        "rssi": rx.get("rssi") if rx else None,
        "snr": rx.get("snr") if rx else None,
        "location_lat": lat,
        "location_lon": lon,
        "location_alt": alt,
        "battery_normalized": battery,
        "object_json": json.dumps(obj) if obj else None,
        "f_port": f_port,
        "dev_addr": dev_addr,
        "f_cnt": f_cnt,
        "margin": float(margin) if margin is not None else None,
        "external_power_source": external_power,
        "battery_level_unavailable": battery_unavail,
        "battery_level_join": float(battery_level_join) if battery_level_join is not None else None,
        "frequency": frequency,
        "spreading_factor": spreading_factor,
        "region_config_id": region_config,
    }


def walk_dataset(dataset_root: Path):
    """Yield (device_type, dev_eui, file_path) for each JSON file."""
    if not dataset_root.is_dir():
        return
    for device_type_dir in sorted(dataset_root.iterdir()):
        if not device_type_dir.is_dir() or device_type_dir.name.startswith("."):
            continue
        # Skip LoRaWAN.tgz if present as a file
        if device_type_dir.suffix == ".tgz":
            continue
        for dev_eui_dir in sorted(device_type_dir.iterdir()):
            if not dev_eui_dir.is_dir():
                continue
            for path in sorted(dev_eui_dir.glob("*.json")):
                yield device_type_dir.name, dev_eui_dir.name, path


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS uplinks (
        event_id TEXT PRIMARY KEY,
        time TEXT NOT NULL,
        dev_eui TEXT NOT NULL,
        device_name TEXT,
        device_profile_name TEXT,
        application_id TEXT,
        application_name TEXT,
        gateway_ids TEXT,
        rssi INTEGER,
        snr REAL,
        location_lat REAL,
        location_lon REAL,
        location_alt REAL,
        battery_normalized REAL,
        object_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_uplinks_dev_eui ON uplinks(dev_eui);
    CREATE INDEX IF NOT EXISTS idx_uplinks_time ON uplinks(time);
    CREATE INDEX IF NOT EXISTS idx_uplinks_device_profile ON uplinks(device_profile_name);
    CREATE INDEX IF NOT EXISTS idx_uplinks_application_id ON uplinks(application_id);
    """)
    _migrate_schema(conn)


def _migrate_schema(conn: sqlite3.Connection) -> None:
    """Add new columns if missing (safe to run multiple times)."""
    new_columns = [
        ("f_port", "INTEGER"),
        ("dev_addr", "TEXT"),
        ("f_cnt", "INTEGER"),
        ("margin", "REAL"),
        ("external_power_source", "INTEGER"),
        ("battery_level_unavailable", "INTEGER"),
        ("battery_level_join", "REAL"),
        ("frequency", "INTEGER"),
        ("spreading_factor", "INTEGER"),
        ("region_config_id", "TEXT"),
        ("synthetic", "INTEGER"),
    ]
    for col, typ in new_columns:
        try:
            conn.execute(f"ALTER TABLE uplinks ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass  # column already exists


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    dataset_root = repo_root / "dataset"
    data_dir = repo_root / "data"
    data_dir.mkdir(exist_ok=True)
    db_path = data_dir / "uplinks.db"

    if not dataset_root.is_dir():
        print("Dataset root not found:", dataset_root, file=sys.stderr)
        return 1

    conn = sqlite3.connect(db_path)
    create_schema(conn)

    inserted = 0
    skipped = 0
    invalid = 0

    for device_type, dev_eui, file_path in walk_dataset(dataset_root):
        try:
            text = file_path.read_text(encoding="utf-8")
            raw = json.loads(text)
        except (OSError, json.JSONDecodeError) as e:
            print("Read/parse error", file_path, e, file=sys.stderr)
            invalid += 1
            continue

        row = extract_event(file_path, raw)
        if row is None:
            invalid += 1
            continue

        try:
            conn.execute(
                """
                INSERT OR REPLACE INTO uplinks (
                    event_id, time, dev_eui, device_name, device_profile_name,
                    application_id, application_name, gateway_ids, rssi, snr,
                    location_lat, location_lon, location_alt, battery_normalized, object_json,
                    f_port, dev_addr, f_cnt, margin, external_power_source,
                    battery_level_unavailable, battery_level_join, frequency, spreading_factor, region_config_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["event_id"],
                    row["time"],
                    row["dev_eui"],
                    row["device_name"],
                    row["device_profile_name"],
                    row["application_id"],
                    row["application_name"],
                    row["gateway_ids"],
                    row["rssi"],
                    row["snr"],
                    row["location_lat"],
                    row["location_lon"],
                    row["location_alt"],
                    row["battery_normalized"],
                    row["object_json"],
                    row["f_port"],
                    row["dev_addr"],
                    row["f_cnt"],
                    row["margin"],
                    row["external_power_source"],
                    row["battery_level_unavailable"],
                    row["battery_level_join"],
                    row["frequency"],
                    row["spreading_factor"],
                    row["region_config_id"],
                ),
            )
            inserted += 1
        except sqlite3.IntegrityError as e:
            print("Insert error", file_path, e, file=sys.stderr)
            skipped += 1

    conn.commit()
    conn.close()

    print("Ingest complete:", db_path)
    print("  Inserted:", inserted)
    print("  Skipped (e.g. duplicate):", skipped)
    print("  Invalid (missing time/devEui or parse error):", invalid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
