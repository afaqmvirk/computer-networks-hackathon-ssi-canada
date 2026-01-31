# Scripts

## Phase 1 — Ingest

**`ingest.py`** — Walks `dataset/<DeviceType>/<devEui>/*.json`, parses ChirpStack uplink JSON, normalizes battery and envelope fields, and writes to **`data/uplinks.db`** (SQLite).

### Usage

```bash
python scripts/ingest.py
```

### Output

- **`data/uplinks.db`** — Single table `uplinks` with: `event_id`, `time`, `dev_eui`, `device_name`, `device_profile_name`, `application_id`, `application_name`, `gateway_ids` (JSON), `rssi`, `snr`, `location_lat/lon/alt`, `battery_normalized`, `object_json`; plus **f_port**, **dev_addr**, **f_cnt**, **margin**, **external_power_source**, **battery_level_unavailable**, **battery_level_join**, **frequency**, **spreading_factor**, **region_config_id**.
- Indexes on `dev_eui`, `time`, `device_profile_name`, `application_id`.

### Requirements

- Python 3 (stdlib only: `json`, `pathlib`, `sqlite3`).

---

## Phase 2 — API and dashboard

**`api.py`** — FastAPI app that reads from `data/uplinks.db` and serves:
- **GET /api/profiles** — Device profile names and event counts
- **GET /api/devices** — List devices (optional `?profile=...`); includes `last_seen`
- **GET /api/timeseries** — Time-series for a device (`?dev_eui=...&from=...&to=...&limit=5000`)
- **GET /api/gateways** — Gateway IDs and event counts; `?with_location=1` adds representative lat/lon/alt per gateway
- **GET /api/site** — All events seen by a gateway (`?gateway=...&from=...&to=...&limit=5000`) for “Site (by gateway)” view
- **GET /api/correlation** — Merged door (DWS) + climate (ATH) timeline for a gateway (`?gateway=...`) for “Door + climate” view
- **GET /** — Dashboard (device views: Level, Soil, Climate, Doors, SW3L; **Site (by gateway)**; **Door + climate**)

### Usage

From the project root:

```bash
pip install -r requirements.txt   # fastapi, uvicorn
uvicorn scripts.api:app --reload --host 0.0.0.0 --port 8000
```

Then in your browser open **http://localhost:8000** or **http://127.0.0.1:8000** (do not use http://0.0.0.0:8000 — that bind address is for the server only). Use the nav to switch between Level (DDS75/EM500), Soil (Makerfabs), Climate (ATH/RBS301), Doors (DWS), Health, Map, Site (by gateway), and Door + climate. Pick device type and device; time range: full window or last 24h.

---

## Synthetic data (optional)

**`generate_synthetic.py`** — Inserts fake device uplinks into **`data/uplinks.db`** with **`synthetic=1`** and device names like **"Synthetic Soil 1"**. Use when you have little real data; all synthetic devices are clearly labeled ** [Synthetic]** in the dashboard.

### Usage

Run **after** ingest (ingest adds the `synthetic` column via migration):

```bash
python scripts/ingest.py    # if not already done
python scripts/generate_synthetic.py
```

Then **refresh the dashboard** (F5 or reload). In **Soil** (or Level, Climate, etc.) open the **Device** dropdown — you should see **Synthetic Soil 1 [Synthetic]** and **Synthetic Soil 2 [Synthetic]** (and similar for other device types). If you don’t see them, the generator hasn’t been run yet.

### Output

- Adds ~24–50+ rows per synthetic device (Soil 1/2, Level 1, Climate 1/2, Door 1, SW3L 1) over the same time range as real data.
- All synthetic uplinks use **gateway `synthetic-gateway-01`** and a fixed **location (Ottawa area, 45.42°N, 75.69°W)** so they appear under one “site” in **Map** and **Site (by gateway)**.
- Payloads include intentional anomalies (e.g. temp dip, distance jump) for testing anomaly detection.
- Dashboard shows ** [Synthetic]** next to device names in dropdowns, Health table, Site health, Map weak links, and Passport.

### Where to see synthetic devices

| Where | How |
|-------|-----|
| **Level / Soil / Climate / Doors / Flow** | Pick the device type (e.g. Makerfabs Soil Moisture Sensor), then in **Device** choose **Synthetic Soil 1 [Synthetic]** or **Synthetic Soil 2 [Synthetic]** (and similar for other types). |
| **Health** | Open the **Health** tab — synthetic devices appear in the table with ** [Synthetic]** after the name. |
| **Map** | Open the **Map** tab — one pin is **synthetic-gateway-01** (Ottawa area). Click it to jump to Site view for synthetic devices. |
| **Site (by gateway)** | In **Gateway** select **synthetic-gateway-01** — you’ll see only synthetic devices and their events at that “site”. |

### Live / auto-refresh with synthetic data

1. In any device view (e.g. **Soil**), select a **synthetic** device (e.g. **Synthetic Soil 1 [Synthetic]**).
2. Check **Live / auto-refresh (15 s)** — the chart refetches every 15 seconds and shows **Last updated: HH:MM:SS**.
3. To see **new points** over time, run in a separate terminal (while the API is running):

   ```bash
   python scripts/append_synthetic_live.py
   ```

   This appends one new uplink every 30 seconds for a synthetic device. With auto-refresh on, the chart will show the new point after the next refresh.
