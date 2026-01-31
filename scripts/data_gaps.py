#!/usr/bin/env python3
"""Report missing/empty data and fields we don't parse. Run: python scripts/data_gaps.py"""

import json
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "data" / "uplinks.db"


def main():
    conn = sqlite3.connect(DB_PATH)
    total = conn.execute("SELECT COUNT(*) FROM uplinks").fetchone()[0]
    no_obj = conn.execute(
        "SELECT COUNT(*) FROM uplinks WHERE object_json IS NULL OR object_json = 'null' OR object_json = '{}'"
    ).fetchone()[0]
    no_gw = conn.execute("SELECT COUNT(*) FROM uplinks WHERE gateway_ids IS NULL").fetchone()[0]
    no_loc = conn.execute("SELECT COUNT(*) FROM uplinks WHERE location_lat IS NULL").fetchone()[0]
    has_loc = conn.execute("SELECT COUNT(*) FROM uplinks WHERE location_lat IS NOT NULL").fetchone()[0]
    no_rssi = conn.execute("SELECT COUNT(*) FROM uplinks WHERE rssi IS NULL").fetchone()[0]
    no_snr = conn.execute("SELECT COUNT(*) FROM uplinks WHERE snr IS NULL").fetchone()[0]
    no_bat = conn.execute("SELECT COUNT(*) FROM uplinks WHERE battery_normalized IS NULL").fetchone()[0]
    conn.close()

    pct = lambda n: round(100 * n / total, 1) if total else 0
    print("=== Missing data (stored but null/empty) ===\n")
    print(f"Total rows: {total}")
    print(f"No/empty object_json:  {no_obj:5}  ({pct(no_obj)}%)  -> no telemetry for charts")
    print(f"No gateway_ids:         {no_gw:5}  ({pct(no_gw)}%)  -> excluded from Site / Correlation")
    print(f"No location (lat/lon): {no_loc:5}  ({pct(no_loc)}%)  -> no map pin for that uplink")
    print(f"Has location:          {has_loc:5}  ({pct(has_loc)}%)")
    print(f"No rssi:               {no_rssi:5}  ({pct(no_rssi)}%)  -> join/status or no rxInfo")
    print(f"No snr:                {no_snr:5}  ({pct(no_snr)}%)")
    print(f"No battery_normalized: {no_bat:5}  ({pct(no_bat)}%)  -> object has no Bat/battery_*")
    print()
    print("=== Raw JSON fields we do NOT parse/store ===\n")
    print("- devAddr, adr, dr, fCnt, fPort, confirmed, data (base64)")
    print("- txInfo: frequency, modulation (bandwidth, spreadingFactor, codeRate)")
    print("- regionConfigId")
    print("- margin, externalPowerSource, batteryLevelUnavailable, batteryLevel (join/status)")
    print("- tenantId, tenantName, deviceProfileId, deviceClassEnabled, tags")
    print("- rxInfo: only first gateway's rssi/snr/location; we drop uplinkId, nsTime, timeSinceGpsEpoch, channel, context, crcStatus")
    print("- rxInfo: multiple gateways -> we store all gateway_ids but only one rssi/snr/location (first)")
    print()
    print("=== Impact for app effectiveness ===\n")
    print(f"- ~{pct(no_obj)}% of rows have no decoded payload -> device charts show gaps; join/status-only records.")
    print(f"- ~{pct(no_loc)}% of rows have no gateway location -> map shows only gateways that had at least one uplink with location.")
    print(f"- Rows with no gateway_ids ({pct(no_gw)}%) cannot be used in Site or Door+climate views.")
    print("- We do not store fPort -> cannot filter by port (e.g. SW3L flow vs config).")
    print("- We do not store join/status fields (margin, batteryLevel) -> device list cannot show 'last join margin'.")
    print("- We do not store txInfo -> no 'frequency / SF' view for radio analysis.")


if __name__ == "__main__":
    main()
