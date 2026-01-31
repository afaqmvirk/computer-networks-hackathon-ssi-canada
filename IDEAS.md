# Unique ideas to take the project further

Ideas below use **only the existing dataset** (no live LoRaWAN). They build on the current ingest + API + single-device dashboard and are ordered by distinctiveness and feasibility.

---

## Gateway + location: how they work together

**Yes — location is very useful alongside gateway.** In this dataset, “location” is the **gateway’s reception point** (where the packet was received), not the device’s position. We have **~4,800 uplinks** with `location_lat` / `location_lon` (and `location_alt`). That gives you:

| Use | How |
|-----|-----|
| **“Where is this site?”** | Per gateway: take median or first (lat, lon) from uplinks that have location → one position per gateway. Show on site view: “Gateway 0080… at 61.35°N, 117.65°W.” |
| **Map of gateways** | Plot one pin per gateway (using that representative location). Click pin → open “Site view” for that gateway. |
| **“Sites in a region”** | Filter gateways by bounding box (min/max lat/lon) so users see “gateways near me” or “gateways in this area.” |
| **Device passport** | “Seen by gateways: 0080… (61.35°N, 117.65°W), 0016… (45.34°N, -75.90°W)” so you know where the device was heard. |
| **Coverage story** | “We have gateways in X locations; here’s what each one sees” — map + site view together. |

So: **gateway** = “which radio site,” **location** = “where that site is.” Use both: site view by gateway *and* show gateway location on a map or as coordinates.

---

## 1. Gateway as “the site” — one view per gateway (+ location)

**Idea:** Treat **gatewayId** as “the site” instead of application. One page per gateway: “Everything this gateway heard” — level, soil, climate, doors, and link health in one place. **Add location:** show where the gateway is (lat/lon from `rxInfo.location`) — on a small map, or as “Site: 61.35°N, 117.65°W” so “the site” has a physical place.

**Why unique:** Most demos group by application; your data has ATH and DWS on *different* applications but the *same* gateways. Using gateway as the glue is accurate and tells a clear story: “This is what one radio site sees.” Location makes “site” concrete: “This gateway in Fort McMurray” vs “this gateway in Ottawa.”

**Location in this dataset:** The `location_lat` / `location_lon` (and `location_alt`) we store come from **gateway** reception — i.e. where the packet was received (gateway position), not the device’s position. So “location” = “where is this gateway / radio site?” That’s still very useful: map of gateways, “sites on a map,” and “which gateways are in this region?”

**What to build:**
- API: `GET /api/gateways/:id/events` or `GET /api/site?gateway=...` returning all device types and time-series for that gateway (filter uplinks where `gateway_ids` contains the id).
- Dashboard: “Site view” tab — pick a gateway from a list, then see mini-charts or panels for level, soil, climate, doors, and a “device health” list (last RSSI/SNR, battery) for devices that used that gateway.

**Data:** Already in DB: `gateway_ids` (JSON array), `device_profile_name`, `object_json`, `rssi`, `snr`, `time`. For location: `location_lat`, `location_lon`, `location_alt` — **~4,800 uplinks** have gateway location; aggregate per gateway (e.g. median or first non-null) to get “gateway position” for the site view and map.

---

## 2. “When the door opens, the room breathes” — ATH + DWS on one timeline

**Idea:** For a chosen **gateway**, show one timeline: door open/close events as markers, temperature and humidity as lines. Let the user scrub time and see “door opened → temp/humidity changed” without any ML.

**Why unique:** Connects two device types (climate + access) that others often keep separate. Clear narrative for judges: “We correlated by gateway and time.”

**What to build:**
- API: `GET /api/correlation?gateway=...&from=...&to=...` returning merged series: DWS events (time, open 0/1) and ATH events (time, temperature, humidity) for devices that used that gateway, sorted by time.
- Dashboard: “Correlation” or “Door + climate” view — select gateway, one chart with dual Y-axes (temp/humidity) and vertical markers or step line for door state.

**Data:** DWS and ATH both use gateway `008000000002aa4b` (and others). Align by `time` and `gateway_ids`.

---

## 3. Time scrubber / “replay” for a gateway

**Idea:** A single timeline with a **scrubber**. As the user moves the playhead, show only events up to that time for the selected gateway: which devices had reported, last value per device type, and a simple “state of the site at this moment” summary.

**Why unique:** Feels like a “live” demo without live data. Good for presentations: “At 2pm on Jan 20, this gateway had seen 3 doors, 2 climate sensors, 1 level sensor.”

**What to build:**
- API: Same as site view; optionally `?until=ISO_TIME` to return events with `time <= until`.
- Dashboard: Play/pause + slider for time; panels update to show “as of &lt;time&gt;”: list of devices and their last payload before that time.

**Data:** Same as (1); filter by `time <= until` in API.

---

## 4. Network health map — gateways and link quality (location + gateway)

**Idea:** A **map** of gateways using **location** (`location_lat` / `location_lon` where present). Color or size pins by “number of devices” or “median RSSI”. Click a pin → site view for that gateway (level, soil, climate, doors, health). List “weak links”: devices with RSSI below a threshold. **Gateway + location together:** “Where are my gateways?” and “What does each one see?”

**Why unique:** Uses the **radio** layer (RSSI, SNR, **gateway location**), not just payloads. Shows you understand LoRaWAN beyond application data. Location answers “where is this site?” and makes the map possible.

