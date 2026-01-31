# computer-networks-hackathon-ssi-canada
Template for the Computer Networks Hackathon in partnership with [SSi Canada](https://www.ssicanada.com) on January 31st, 2026.

## Repository Structure
- `LoRaWAN.tgz`: Compressed datasets
- `dataset/*`: Uncompressed datasets, each folder corresponds to data from a device
- `data/uplinks.db`: SQLite store of ingested uplinks (after running ingest)
- `scripts/`: Ingest script and API; `app/static/`: Dashboard UI

## What's built (ingest + dashboard)

**High level:** Raw ChirpStack uplink JSON (one file per event) is ingested into SQLite with normalized fields (time, device, gateway, battery, decoded payload). A small API serves device lists, time-series, and **gateway-based** site/correlation from that DB. A single-page dashboard offers: (1) **device views** — pick type and device, view time-series (level, soil, climate, doors, SW3L battery); (2) **Site (by gateway)** — pick a gateway, see “everything this gateway heard” (summary by device type, device health table, location when available, RSSI chart); (3) **Door + climate** — pick a gateway, see one timeline of door open/close and temp/humidity (“when the door opens, the room breathes”).

**Device coverage:** The dataset has **7 device types** and **26 devices** total. The dashboard has **5 views** that cover all 7 types:

| View | Device types | Devices | What you see |
|------|--------------|---------|--------------|
| Level | DDS75-LB, EM500-UDL | 2 | Distance (tank/level) over time |
| Soil | Makerfabs Soil Moisture | 4 | Soil value + temp over time |
| Climate | rbs305-ATH, RBS301 Temp | 12 | Temperature + humidity over time |
| Doors | rbs301-DWS | 7 | Open/closed (1/0) over time |
| Flow (SW3L) | SW3L | 1 | Battery over time (dataset has config/BAT only) |

**Expected counts:** You should see **7 device types** in the "Device type" dropdown (depending on the nav tab), and **26 devices** in the "Device" dropdown when "Device type" is left on the first option or when you view "All" via the API. Total events in the DB: **~14,200**.

**Run:** `python scripts/ingest.py` once, then `uvicorn scripts.api:app --reload --host 0.0.0.0 --port 8000`. Open **http://localhost:8000** in the browser.

## Helpful Resources
- [Getting Started with LoRaWAN by LoRa Alliance](https://resources.lora-alliance.org/getting-started-with-lorawan), [associated video](https://www.youtube.com/watch?v=rQ1AEA06Byw)
- [The Things Fundamentals on LoRaWAN](https://www.thethingsnetwork.org/docs/lorawan/), [associated video](https://www.youtube.com/watch?v=SmDza__-wAA)

## Important LoRaWAN Terminology
- `DevEUI`: unique device identifier (64 bit)
- `DevAddr`: device address (32 bit)
- `AppEUI`: application identifier (64 bit)
- `GatewayEUI`: gateway identifier (64 bit)

## Device Information
| Name | Link |
|---|---|
| Dragino DDS75-LB Ultrasonic Distance Sensor | https://www.dragino.com/products/distance-level-sensor/item/271-dds75-lb-ls.html |
| Makerfabs Soil Moisture Sensor (LoRaWAN) | https://github.com/Makerfabs/LoraWAN-Soil-Moisture?tab=readme-ov-file |
| Dragino SW3L | https://www.dragino.com/products/water-meter-flow-sensor/item/222-sw3l.html |
| Milesight EM500-UDL | https://www.milesight.com/iot/product/lorawan-sensor/em500-udl |
| MultiTech RBS301 Temp Sensor | https://multitech.com/wp-content/uploads/RB00020_Wireless_NoProbe_Temperature_Sensor_User_Guide.pdf |
| MultiTech RBS305-ATH | https://multitech.com/wp-content/uploads/RB00013_Wireless_Air_Temp_Humidity_Sensor_User_Guide.pdf |
| MultiTech RBS301-DWS | https://multitech.com/product/lorawan-door-window-sensor-for-indoor-use-north-america/ |
