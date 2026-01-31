#!/usr/bin/env python3
"""
Phase 2 — API: time-series and device list from data/uplinks.db.

Endpoints:
  GET /api/devices       — list devices (dev_eui, device_name, device_profile_name, last_seen)
  GET /api/timeseries    — time-series for a device (dev_eui, from, to, profile)
  GET /api/profiles      — device profile names and counts
  GET /api/gateways      — gateway IDs and device counts
"""

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import csv
import io

APP_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = APP_ROOT / "data" / "uplinks.db"
STATIC_DIR = APP_ROOT / "app" / "static"
FONTS_DIR = APP_ROOT / "fonts"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_synthetic_column():
    """Add synthetic column if missing (for DBs created before synthetic was added)."""
    if not DB_PATH.is_file():
        return
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("ALTER TABLE uplinks ADD COLUMN synthetic INTEGER")
        conn.commit()
    except sqlite3.OperationalError:
        pass  # column already exists
    finally:
        conn.close()


app = FastAPI(title="LoRaWAN Dataset API", version="0.1.0")


@app.on_event("startup")
def on_startup():
    ensure_synthetic_column()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/profiles")
def list_profiles():
    """Device profile names and event counts."""
    conn = get_db()
    rows = conn.execute(
        """
        SELECT device_profile_name AS profile, COUNT(*) AS count
        FROM uplinks
        WHERE device_profile_name IS NOT NULL
        GROUP BY device_profile_name
        ORDER BY count DESC
        """
    ).fetchall()
    conn.close()
    return [{"profile": r["profile"], "count": r["count"]} for r in rows]