**What to build:**
- API: `GET /api/gateways` extended with `?with_location=1`: for each gateway, return a **representative location** (e.g. median lat/lon from uplinks that have location) and device/event count. Only gateways with at least one uplink that has non-null `location_lat/lon`.
- Dashboard: Map (e.g. Leaflet or static map) with one pin per gateway; click pin → open “Site view” for that gateway or navigate to `/?gateway=...`. “Weak links” = devices with last RSSI &lt; -100.

**Data:** **~4,800 uplinks** have `location_lat/lon` (from rxInfo — gateway reception point). Aggregate per gateway (median/first) to get one position per gateway. All uplinks have `rssi`/`snr`.

---

## 5. “Device passport” — one page per device

**Idea:** One URL per device (e.g. `/device/:dev_eui`) showing: **first seen / last seen**, **gateways** it used, **application** name, **payload schema** (keys from `object_json`), and a small **health** summary (last battery, last RSSI/SNR). Optional: last 24h mini-chart.

**Why unique:** Single place for “everything we know about this device” — useful for ops and for explaining the dataset. Shareable link for demos.

**What to build:**
- API: `GET /api/device/:dev_eui` returning first_seen, last_seen, list of gateway_ids, application_name, sample object keys, last battery, last rssi/snr, event count.
- Dashboard: Device detail page (or modal) with the above and a link to the existing time-series chart for this device.

**Data:** All in DB; first_seen / last_seen = MIN(time), MAX(time) per dev_eui.

---

## 6. Battery and link health — “who needs maintenance?”

**Idea:** One screen: **all 26 devices** in a table — last seen, last battery (normalized), last RSSI/SNR. Sort by “oldest last_seen” or “lowest battery” or “worst RSSI”. No charts, just a maintenance-style list.

**Why unique:** Operational view that crosses all device types. Easy to demo: “We unified battery and link quality across 7 device types.”

**What to build:**
- API: `GET /api/devices` already returns devices; extend with `?include_health=1` to attach last `battery_normalized`, last `rssi`, last `snr` (from latest event per dev_eui).
- Dashboard: “Health” or “Maintenance” tab — table with columns Device, Type, Last seen, Battery, RSSI, SNR; sortable.

**Data:** Already in DB per event; aggregate per dev_eui (e.g. last row by time).

---

## 7. Simple anomaly highlights (no ML)

**Idea:** Rule-based “interesting moments”: e.g. “door opened and temperature changed by &gt; 1°C within the next hour,” or “soil_val dropped &gt; 20% in 24h.” Show these as **highlighted ranges or markers** on the existing timeline.

**Why unique:** Adds a bit of “intelligence” without models. Judges see “we derived events from rules.”

**What to build:**
- API: `GET /api/anomalies?gateway=...&from=...&to=...` with simple rules (e.g. door open + temp delta in next N minutes); return list of `{ time, type, description }`.
- Dashboard: When viewing correlation or site view, overlay markers or a list of “Anomalies” for the current time range.

**Data:** Same as (2); compute in API or in a small background pass.

---

## 8. Export for ops — CSV / PDF report

**Idea:** “Download” for the current view: **CSV** of events (time, dev_eui, device_name, payload fields, rssi, snr, battery) for the selected device(s) or gateway and time range. Optional: **PDF** summary (device list, time range, event count, one chart screenshot or table).

**Why unique:** Makes the dataset usable for reports and external tools. Low effort, high practicality.

**What to build:**
- API: `GET /api/export?dev_eui=...&from=...&to=...&format=csv` returning CSV stream; or same with `format=json` for power users.
- Dashboard: “Export” button next to time range that downloads CSV for current device and range.

**Data:** Same as timeseries; flatten object_json into columns or one JSON column.

---

## 9. LoRaWAN “explainer” layer

**Idea:** Optional **tooltips or a small “Learn” panel** on the dashboard: “RSSI = signal strength; closer to 0 is better.” “This gateway heard 5 device types.” “Spreading factor 7 = faster, less range.” Link to LoRa Alliance / TTN docs.

**Why unique:** Positions the project as educational — good for hackathon judges and for SSi Canada’s audience.

**What to build:**
- Dashboard: Collapsible “About LoRaWAN” or tooltips on RSSI/SNR/gateway; short 1–2 sentence explanations and one link to official docs.

**Data:** No new data; reuse existing labels and add static copy.

---

## 10. Shareable “story” links

**Idea:** URLs that encode view state: e.g. `/?gateway=008000000002aa4b&view=correlation&from=2026-01-20&to=2026-01-22`. Opening the link restores that gateway, view, and range — useful for demos and documentation.

**Why unique:** Lets you send “here’s the exact view we’re presenting” without clicking through.

**What to build:**
- Dashboard: On change of gateway/view/range, update URL (e.g. `history.replaceState` or query params). On load, read query params and set dropdowns and range.

**Data:** No new API; only front-end state in URL.

---

## Suggested order to implement

| Priority | Idea | Why |
|----------|------|-----|
| 1 | **Gateway as the site** (1) | Foundation for “site” and correlation; uses gateway_ids. |
| 2 | **“When the door opens…”** (2) | Strong narrative; builds on (1). |
| 3 | **Battery / link health** (6) | Quick win; extend existing `/api/devices`. |
| 4 | **Device passport** (5) | One API endpoint + one detail page; high clarity. |
| 5 | **Export CSV** (8) | Simple API + button; very practical. |
| 6 | **Network health map** (4) | High impact; needs map UI and location aggregation. |
| 7 | **Time scrubber** (3), **Anomalies** (7), **Explainer** (9), **Shareable links** (10) | Nice extras once (1)–(6) are in place. |

All of the above stay within the current dataset and DB; no new ingest step required except for (4) if you want to pre-aggregate gateway locations.
