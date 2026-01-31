# Dashboard Code Audit

## Current Structure (index.html ~937 lines)

| Section        | Lines (approx) | Description |
|----------------|----------------|-------------|
| HTML head      | 1–54           | Title, Leaflet/Chart scripts, **inline CSS** (~36 lines) |
| HTML body      | 55–143         | Nav, API banner, About, 5 cards (device, health, map, site, correlation) |
| Inline script  | 144–934        | **Single ~790-line script**: config, API, DOM refs, state, chart helpers, all view loaders, URL state, nav, init |

## Issues

1. **Monolithic script** – All logic in one block: API, charts, 5 views, URL state, and init. Hard to navigate and test.
2. **Inline CSS** – Styles in `<style>`; no reuse or cache. Theming lives in one place but can’t be shared.
3. **Global state scattered** – `chart`, `currentView`, `autoRefreshInterval`, `mapInstance`, `mapMarkers`, `chartSite`, `chartCorrelation`, `siteEventsCache`, `healthSortKey`, `healthSortDir` are top-level; relationship to “app state” is implicit.
4. **Repeated patterns** – Time range (24h) built in multiple places; “power” label (External/Battery) repeated; `document.getElementById(...)` used directly in view code instead of shared refs.
5. **Nested function** – `buildAnomalyAnnotations` is defined inside `loadChart`; could be a shared chart helper.
6. **Duplicate gateway filling** – `loadGateways()` and `loadMap()` both populate gateway dropdowns; logic could be centralized.
7. **Error handling** – Same “AbortError / Request timed out” message in many catch blocks; could be one helper.
8. **No clear entry point** – Script runs at end of body; “init” is the last few lines. Order of declaration matters for everything.

## Refactor Plan (Compartmentalize)

### 1. Extract CSS → `css/style.css`
- Move all `:root` and rule blocks into a single file.
- Link from index: `<link rel="stylesheet" href="css/style.css">`.

### 2. Split JS into namespaced modules (no bundler)
Use a single global `window.LoRaWAN` so scripts load in order and share state without passing many arguments.

| File           | Responsibility |
|----------------|----------------|
| `js/config.js` | `API`, `FETCH_TIMEOUT_MS`, `AUTO_REFRESH_MS`, `VIEW_PROFILES`, valid views list. |
| `js/api.js`    | `fetchWithTimeout`, `getProfiles`, `getDevices`, `getDevicesWithHealth`, `getDevicePassport`, `getTimeseries`, `getGateways`, `getSiteEvents`, `getCorrelation`, `getAnomalies`, `getAnomaliesDevice`. All use `LoRaWAN.config`. |
| `js/charts.js` | `buildAnomalyAnnotations(labels, list)`, `radioMeta(data)`, `createDeviceChart(ctx, data, view, annotationOpts)` returning Chart instance. |
| `js/url-state.js` | `getUrlState()`, `pushUrlState()`, `applyUrlDeviceSelection()`, `applyUrlGatewaySelection()`. Read/write DOM and state from `LoRaWAN.state` / `LoRaWAN.dom`. |
| `js/views.js`  | Device: `loadProfiles`, `loadDevices`, `loadChart`, `loadPassport`, `exportCsv`. Health: `loadHealth`, `initHealthSort`. Site: `loadGateways`, `loadSite`, `updateSiteScrubber`. Correlation: `loadCorrelation`, `mergeCorrelationEvents`. Map: `loadMap`. Shared: `setCardsVisibility`, `showApiUnavailable`, `hideApiUnavailable`. All use `LoRaWAN.api`, `LoRaWAN.charts`, `LoRaWAN.dom`, `LoRaWAN.state`. |
| `js/main.js`   | DOM refs (`LoRaWAN.dom`), state (`LoRaWAN.state`), `setActiveView`, `isDeviceView`, event listeners, call `applyUrl*`, then `setActiveView(initialView)` and `initHealthSort()`. |

### 3. index.html as shell
- Minimal markup: nav, cards, no inline styles (except where truly one-off).
- Script order: config → api → charts → url-state → views → main.
- Optional: one inline script that calls `LoRaWAN.init()` on `DOMContentLoaded` if main.js doesn’t run at end of body.

### 4. Cleanups within the split
- **Time range** – One helper e.g. `getTimeRange(rangeSelectValue)` returning `{ fromTime, toTime }` used by loadChart, exportCsv, and any API that needs from/to.
- **Power label** – One helper `formatPower(externalPowerSource)` used in passport, health table, site health.
- **API error message** – One helper `apiErrorMessage(e)` used in catch blocks.
- **Gateway options** – Single function `fillGatewaySelects(list)` used by loadGateways and loadMap.

## File Layout After Refactor

```
app/static/
  AUDIT.md          (this file)
  index.html        (~128 lines: structure + script links)
  css/
    style.css       (~120 lines)
  js/
    config.js       (~25 lines)
    api.js          (~115 lines)
    charts.js       (~105 lines)
    url-state.js    (~55 lines)
    views.js        (~380 lines)
    main.js         (~115 lines)
```

The API mounts this directory at `/` (StaticFiles), so `/`, `/css/style.css`, `/js/*.js` are served from here.

## Testing Checklist

- [ ] Device view: profile/device/range/fport, chart, anomalies, passport, export CSV, auto-refresh.
- [ ] Health view: table loads, column sort.
- [ ] Map view: gateways and pins, weak links, click pin → site view.
- [ ] Site view: gateway select, summary, health table, RSSI chart, scrubber, state-as-of.
- [ ] Correlation view: gateway select, door+climate chart, anomalies.
- [ ] URL state: ?view=...&device=...&gateway=...&range=... persists and restores.
- [ ] Nav: switching views shows correct card and loads data when needed.