@app.get("/api/devices")
def list_devices(
    profile: str | None = Query(None, description="Filter by device_profile_name"),
    include_health: bool = Query(False, description="Include last rssi, snr, battery, margin"),
):
    """List devices with last_seen; optionally last rssi, snr, battery (payload or join), margin."""
    conn = get_db()
    if include_health:
        # One row per dev_eui with latest time; attach that row's rssi, snr, battery, margin
        sub_where = " WHERE device_profile_name = ?" if profile else ""
        outer_where = " WHERE u.device_profile_name = ?" if profile else ""
        rows = conn.execute(
            """
            SELECT u.dev_eui, u.device_name, u.device_profile_name, u.time AS last_seen,
                   u.rssi, u.snr, u.battery_normalized, u.battery_level_join, u.margin, u.external_power_source,
                   COALESCE(u.synthetic, 0) AS synthetic
            FROM uplinks u
            INNER JOIN (
                SELECT dev_eui, MAX(time) AS mt FROM uplinks
                """ + sub_where + """
                GROUP BY dev_eui
            ) m ON u.dev_eui = m.dev_eui AND u.time = m.mt
            """ + outer_where + """
            ORDER BY u.time DESC
            """,
            [profile, profile] if profile else [],
        ).fetchall()
        out = []
        seen = set()
        for r in rows:
            if r["dev_eui"] in seen:
                continue
            seen.add(r["dev_eui"])
            battery = r["battery_normalized"] if r["battery_normalized"] is not None else r["battery_level_join"]
            out.append({
                "dev_eui": r["dev_eui"],
                "device_name": r["device_name"],
                "device_profile_name": r["device_profile_name"],
                "last_seen": r["last_seen"],
                "rssi": r["rssi"],
                "snr": r["snr"],
                "battery": battery,
                "margin": r["margin"],
                "external_power_source": r["external_power_source"],
                "synthetic": 1 if (r["synthetic"]) else 0,
            })
        conn.close()
        return out
    if profile:
        rows = conn.execute(
            """
            SELECT dev_eui, device_name, device_profile_name, MAX(time) AS last_seen,
                   MAX(COALESCE(synthetic, 0)) AS synthetic
            FROM uplinks
            WHERE device_profile_name = ?
            GROUP BY dev_eui
            ORDER BY last_seen DESC
            """,
            (profile,),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT dev_eui, device_name, device_profile_name, MAX(time) AS last_seen,
                   MAX(COALESCE(synthetic, 0)) AS synthetic
            FROM uplinks
            GROUP BY dev_eui
            ORDER BY last_seen DESC
            """
        ).fetchall()
    conn.close()
    return [
        {
            "dev_eui": r["dev_eui"],
            "device_name": r["device_name"],
            "device_profile_name": r["device_profile_name"],
            "last_seen": r["last_seen"],
            "synthetic": 1 if (r["synthetic"]) else 0,
        }
        for r in rows
    ]


@app.get("/api/timeseries")
def get_timeseries(
    dev_eui: str = Query(..., description="Device EUI"),
    from_time: str | None = Query(None, alias="from"),
    to_time: str | None = Query(None, alias="to"),
    f_port: int | None = Query(None, description="Filter by fPort"),
    limit: int = Query(5000, ge=1, le=20000),
):
    """Time-series for a device: time, object, rssi, snr, battery_normalized, f_port, frequency, spreading_factor."""
    conn = get_db()
    args = [dev_eui]
    where = "dev_eui = ?"
    if from_time:
        where += " AND time >= ?"
        args.append(from_time)
    if to_time:
        where += " AND time <= ?"
        args.append(to_time)
    if f_port is not None:
        where += " AND f_port = ?"
        args.append(f_port)
    args.append(limit)
    rows = conn.execute(
        f"""
        SELECT time, object_json, rssi, snr, battery_normalized, f_port, frequency, spreading_factor
        FROM uplinks
        WHERE {where}
        ORDER BY time ASC
        LIMIT ?
        """,
        args,
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        obj = json.loads(r["object_json"]) if r["object_json"] else None
        out.append(
            {
                "time": r["time"],
                "object": obj,
                "rssi": r["rssi"],
                "snr": r["snr"],
                "battery_normalized": r["battery_normalized"],
                "f_port": r["f_port"],
                "frequency": r["frequency"],
                "spreading_factor": r["spreading_factor"],
            }
        )
    return out


@app.get("/api/gateways")
def list_gateways(
    with_location: bool = Query(False, alias="with_location", description="Include representative lat/lon/alt per gateway"),
):
    """Gateway IDs and event count; optionally representative location (from uplinks that have location)."""
    conn = get_db()
    rows = conn.execute(
        "SELECT gateway_ids FROM uplinks WHERE gateway_ids IS NOT NULL"
    ).fetchall()
    counts = {}
    for r in rows:
        try:
            gids = json.loads(r["gateway_ids"])
            for gid in gids:
                counts[gid] = counts.get(gid, 0) + 1
        except (json.JSONDecodeError, TypeError):
            pass
    out = [{"gateway_id": gid, "event_count": c} for gid, c in sorted(counts.items(), key=lambda x: -x[1])]
    if with_location:
        loc_rows = conn.execute(
            """
            SELECT gateway_ids, location_lat, location_lon, location_alt
            FROM uplinks
            WHERE gateway_ids IS NOT NULL AND location_lat IS NOT NULL AND location_lon IS NOT NULL
            ORDER BY time ASC
            """
        ).fetchall()
        loc_by_gw = {}
        for r in loc_rows:
            try:
                gids = json.loads(r["gateway_ids"])
                for gid in gids:
                    if gid not in loc_by_gw:
                        loc_by_gw[gid] = {
                            "lat": r["location_lat"],
                            "lon": r["location_lon"],
                            "alt": r["location_alt"],
                        }
            except (json.JSONDecodeError, TypeError):
                pass
        for g in out:
            gid = g["gateway_id"]
            if gid in loc_by_gw:
                g["lat"] = loc_by_gw[gid]["lat"]
                g["lon"] = loc_by_gw[gid]["lon"]
                g["alt"] = loc_by_gw[gid]["alt"]
    conn.close()
    return out


@app.get("/api/site")
def get_site_events(
    gateway: str = Query(..., description="Gateway ID"),
    from_time: str | None = Query(None, alias="from"),
    to_time: str | None = Query(None, alias="to"),
    limit: int = Query(5000, ge=1, le=20000),
):
    """All events seen by this gateway (for site view). Returns time, dev_eui, device_name, device_profile_name, object, rssi, snr, battery (coalesced), margin, external_power_source."""
    conn = get_db()
    args = [gateway]
    where = "EXISTS (SELECT 1 FROM json_each(uplinks.gateway_ids) j WHERE j.value = ?)"
    if from_time:
        where += " AND uplinks.time >= ?"
        args.append(from_time)
    if to_time:
        where += " AND uplinks.time <= ?"
        args.append(to_time)
    args.append(limit)
    rows = conn.execute(
        f"""
        SELECT time, dev_eui, device_name, device_profile_name, object_json, rssi, snr, battery_normalized, battery_level_join, margin, external_power_source,
               COALESCE(synthetic, 0) AS synthetic
        FROM uplinks
        WHERE {where}
        ORDER BY time ASC
        LIMIT ?
        """,
        args,
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        obj = json.loads(r["object_json"]) if r["object_json"] else None
        battery = r["battery_normalized"] if r["battery_normalized"] is not None else r["battery_level_join"]
        out.append({
            "time": r["time"],
            "dev_eui": r["dev_eui"],
            "device_name": r["device_name"],
            "device_profile_name": r["device_profile_name"],
            "object": obj,
            "rssi": r["rssi"],
            "snr": r["snr"],
            "battery_normalized": r["battery_normalized"],
            "battery_level_join": r["battery_level_join"],
            "battery": battery,
            "margin": r["margin"],
            "external_power_source": r["external_power_source"],
            "synthetic": 1 if (r["synthetic"]) else 0,
        })
    return out


@app.get("/api/correlation")
def get_correlation(
    gateway: str = Query(..., description="Gateway ID"),
    from_time: str | None = Query(None, alias="from"),
    to_time: str | None = Query(None, alias="to"),
    limit: int = Query(3000, ge=1, le=10000),
):
    """Merged timeline for door (DWS) + climate (ATH) at this gateway: events sorted by time with type, open, temperature, humidity."""
    conn = get_db()
    args = [gateway]
    where = "EXISTS (SELECT 1 FROM json_each(uplinks.gateway_ids) j WHERE j.value = ?) AND device_profile_name IN ('rbs301-dws', 'rbs305-ath')"
    if from_time:
        where += " AND uplinks.time >= ?"
        args.append(from_time)
    if to_time:
        where += " AND uplinks.time <= ?"
        args.append(to_time)
    args.append(limit)
    rows = conn.execute(
        f"""
        SELECT time, device_profile_name, object_json
        FROM uplinks
        WHERE {where}
        ORDER BY time ASC
        LIMIT ?
        """,
        args,
    ).fetchall()
    conn.close()
    events = []
    for r in rows:
        obj = json.loads(r["object_json"]) if r["object_json"] else {}
        profile = r["device_profile_name"]
        if profile == "rbs301-dws":
            events.append({
                "time": r["time"],
                "type": "door",
                "open": obj.get("open") if isinstance(obj.get("open"), (int, float)) else (1 if obj.get("eventType") == "OPEN" else 0),
            })
        elif profile == "rbs305-ath":
            events.append({
                "time": r["time"],
                "type": "climate",
                "temperature": obj.get("temperature"),
                "humidity": obj.get("humidity"),
            })
    return {"events": events}


def _gateway_anomalies(conn, gateway: str, from_time: str | None, to_time: str | None, limit: int) -> list:
    """Door-climate anomalies for one gateway. Returns list of {time, type, description}."""
    args = [gateway]
    where = "EXISTS (SELECT 1 FROM json_each(uplinks.gateway_ids) j WHERE j.value = ?) AND device_profile_name IN ('rbs301-dws', 'rbs305-ath')"
    if from_time:
        where += " AND uplinks.time >= ?"
        args.append(from_time)
    if to_time:
        where += " AND uplinks.time <= ?"
        args.append(to_time)
    args.append(limit)
    rows = conn.execute(
        f"""
        SELECT time, device_profile_name, object_json
        FROM uplinks
        WHERE {where}
        ORDER BY time ASC
        LIMIT ?
        """,
        args,
    ).fetchall()
    events = []
    for r in rows:
        obj = json.loads(r["object_json"]) if r["object_json"] else {}
        profile = r["device_profile_name"]
        if profile == "rbs301-dws":
            open_val = obj.get("open") if isinstance(obj.get("open"), (int, float)) else (1 if obj.get("eventType") == "OPEN" else 0)
            events.append({"time": r["time"], "type": "door", "open": open_val, "temperature": None})
        elif profile == "rbs305-ath":
            events.append({"time": r["time"], "type": "climate", "open": None, "temperature": obj.get("temperature")})
    anomalies = []
    last_temp_before_door = None
    for i, ev in enumerate(events):
        if ev["type"] == "climate" and ev["temperature"] is not None:
            last_temp_before_door = ev["temperature"]
        if ev["type"] == "door" and ev.get("open") == 1 and last_temp_before_door is not None:
            try:
                t_door = datetime.fromisoformat(ev["time"].replace("Z", "+00:00"))
            except Exception:
                continue
            window_end = (t_door + timedelta(minutes=60)).isoformat().replace("+00:00", "Z")
            temps_in_window = []
            for j in range(i + 1, len(events)):
                if events[j]["time"] > window_end:
                    break
                if events[j]["type"] == "climate" and events[j]["temperature"] is not None:
                    temps_in_window.append(events[j]["temperature"])
            if temps_in_window:
                delta = max(temps_in_window) - min(temps_in_window)
                if delta > 1.0:
                    anomalies.append({
                        "time": ev["time"],
                        "type": "door_temp_delta",
                        "description": f"Door opened; temperature varied by {delta:.1f}°C in next 60 min",
                    })
    return anomalies


@app.get("/api/anomalies")
def get_anomalies(
    gateway: str = Query(..., description="Gateway ID"),
    from_time: str | None = Query(None, alias="from"),
    to_time: str | None = Query(None, alias="to"),
    limit: int = Query(5000, ge=1, le=10000),
):
    """Rule-based anomalies: door opened + temperature changed > 1°C within next 60 minutes."""
    conn = get_db()
    try:
        anomalies = _gateway_anomalies(conn, gateway, from_time, to_time, limit)
        return {"anomalies": anomalies}
    finally:
        conn.close()


@app.get("/api/anomalies/org")
def get_anomalies_org(
    limit: int = Query(20, ge=1, le=100),
):
    """Recent anomalies across all gateways (door-climate correlation). Sorted by time descending."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT gateway_ids FROM uplinks WHERE gateway_ids IS NOT NULL"
        ).fetchall()
        gateways = set()
        for r in rows:
            try:
                gids = json.loads(r["gateway_ids"])
                for gid in gids:
                    gateways.add(gid)
            except (json.JSONDecodeError, TypeError):
                pass
        merged = []
        for gid in gateways:
            for a in _gateway_anomalies(conn, gid, None, None, 5000):
                merged.append({"gateway_id": gid, "time": a["time"], "type": a.get("type"), "description": a.get("description", "")})
        merged.sort(key=lambda x: x["time"] or "", reverse=True)
        return {"anomalies": merged[:limit]}
    finally:
        conn.close()


