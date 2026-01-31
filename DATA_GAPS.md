# Data gaps and unparsed fields

Run `python scripts/data_gaps.py` to refresh counts. Summary below.

---

## How much data is missing (for the app to be used effectively)

| What | Count | % of 14,207 | Impact |
|------|-------|-------------|--------|
| **No/empty decoded payload** (`object_json`) | 549 | 3.9% | Those rows are join/status only — no telemetry for device charts. Charts show gaps or nulls. |
| **No gateway IDs** | 192 | 1.4% | Those rows cannot appear in **Site (by gateway)** or **Door + climate** (filtered by gateway). |
| **No gateway location** (lat/lon) | 9,433 | 66.4% | Only **33.6%** of uplinks have location. We still get one representative location per gateway (from uplinks that do have it), so the map works for gateways that had at least one uplink with location. |
| **No RSSI** | 192 | 1.4% | Same as no gateway_ids (join/status or no rxInfo). Health table and RSSI chart show gaps. |
| **No SNR** | 205 | 1.4% | Same. |
| **No battery (normalized)** | 5,360 | 37.7% | Many device types don’t send battery in the decoded payload (e.g. DWS, some RBS301 status). Health table and battery views show empty for those. |

**Bottom line:** The app is usable: ~96% of rows have a decoded payload, ~99% have gateway_ids (so Site and Correlation work), and we have enough location data to assign at least one position per gateway. The main gaps are: **no location for most uplinks** (so we can’t do “per-uplink” map points, only “per-gateway”), and **no battery for ~38%** (device-type dependent).

---

## What we parse (as of new parsing)

**Now stored:** `f_port`, `dev_addr`, `f_cnt`, `margin`, `external_power_source`, `battery_level_unavailable`, `battery_level_join`, `frequency`, `spreading_factor`, `region_config_id`. API: **GET /api/devices?include_health=1** returns last rssi, snr, battery (payload or join), margin, external_power_source. **GET /api/timeseries** returns `f_port`, `frequency`, `spreading_factor` per point and supports **?f_port=** to filter by port.

---

## What we still do not parse (raw JSON → DB)

| Category | Fields | Use if we parsed them |
|----------|--------|------------------------|
| **LoRaWAN link** | `adr`, `dr`, `confirmed`, `data` (base64) | **data** — custom decode or raw hex. (We now store devAddr, fCnt, fPort.) |
| **TX / radio** | `txInfo.modulation.bandwidth`, `txInfo.modulation.codeRate` | Bandwidth/code-rate views. (We now store frequency, spreadingFactor, regionConfigId.) |
| **Tenant/device** | `tenantId`, `tenantName`, `deviceProfileId`, `deviceClassEnabled`, `tags` | Filter by tenant; tags for custom labels. |
| **rxInfo (first only)** | We **drop**: uplinkId, nsTime, timeSinceGpsEpoch, channel, context, crcStatus. | **channel** — spectrum view. **crcStatus** — link quality. |
| **Multi-gateway** | We store all `gateway_ids` but only **one** rssi/snr/location (first gateway). | Per-gateway RSSI/SNR when a packet is received by multiple gateways. |

---

## What to add first (for a more effective app)

1. **fPort** — Store in DB; filter timeseries by port (e.g. SW3L flow on fPort X vs config on fPort Y). Low effort, high clarity.
2. **Join/status fields** — Store `margin`, `batteryLevel`, `externalPowerSource` when present; show in device list and “device passport.” Fills battery gap for join-only records.
3. **txInfo** — Store `frequency`, `spreadingFactor` (and optionally bandwidth/codeRate); enable “frequency / SF” view for radio analysis.
4. **Per-gateway RSSI/SNR** — Store `rxInfo` as JSON array (one entry per gateway) instead of only first; Site view could show “best gateway” or RSSI per gateway for each uplink. Higher effort.

The app is already effective for device charts, Site by gateway, and Door+climate; the gaps above mainly limit **radio-level** views, **battery** for some device types, and **map** to “one point per gateway” instead of “one point per uplink.”