def _device_anomalies(rows: list, profile: str) -> list:
    """Rule-based anomalies per device profile. rows = [(time, object_json), ...] ordered by time."""
    anomalies = []
    for i, (time_val, obj_json) in enumerate(rows):
        obj = json.loads(obj_json) if obj_json else {}
        if not isinstance(obj, dict):
            continue
        try:
            t = datetime.fromisoformat(time_val.replace("Z", "+00:00"))
        except Exception:
            continue

        if profile == "Makerfabs Soil Moisture Sensor":
            soil = obj.get("soil_val")
            temp = obj.get("temp")
            if isinstance(temp, (int, float)) and i >= 1:
                # Temp dip: drop > 2°C in 1 hour (compare to recent values)
                window = [j for j in range(max(0, i - 24), i) if j != i]
                if window:
                    prev_temps = []
                    for j in window:
                        rj = rows[j]
                        o = json.loads(rj[1]) if rj[1] else {}
                        if isinstance(o.get("temp"), (int, float)):
                            prev_temps.append(o["temp"])
                    if prev_temps and temp < min(prev_temps) - 2:
                        anomalies.append({
                            "time": time_val,
                            "type": "temp_dip",
                            "description": f"Temperature dip to {temp}°C (drop > 2°C from recent)",
                        })
            if isinstance(soil, (int, float)) and i >= 2:
                prev_soils = []
                for j in range(max(0, i - 48), i):
                    o = json.loads(rows[j][1]) if rows[j][1] else {}
                    if isinstance(o.get("soil_val"), (int, float)):
                        prev_soils.append(o["soil_val"])
                if prev_soils and max(prev_soils) > 0:
                    pct = (max(prev_soils) - soil) / max(prev_soils) * 100
                    if pct > 20:
                        anomalies.append({
                            "time": time_val,
                            "type": "soil_drop",
                            "description": f"Soil value dropped ~{pct:.0f}% from recent",
                        })

        elif profile in ("rbs305-ath", "Multitech RBS301 Temp Sensor"):
            temp = obj.get("temperature")
            if isinstance(temp, (int, float)) and i >= 2:
                window_temps = []
                for j in range(max(0, i - 12), min(len(rows), i + 13)):
                    if j == i:
                        continue
                    o = json.loads(rows[j][1]) if rows[j][1] else {}
                    if isinstance(o.get("temperature"), (int, float)):
                        window_temps.append(o["temperature"])
                if len(window_temps) >= 2 and (max(window_temps) - min(window_temps)) > 2:
                    anomalies.append({
                        "time": time_val,
                        "type": "temp_swing",
                        "description": f"Temperature swing > 2°C in window (current {temp}°C)",
                    })

        elif "Ultrasonic" in profile or profile == "EM500-UDL":
            dist = obj.get("distance")
            if isinstance(dist, (int, float)) and i >= 1:
                prev = json.loads(rows[i - 1][1]) if rows[i - 1][1] else {}
                prev_d = prev.get("distance") if isinstance(prev.get("distance"), (int, float)) else None
                if prev_d is not None and abs(dist - prev_d) > 50:
                    anomalies.append({
                        "time": time_val,
                        "type": "distance_jump",
                        "description": f"Distance jump from {prev_d} to {dist}",
                    })

        elif profile == "rbs301-dws":
            open_val = obj.get("open")
            if open_val is None and obj.get("eventType") == "OPEN":
                open_val = 1
            if isinstance(open_val, (int, float)) and i >= 2:
                # Rapid toggle: open then closed within 2 events
                prev = json.loads(rows[i - 1][1]) if rows[i - 1][1] else {}
                p_open = prev.get("open") if isinstance(prev.get("open"), (int, float)) else (1 if prev.get("eventType") == "OPEN" else 0)
                if p_open != open_val:
                    anomalies.append({
                        "time": time_val,
                        "type": "door_toggle",
                        "description": "Door state changed",
                    })

        elif profile == "SW3L":
            bat = obj.get("BAT")
            if isinstance(bat, (int, float)) and i >= 3:
                prev_bats = [json.loads(rows[j][1]).get("BAT") for j in range(max(0, i - 6), i) if rows[j][1]]
                prev_bats = [b for b in prev_bats if isinstance(b, (int, float))]
                if prev_bats and bat < min(prev_bats) - 0.2:
                    anomalies.append({
                        "time": time_val,
                        "type": "battery_drop",
                        "description": f"Battery drop to {bat}V",
                    })
    return anomalies[:50]


@app.get("/api/anomalies/device")
def get_device_anomalies(
    dev_eui: str = Query(..., description="Device EUI"),
    from_time: str | None = Query(None, alias="from"),
    to_time: str | None = Query(None, alias="to"),
    limit: int = Query(5000, ge=1, le=10000),
):
    """Rule-based anomalies for a single device (soil temp dip, soil drop, climate swing, level jump, door toggle, battery drop)."""
    conn = get_db()
    row = conn.execute(
        "SELECT device_profile_name FROM uplinks WHERE dev_eui = ? LIMIT 1",
        (dev_eui,),
    ).fetchone()
    if not row:
        conn.close()
        return {"anomalies": []}
    profile = row["device_profile_name"] or ""
    args = [dev_eui]
    where = "dev_eui = ?"
    if from_time:
        where += " AND time >= ?"
        args.append(from_time)
    if to_time:
        where += " AND time <= ?"
        args.append(to_time)
    args.append(limit)
    rows = conn.execute(
        f"SELECT time, object_json FROM uplinks WHERE {where} ORDER BY time ASC LIMIT ?",
        args,
    ).fetchall()
    conn.close()
    rows_tuples = [(r["time"], r["object_json"]) for r in rows]
    anomalies = _device_anomalies(rows_tuples, profile)
    return {"anomalies": anomalies}


@app.get("/api/device/{dev_eui}")
def get_device_passport(dev_eui: str):
    """Device passport: first_seen, last_seen, gateways, application_name, payload keys, health, event_count."""
    conn = get_db()
    row = conn.execute(
        """
        SELECT device_name, device_profile_name, application_name, time AS last_seen,
               rssi, snr, battery_normalized, battery_level_join, margin, external_power_source,
               gateway_ids, object_json, COALESCE(synthetic, 0) AS synthetic
        FROM uplinks
        WHERE dev_eui = ?
        ORDER BY time DESC
        LIMIT 1
        """,
        (dev_eui,),
    ).fetchone()
    if not row:
        conn.close()
        return JSONResponse(status_code=404, content={"error": "Device not found", "dev_eui": dev_eui})
    first = conn.execute("SELECT MIN(time) AS t FROM uplinks WHERE dev_eui = ?", (dev_eui,)).fetchone()
    count = conn.execute("SELECT COUNT(*) AS c FROM uplinks WHERE dev_eui = ?", (dev_eui,)).fetchone()
    gw_rows = conn.execute("SELECT gateway_ids FROM uplinks WHERE dev_eui = ? AND gateway_ids IS NOT NULL", (dev_eui,)).fetchall()
    conn.close()
    gateways = []
    for r in gw_rows:
        try:
            gids = json.loads(r["gateway_ids"])
            for gid in gids:
                if gid not in gateways:
                    gateways.append(gid)
        except (json.JSONDecodeError, TypeError):
            pass
    obj = json.loads(row["object_json"]) if row["object_json"] else None
    payload_keys = list(obj.keys()) if isinstance(obj, dict) else []
    battery = row["battery_normalized"] if row["battery_normalized"] is not None else row["battery_level_join"]
    return {
        "dev_eui": dev_eui,
        "device_name": row["device_name"],
        "device_profile_name": row["device_profile_name"],
        "application_name": row["application_name"],
        "first_seen": first["t"] if first else None,
        "last_seen": row["last_seen"],
        "event_count": count["c"] if count else 0,
        "gateways": gateways,
        "payload_keys": payload_keys,
        "rssi": row["rssi"],
        "snr": row["snr"],
        "battery": battery,
        "margin": row["margin"],
        "external_power_source": row["external_power_source"],
        "synthetic": 1 if (row["synthetic"]) else 0,
    }


@app.get("/api/export")
def export_events(
    dev_eui: str = Query(..., description="Device EUI"),
    from_time: str | None = Query(None, alias="from"),
    to_time: str | None = Query(None, alias="to"),
    format: str = Query("csv", description="csv or json"),
):
    """Export timeseries as CSV or JSON for the device and time range."""
    conn = get_db()
    args = [dev_eui]
    where = "dev_eui = ?"
    if from_time:
        where += " AND time >= ?"
        args.append(from_time)
    if to_time:
        where += " AND time <= ?"
        args.append(to_time)
    args.append(10000)
    rows = conn.execute(
        f"""
        SELECT time, device_name, object_json, rssi, snr, battery_normalized, f_port, frequency, spreading_factor
        FROM uplinks
        WHERE {where}
        ORDER BY time ASC
        LIMIT ?
        """,
        args,
    ).fetchall()
    conn.close()
    if format == "json":
        out = []
        for r in rows:
            obj = json.loads(r["object_json"]) if r["object_json"] else None
            out.append({
                "time": r["time"],
                "device_name": r["device_name"],
                "object": obj,
                "rssi": r["rssi"],
                "snr": r["snr"],
                "battery_normalized": r["battery_normalized"],
                "f_port": r["f_port"],
                "frequency": r["frequency"],
                "spreading_factor": r["spreading_factor"],
            })
        return out
    # CSV
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["time", "device_name", "rssi", "snr", "battery_normalized", "f_port", "frequency", "spreading_factor", "object_json"])
    for r in rows:
        writer.writerow([
            r["time"],
            r["device_name"] or "",
            r["rssi"] if r["rssi"] is not None else "",
            r["snr"] if r["snr"] is not None else "",
            r["battery_normalized"] if r["battery_normalized"] is not None else "",
            r["f_port"] if r["f_port"] is not None else "",
            r["frequency"] if r["frequency"] is not None else "",
            r["spreading_factor"] if r["spreading_factor"] is not None else "",
            r["object_json"] or "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=uplinks.csv"},
    )


if STATIC_DIR.is_dir():
    if FONTS_DIR.is_dir():
        app.mount("/fonts", StaticFiles(directory=str(FONTS_DIR)), name="fonts")
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
