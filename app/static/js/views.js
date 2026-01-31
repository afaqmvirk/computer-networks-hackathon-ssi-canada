/**
 * View loaders: device (profiles, devices, chart, passport, export), health, site, correlation, map.
 * Uses LoRaWAN.dom, LoRaWAN.state, LoRaWAN.api, LoRaWAN.charts, LoRaWAN.config, LoRaWAN.url.
 */
(function () {
  'use strict';

  function apiErrMsg(e) {
    return "Couldn't load data. Please check your connection and try again.";
  }

  function getTimeRange(rangeValue) {
    if (rangeValue !== '24h') return { fromTime: null, toTime: null };
    var to = new Date();
    var from = new Date();
    from.setHours(from.getHours() - 24);
    return { fromTime: from.toISOString(), toTime: to.toISOString() };
  }

  function computeDoorSummary(data) {
    if (!Array.isArray(data) || !data.length) return null;
    var openCount = 0;
    var lastOpened = null;
    var totalOpenMin = 0;
    var totalClosedMin = 0;
    var prevOpen = null;
    var segments = [];
    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      var open = d.object && (d.object.open === 1 || d.object.open === true);
      var t = d.time ? new Date(d.time).getTime() : NaN;
      if (i > 0 && !isNaN(t)) {
        var prevT = data[i - 1].time ? new Date(data[i - 1].time).getTime() : NaN;
        if (!isNaN(prevT)) {
          var durMin = (t - prevT) / 60000;
          segments.push({ startMs: prevT, endMs: t, open: prevOpen });
          if (prevOpen) totalOpenMin += durMin; else totalClosedMin += durMin;
        }
      }
      if (open && !prevOpen) {
        openCount++;
        lastOpened = d.time;
      }
      prevOpen = open;
    }
    return { openCount: openCount, lastOpened: lastOpened, totalOpenMin: totalOpenMin, totalClosedMin: totalClosedMin, segments: segments };
  }

  function formatPower(ext) {
    return ext === 1 ? 'External' : (ext === 0 ? 'Battery' : '—');
  }

  function showApiUnavailable(msg) {
    var el = document.getElementById('api-unavailable');
    if (el) {
      el.textContent = msg || 'Cannot reach API. Start the server: python -m scripts.api (from project root).';
      el.style.display = 'block';
    }
  }

  function hideApiUnavailable() {
    var el = document.getElementById('api-unavailable');
    if (el) el.style.display = 'none';
  }

  function loadProfiles() {
    var dom = window.LoRaWAN.dom;
    var state = window.LoRaWAN.state;
    var api = window.LoRaWAN.api;
    var config = window.LoRaWAN.config;
    var url = window.LoRaWAN.url;
    if (!dom || !state) return;
    hideApiUnavailable();
    dom.errEl.textContent = '';
    api.getProfiles().then(function (list) {
      dom.profileSelect.innerHTML = '';
      var forView = (config.VIEW_PROFILES[state.currentView] || []);
      list.forEach(function (p) {
        if (forView.length && forView.indexOf(p.profile) === -1) return;
        var opt = document.createElement('option');
        opt.value = p.profile;
        opt.textContent = p.profile + ' (' + p.count + ')';
        dom.profileSelect.appendChild(opt);
      });
      url.applyUrlDeviceSelection();
      return loadDevices().catch(function (e) {
        dom.errEl.textContent = e.name === 'AbortError' ? 'Request timed out.' : e.message;
        dom.deviceSelect.innerHTML = '<option value="">Load failed – try again</option>';
        dom.metaEl.textContent = '';
      });
    }).catch(function (e) {
      showApiUnavailable(apiErrMsg(e));
      dom.errEl.textContent = apiErrMsg(e);
      dom.profileSelect.innerHTML = '<option value="">No data</option>';
      dom.deviceSelect.innerHTML = '<option value="">Choose device type first</option>';
      dom.metaEl.textContent = '';
    });
  }

  function loadDevices() {
    var dom = window.LoRaWAN.dom;
    var api = window.LoRaWAN.api;
    var url = window.LoRaWAN.url;
    if (!dom) return;
    dom.errEl.textContent = '';
    var profile = dom.profileSelect.value;
    if (!profile) { dom.metaEl.textContent = ''; return Promise.resolve(); }
    return api.getDevices(profile).then(function (list) {
      dom.deviceSelect.innerHTML = '';
      list.forEach(function (d) {
        var opt = document.createElement('option');
        opt.value = d.dev_eui;
        opt.textContent = (d.device_name || d.dev_eui) + (d.synthetic ? ' [Synthetic]' : '') + ' — ' + d.dev_eui;
        dom.deviceSelect.appendChild(opt);
      });
      url.applyUrlDeviceSelection();
      return loadChart();
    }).catch(function (e) {
      dom.errEl.textContent = e.name === 'AbortError' ? 'Request timed out.' : e.message;
        dom.deviceSelect.innerHTML = '<option value="">Load failed – try again</option>';
      dom.metaEl.textContent = '';
    });
  }

  function loadChart() {
    var dom = window.LoRaWAN.dom;
    var state = window.LoRaWAN.state;
    var api = window.LoRaWAN.api;
    var charts = window.LoRaWAN.charts;
    var config = window.LoRaWAN.config;
    if (!dom || !state) return Promise.resolve();
    dom.errEl.textContent = '';
    dom.metaEl.textContent = 'Loading…';
    var devEui = dom.deviceSelect.value;
    if (!devEui) { dom.metaEl.textContent = ''; return Promise.resolve(); }
    var range = getTimeRange(dom.rangeSelect.value);
    return api.getTimeseries(devEui, range.fromTime, range.toTime, dom.fportSelect.value || null).then(function (data) {
      if (!Array.isArray(data)) {
        dom.errEl.textContent = 'Invalid response from API';
        dom.metaEl.textContent = '';
        return;
      }
      var labels = data.map(function (d) { return d.time; });
      return api.getAnomaliesDevice(devEui, range.fromTime, range.toTime).then(function (anom) {
        var anomalyList = Array.isArray(anom.anomalies) ? anom.anomalies : [];
        var annotationOpts = { annotation: { annotations: charts.buildAnomalyAnnotations(labels, anomalyList) } };
        if (state.chart) state.chart.destroy();
        var ctx = document.getElementById('chart');
        if (!ctx) return;
        state.chart = charts.createDeviceChart(ctx.getContext('2d'), data, state.currentView, annotationOpts);
        var metaLines = {
          level: data.length + ' points. Y = distance (device units).',
          soil: data.length + ' points. Soil value + temp.',
          climate: data.length + ' points. Temp + humidity.',
          doors: data.length + ' points. Door open/closed.',
          sw3l: data.length + ' points. SW3L battery (dataset has config/BAT only).'
        };
        dom.metaEl.textContent = (metaLines[state.currentView] || '') + charts.radioMeta(data);
        var doorSummaryEl = document.getElementById('device-door-summary');
        var doorTimeWrap = document.getElementById('door-time-wrap');
        var doorGanttWrap = document.getElementById('door-gantt-wrap');
        var doorGanttEl = document.getElementById('door-gantt');
        if (state.currentView === 'doors' && data.length) {
          var doorStats = computeDoorSummary(data);
          if (doorStats) {
            if (doorSummaryEl) {
              doorSummaryEl.style.display = 'block';
              var parts = [];
              parts.push('Opened <strong>' + doorStats.openCount + '</strong> time(s) in range');
              if (doorStats.lastOpened) parts.push('Last opened: <strong>' + (doorStats.lastOpened.slice(0, 16)).replace('T', ' ') + '</strong>');
              if (doorStats.totalOpenMin != null) parts.push('Total open: <strong>' + (doorStats.totalOpenMin < 1 ? (Math.round(doorStats.totalOpenMin * 60) + ' s') : (Math.round(doorStats.totalOpenMin * 10) / 10 + ' min')) + '</strong>');
              doorSummaryEl.innerHTML = '<div class="door-summary-inner">' + parts.join(' · ') + '</div>';
            }
            if (doorTimeWrap && doorGanttWrap && doorGanttEl) {
              doorTimeWrap.style.display = 'block';
              doorGanttWrap.style.display = 'block';
              var openMin = doorStats.totalOpenMin || 0;
              var closedMin = doorStats.totalClosedMin || 0;
              if (state.doorTimeChart) state.doorTimeChart.destroy();
              var doorTimeCtx = document.getElementById('door-time-chart');
              if (doorTimeCtx && window.Chart) {
                var openLabel = 'Open (' + (openMin < 1 ? (Math.round(openMin * 60) + ' s') : (Math.round(openMin * 10) / 10 + ' min')) + ')';
                var closedLabel = 'Closed (' + (closedMin < 1 ? (Math.round(closedMin * 60) + ' s') : (Math.round(closedMin * 10) / 10 + ' min')) + ')';
                state.doorTimeChart = new window.Chart(doorTimeCtx, {
                  type: 'doughnut',
                  data: {
                    labels: [openLabel, closedLabel],
                    datasets: [{
                      data: [openMin, closedMin],
                      backgroundColor: ['#f85149', '#8b949e'],
                      borderColor: 'var(--bg)',
                      borderWidth: 2
                    }]
                  },
                  options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } }, cutout: '55%' }
                });
              }
              var segs = doorStats.segments || [];
              if (segs.length) {
                var t0 = segs[0].startMs;
                var t1 = segs[segs.length - 1].endMs;
                var totalMs = t1 - t0 || 1;
                var html = '';
                segs.forEach(function (s) {
                  var w = Math.max(0.5, ((s.endMs - s.startMs) / totalMs) * 100);
                  html += '<div class="door-gantt-seg ' + (s.open ? 'door-gantt-open' : 'door-gantt-closed') + '" style="width:' + w + '%" title="' + (s.open ? 'Open' : 'Closed') + '"></div>';
                });
                doorGanttEl.innerHTML = html;
              } else doorGanttEl.innerHTML = '<p class="meta empty-state">No segments.</p>';
            }
          } else {
            if (doorSummaryEl) doorSummaryEl.style.display = 'none';
            if (doorTimeWrap) doorTimeWrap.style.display = 'none';
            if (doorGanttWrap) doorGanttWrap.style.display = 'none';
          }
        } else {
          if (doorSummaryEl) doorSummaryEl.style.display = 'none';
          if (doorTimeWrap) doorTimeWrap.style.display = 'none';
          if (doorGanttWrap) doorGanttWrap.style.display = 'none';
          if (state.doorTimeChart) { state.doorTimeChart.destroy(); state.doorTimeChart = null; }
        }
        var anomEl = document.getElementById('device-anomalies');
        if (anomEl) {
          var html = '<p class="meta"><strong>Anomalies</strong> (rule-based: temp dip, soil drop, distance jump, door toggle, battery drop):</p>';
          if (anomalyList.length) {
            anomalyList.forEach(function (a) {
              html += '<div class="anomaly-item"><strong>' + (a.time || '').slice(0, 19) + '</strong> ' + (a.description || a.type || '') + '</div>';
            });
          } else {
            html += '<p class="meta empty-state">None detected in this range.</p>';
          }
          anomEl.innerHTML = html;
        }
        var lastEl = document.getElementById('last-updated');
        if (document.getElementById('auto-refresh') && document.getElementById('auto-refresh').checked && lastEl) {
          lastEl.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
        }
      }).catch(function () {});
    }).catch(function (e) {
      dom.errEl.textContent = apiErrMsg(e);
      dom.metaEl.textContent = '';
    });
  }

  function loadPassport() {
    var dom = window.LoRaWAN.dom;
    var api = window.LoRaWAN.api;
    if (!dom) return;
    var devEui = dom.deviceSelect.value;
    var panel = document.getElementById('passport-panel');
    var loadingEl = document.getElementById('passport-loading');
    var contentEl = document.getElementById('passport-content');
    if (!devEui) { if (panel) panel.style.display = 'none'; return; }
    if (panel) panel.style.display = 'block';
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.innerHTML = '';
    api.getDevicePassport(devEui).then(function (p) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (p.error) { if (contentEl) contentEl.innerHTML = '<span class="error">' + p.error + '</span>'; return; }
      var power = formatPower(p.external_power_source);
      var synthLabel = p.synthetic ? ' <span class="meta">[Synthetic]</span>' : '';
      var html = '<table style="font-size:0.875rem;"><tr><td class="meta">Device</td><td>' + (p.device_name || p.dev_eui) + synthLabel + '</td></tr>';
      html += '<tr><td class="meta">First seen</td><td>' + (p.first_seen || '').slice(0, 19) + '</td></tr>';
      html += '<tr><td class="meta">Last seen</td><td>' + (p.last_seen || '').slice(0, 19) + '</td></tr>';
      html += '<tr><td class="meta">Event count</td><td>' + (p.event_count != null ? p.event_count : '') + '</td></tr>';
      html += '<tr><td class="meta">Application</td><td>' + (p.application_name || '—') + '</td></tr>';
      html += '<tr><td class="meta">Gateways</td><td>' + (p.gateways && p.gateways.length ? p.gateways.join(', ') : '—') + '</td></tr>';
      html += '<tr><td class="meta">Payload keys</td><td>' + (p.payload_keys && p.payload_keys.length ? p.payload_keys.join(', ') : '—') + '</td></tr>';
      html += '<tr><td class="meta">RSSI / SNR</td><td>' + (p.rssi != null ? p.rssi : '—') + ' / ' + (p.snr != null ? p.snr : '—') + '</td></tr>';
      html += '<tr><td class="meta">Battery / Margin / Power</td><td>' + (p.battery != null ? p.battery : '—') + ' / ' + (p.margin != null ? p.margin : '—') + ' / ' + power + '</td></tr></table>';
      if (contentEl) contentEl.innerHTML = html;
    }).catch(function (e) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.innerHTML = '<span class="error">' + (e.name === 'AbortError' ? 'Request timed out.' : e.message) + '</span>';
    });
  }

  function exportCsv() {
    var dom = window.LoRaWAN.dom;
    var config = window.LoRaWAN.config;
    if (!dom) return;
    var devEui = dom.deviceSelect.value;
    if (!devEui) { dom.errEl.textContent = 'Choose a device first.'; return; }
    var range = getTimeRange(dom.rangeSelect.value);
    var url = config.API + '/export?dev_eui=' + encodeURIComponent(devEui) + '&format=csv';
    if (range.fromTime) url += '&from=' + encodeURIComponent(range.fromTime);
    if (range.toTime) url += '&to=' + encodeURIComponent(range.toTime);
    window.open(url, '_blank', 'noopener');
  }

  function loadHealth() {
    var dom = window.LoRaWAN.dom;
    var state = window.LoRaWAN.state;
    var api = window.LoRaWAN.api;
    if (!state) return;
    var loadingEl = document.getElementById('health-loading');
    var errElH = document.getElementById('health-error');
    if (loadingEl) loadingEl.innerHTML = '<span class="spinner" aria-hidden="true"></span> Loading...';
    if (errElH) errElH.textContent = '';
    api.getDevicesWithHealth().then(function (list) {
      if (loadingEl) loadingEl.textContent = '';
      var tbody = document.querySelector('#health-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      var sorted = list.slice().sort(function (a, b) {
        var key = state.healthSortKey;
        var dir = state.healthSortDir;
        var va = a[key], vb = b[key];
        if (key === 'device') { va = (a.device_name || a.dev_eui) || ''; vb = (b.device_name || b.dev_eui) || ''; return dir * (va.localeCompare(vb)); }
        if (key === 'type') { va = (a.device_profile_name || '') || ''; vb = (b.device_profile_name || '') || ''; return dir * (va.localeCompare(vb)); }
        if (key === 'last_seen') { va = va || ''; vb = vb || ''; return dir * (va.localeCompare(vb)); }
        if (key === 'power') { va = formatPower(a.external_power_source) || ''; vb = formatPower(b.external_power_source) || ''; return dir * (va.localeCompare(vb)); }
        if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb);
        va = (va != null ? String(va) : ''); vb = (vb != null ? String(vb) : '');
        return dir * (va.localeCompare(vb));
      });
      sorted.forEach(function (d) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + (d.device_name || d.dev_eui) + (d.synthetic ? ' [Synthetic]' : '') + '</td><td>' + (d.device_profile_name || '') + '</td><td>' + (d.last_seen || '').slice(0, 19) + '</td><td>' + (d.battery != null ? d.battery : '') + '</td><td>' + (d.rssi != null ? d.rssi : '') + '</td><td>' + (d.snr != null ? d.snr : '') + '</td><td>' + (d.margin != null ? d.margin : '') + '</td><td>' + formatPower(d.external_power_source) + '</td>';
        tbody.appendChild(tr);
      });
    }).catch(function (e) {
      if (loadingEl) loadingEl.textContent = '';
      if (errElH) errElH.textContent = e.name === 'AbortError' ? 'Request timed out.' : e.message;
    });
  }

  function initHealthSort() {
    var state = window.LoRaWAN.state;
    if (!state) return;
    document.querySelectorAll('#health-table th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        if (state.healthSortKey === key) state.healthSortDir = -state.healthSortDir;
        else { state.healthSortKey = key; state.healthSortDir = 1; }
        loadHealth();
      });
    });
  }

  function destroyDashboardCharts() {
    var charts = window.LoRaWAN.dashboardCharts;
    if (Array.isArray(charts)) {
      charts.forEach(function (c) { if (c && typeof c.destroy === 'function') c.destroy(); });
      window.LoRaWAN.dashboardCharts = [];
    }
  }

  function stopDashboardDeviceCycle() {
    var id = window.LoRaWAN.dashboardDeviceInterval;
    if (id) { clearInterval(id); window.LoRaWAN.dashboardDeviceInterval = null; }
    var charts = window.LoRaWAN.dashboardDeviceCardCharts;
    if (Array.isArray(charts)) {
      charts.forEach(function (c) { if (c && typeof c.destroy === 'function') c.destroy(); });
      window.LoRaWAN.dashboardDeviceCardCharts = [];
    }
    var globe = window.LoRaWAN.dashboardGlobe;
    if (globe && globe.remove) { globe.remove(); window.LoRaWAN.dashboardGlobe = null; }
  }

  function createDashboardCharts(profiles, gateways) {
    var Chart = window.Chart;
    var config = window.LoRaWAN.config;
    if (!Chart || !config) return;
    destroyDashboardCharts();
    var viewProfiles = config.VIEW_PROFILES || {};
    var viewLabels = { level: 'Level', soil: 'Soil', climate: 'Climate', doors: 'Doors' };
    var deviceTypeViews = ['level', 'soil', 'climate', 'doors'];
    var typeCounts = {};
    deviceTypeViews.forEach(function (v) { typeCounts[v] = 0; });
    (profiles || []).forEach(function (p) {
      var profileName = p.profile;
      var count = (p.count != null) ? Number(p.count) : 0;
      deviceTypeViews.forEach(function (v) {
        var list = viewProfiles[v];
        if (list && list.indexOf(profileName) !== -1) typeCounts[v] += count;
      });
    });
    var typeLabels = deviceTypeViews.map(function (v) { return viewLabels[v] || v; });
    var typeData = deviceTypeViews.map(function (v) { return typeCounts[v]; });
    var colors = ['#58a6ff', '#3fb950', '#d29922', '#a371f7'];
    var typesCtx = document.getElementById('dashboard-chart-types');
    var gatewaysCtx = document.getElementById('dashboard-chart-gateways');
    var stored = [];
    if (typesCtx && typeLabels.length) {
      var chartTypes = new Chart(typesCtx, {
        type: 'doughnut',
        data: {
          labels: typeLabels,
          datasets: [{ data: typeData, backgroundColor: colors, borderColor: 'var(--bg)', borderWidth: 2 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { position: 'bottom' } },
          cutout: '55%'
        }
      });
      stored.push(chartTypes);
    }
    if (gatewaysCtx && gateways && gateways.length) {
      var gwLabels = gateways.map(function (g) {
        var id = (g.gateway_id || '').toString();
        return id === 'synthetic-gateway-01' ? 'Synthetic' : (id.length > 10 ? '…' + id.slice(-8) : id);
      });
      var gwData = gateways.map(function (g) { return g.event_count || 0; });
      var chartGateways = new Chart(gatewaysCtx, {
        type: 'bar',
        data: {
          labels: gwLabels,
          datasets: [{ label: 'Events', data: gwData, backgroundColor: '#58a6ff', borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { maxTicksLimit: 6 } },
            y: { ticks: { font: { size: 11 } } }
          }
        }
      });
      stored.push(chartGateways);
    }
    window.LoRaWAN.dashboardCharts = stored;
  }

  function loadDashboard() {
    var dom = window.LoRaWAN.dom;
    var api = window.LoRaWAN.api;
    var config = window.LoRaWAN.config;
    var setActiveView = window.LoRaWAN.setActiveView;
    if (!dom || !api || !setActiveView) return;
    stopDashboardDeviceCycle();
    var loadingEl = document.getElementById('dashboard-loading');
    var errEl = document.getElementById('dashboard-err');
    var contentEl = document.getElementById('dashboard-content');
    var sitesEl = document.getElementById('dashboard-sites');
    var deviceCardsEl = document.getElementById('dashboard-device-cards');
    var insightsEl = document.getElementById('dashboard-insights');
    var globeEl = document.getElementById('dashboard-globe');
    if (errEl) errEl.textContent = '';
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';
    if (sitesEl) sitesEl.innerHTML = '';
    if (deviceCardsEl) deviceCardsEl.innerHTML = '';
    if (insightsEl) insightsEl.innerHTML = '';
    if (globeEl) globeEl.innerHTML = '';

    var viewLabels = { level: 'Level', soil: 'Soil', climate: 'Climate', doors: 'Doors' };
    var viewOrder = ['level', 'soil', 'climate', 'doors'];
    var mapping = (config && config.GATEWAY_BANNER_IMAGES) ? config.GATEWAY_BANNER_IMAGES : {};
    var fallback = (config && config.GATEWAY_BANNER_FALLBACK) ? config.GATEWAY_BANNER_FALLBACK : 'site-banner-placeholder.svg';

    function goToSite(gatewayId, gatewaysList) {
      dom.gatewaySelect.innerHTML = '';
      dom.gatewayCorrelationSelect.innerHTML = '';
      gatewaysList.forEach(function (gw) {
        var opt = document.createElement('option');
        opt.value = gw.gateway_id;
        opt.textContent = gw.gateway_id + ' (' + (gw.event_count || 0) + ' events' + (gw.lat != null ? ', ' + gw.lat.toFixed(4) + '°' : '') + ')';
        dom.gatewaySelect.appendChild(opt);
        dom.gatewayCorrelationSelect.appendChild(opt.cloneNode(true));
      });
      dom.gatewaySelect.value = gatewayId;
      dom.gatewayCorrelationSelect.value = gatewayId;
      setActiveView('site');
    }

    api.getGateways(true).then(function (gateways) {
      hideApiUnavailable();
      window.LoRaWAN.dashboardGatewaysList = gateways || [];
      if (!Array.isArray(gateways) || !gateways.length) {
        if (sitesEl) sitesEl.innerHTML = '<p class="meta empty-state">No gateways.</p>';
        return Promise.all([]);
      }
      var sitePromises = gateways.map(function (g) {
        return api.getSiteEvents(g.gateway_id, null, null).then(function (events) {
          var rssiList = (events || []).map(function (e) { return e.rssi != null ? e.rssi : null; }).filter(function (v) { return v != null; });
          var last30 = rssiList.slice(-30);
          var lastRssi = last30.length ? last30[last30.length - 1] : null;
          var bgImg = mapping[g.gateway_id] || fallback;
          var bgUrl = 'url(images/' + bgImg + ')';
          var card = document.createElement('div');
          card.className = 'dashboard-site-card';
          card.innerHTML = '<div class="dashboard-site-bg" style="background-image:' + bgUrl + '"></div>' +
            '<div class="dashboard-site-content">' +
            '<div class="dashboard-site-title">' + (g.gateway_id === 'synthetic-gateway-01' ? 'Synthetic' : (g.gateway_id.length > 12 ? '…' + g.gateway_id.slice(-10) : g.gateway_id)) + '</div>' +
            '<div class="dashboard-site-rssi-value">' + (lastRssi != null ? lastRssi + ' dBm' : '—') + '</div>' +
            '<div class="dashboard-site-rssi-spark"><canvas width="200" height="32" aria-hidden="true"></canvas></div>' +
            '<button type="button" class="btn-secondary">View site</button></div>';
          var btn = card.querySelector('.btn-secondary');
          if (btn) btn.addEventListener('click', function () { goToSite(g.gateway_id, gateways); });
          var canvas = card.querySelector('canvas');
          if (canvas && last30.length && window.Chart) {
            new window.Chart(canvas.getContext('2d'), {
              type: 'line',
              data: { labels: last30.map(function (_, i) { return i; }), datasets: [{ data: last30, borderColor: 'rgba(255,255,255,0.9)', borderWidth: 1, fill: false, tension: 0.2 }] },
              options: { responsive: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
            });
          }
          sitesEl.appendChild(card);
        }).catch(function () {
          var card = document.createElement('div');
          card.className = 'dashboard-site-card';
          card.innerHTML = '<div class="dashboard-site-bg" style="background-image:url(images/' + fallback + ')"></div><div class="dashboard-site-content"><div class="dashboard-site-title">' + g.gateway_id + '</div><div class="dashboard-site-rssi-value">—</div><button type="button" class="btn-secondary">View site</button></div>';
          var btn = card.querySelector('.btn-secondary');
          if (btn) btn.addEventListener('click', function () { goToSite(g.gateway_id, gateways); });
          sitesEl.appendChild(card);
        });
      });
      return Promise.all(sitePromises);
    }).then(function () {
      return api.getDevices().then(function (devices) {
        if (!deviceCardsEl || !config || !Array.isArray(devices)) return;
        var viewProfiles = config.VIEW_PROFILES || {};
        var devicesByView = {};
        viewOrder.forEach(function (view) {
          var profiles = viewProfiles[view];
          if (!profiles) return;
          devicesByView[view] = devices.filter(function (d) { return profiles.indexOf(d.device_profile_name) !== -1; });
        });
        var cardCharts = [];
        viewOrder.forEach(function (view) {
          var list = devicesByView[view] || [];
          var card = document.createElement('a');
          card.href = '#';
          card.className = 'dashboard-device-type-card';
          card.dataset.view = view;
          card.innerHTML = '<div class="dashboard-dt-title">' + (viewLabels[view] || view) + '</div><div class="dashboard-dt-device meta" data-device>—</div><div class="dashboard-dt-value" data-value>—</div><div class="dashboard-dt-spark"><canvas width="160" height="36" data-spark></canvas></div>';
          card.addEventListener('click', function (e) { e.preventDefault(); setActiveView(view); });
          deviceCardsEl.appendChild(card);
        });
        window.LoRaWAN.dashboardDeviceCardCharts = [];
        window.LoRaWAN.dashboardDevicesByView = devicesByView;
        window.LoRaWAN.dashboardDeviceIndexByView = { level: 0, soil: 0, climate: 0, doors: 0 };

        function updateDeviceCard(view, dev, data) {
          var cards = deviceCardsEl.querySelectorAll('.dashboard-device-type-card');
          var card = Array.prototype.find.call(cards, function (c) { return c.dataset.view === view; });
          if (!card) return;
          var deviceEl = card.querySelector('[data-device]');
          var valueEl = card.querySelector('[data-value]');
          var canvas = card.querySelector('[data-spark]');
          if (deviceEl) deviceEl.textContent = dev ? (dev.device_name || dev.dev_eui) : '—';
          if (!data || !data.length) { if (valueEl) valueEl.textContent = '—'; return; }
          var last = data[data.length - 1];
          var val = '';
          if (view === 'level') val = (last.object && typeof last.object.distance === 'number') ? last.object.distance + '' : '—';
          else if (view === 'soil') val = (last.object && typeof last.object.soil_val === 'number') ? last.object.soil_val + '' : '—';
          else if (view === 'climate') val = (last.object && typeof last.object.temperature === 'number') ? last.object.temperature + '°C' : '—';
          else if (view === 'doors') val = (last.object && (last.object.open === 1 || last.object.open === true)) ? 'Open' : 'Closed';
          if (valueEl) valueEl.textContent = val || '—';
          var sparkData = [];
          if (view === 'level') sparkData = data.map(function (d) { return d.object && typeof d.object.distance === 'number' ? d.object.distance : null; });
          else if (view === 'soil') sparkData = data.map(function (d) { return d.object && typeof d.object.soil_val === 'number' ? d.object.soil_val : null; });
          else if (view === 'climate') sparkData = data.map(function (d) { return d.object && typeof d.object.temperature === 'number' ? d.object.temperature : null; });
          else if (view === 'doors') sparkData = data.map(function (d) { return d.object && (d.object.open === 1 || d.object.open === true) ? 1 : 0; });
          if (canvas && window.Chart && sparkData.some(function (v) { return v != null; })) {
            var existing = window.LoRaWAN.dashboardDeviceCardCharts[viewOrder.indexOf(view)];
            if (existing && existing.destroy) existing.destroy();
            window.LoRaWAN.dashboardDeviceCardCharts[viewOrder.indexOf(view)] = new window.Chart(canvas.getContext('2d'), {
              type: 'line',
              data: { labels: sparkData.map(function (_, i) { return i; }), datasets: [{ data: sparkData, borderColor: '#58a6ff', borderWidth: 1, fill: false, tension: 0.2, spanGaps: true }] },
              options: { responsive: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
            });
          }
        }

        function refreshDeviceCards() {
          viewOrder.forEach(function (view) {
            var list = devicesByView[view] || [];
            if (!list.length) return;
            var idx = (window.LoRaWAN.dashboardDeviceIndexByView[view] || 0) % list.length;
            var dev = list[idx];
            api.getTimeseries(dev.dev_eui, null, null, null).then(function (data) {
              updateDeviceCard(view, dev, Array.isArray(data) ? data.slice(-50) : []);
            }).catch(function () { updateDeviceCard(view, dev, []); });
          });
        }
        refreshDeviceCards();
        var intervalId = setInterval(function () {
          viewOrder.forEach(function (view) {
            var list = devicesByView[view] || [];
            if (list.length) window.LoRaWAN.dashboardDeviceIndexByView[view] = (window.LoRaWAN.dashboardDeviceIndexByView[view] || 0) + 1;
          });
          refreshDeviceCards();
        }, 5000);
        window.LoRaWAN.dashboardDeviceInterval = intervalId;
      });
    }).then(function () {
      return api.getAnomaliesOrg(20).then(function (res) {
        var list = (res && res.anomalies) ? res.anomalies : [];
        if (!insightsEl) return;
        if (!list.length) { insightsEl.innerHTML = '<p class="meta empty-state">No recent anomalies.</p>'; return; }
        list.forEach(function (a) {
          var div = document.createElement('div');
          div.className = 'dashboard-insight-item';
          div.innerHTML = '<strong>' + (a.time ? a.time.slice(0, 16).replace('T', ' ') : '') + '</strong> ' + (a.gateway_id ? '[' + (a.gateway_id === 'synthetic-gateway-01' ? 'Synthetic' : a.gateway_id.slice(-8)) + '] ' : '') + (a.description || a.type || '');
          insightsEl.appendChild(div);
        });
      });
    }).then(function () {
      var withLoc = (window.LoRaWAN.dashboardGatewaysList || []).filter(function (g) { return g.lat != null && g.lon != null; });
      if (globeEl && withLoc.length && window.L) {
        try {
          if (window.LoRaWAN.dashboardGlobe && window.LoRaWAN.dashboardGlobe.remove) window.LoRaWAN.dashboardGlobe.remove();
          var map = window.L.map(globeEl).setView([20, 0], 2);
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
          withLoc.forEach(function (g) {
            window.L.marker([g.lat, g.lon]).addTo(map).bindPopup('<b>' + (g.gateway_id || '') + '</b><br/>' + (g.event_count || 0) + ' events');
          });
          window.LoRaWAN.dashboardGlobe = map;
        } catch (err) {}
      }
    }).then(function () {
      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.style.display = 'flex';
    }).catch(function (e) {
      showApiUnavailable(apiErrMsg(e));
      if (loadingEl) loadingEl.style.display = 'none';
      if (errEl) errEl.textContent = apiErrMsg(e);
    });
  }

  function loadGateways() {
    var dom = window.LoRaWAN.dom;
    var state = window.LoRaWAN.state;
    var api = window.LoRaWAN.api;
    var url = window.LoRaWAN.url;
    if (!dom || !state) return;
    api.getGateways().then(function (list) {
      hideApiUnavailable();
      dom.gatewaySelect.innerHTML = '';
      dom.gatewayCorrelationSelect.innerHTML = '';
      list.forEach(function (g) {
        var opt = document.createElement('option');
        opt.value = g.gateway_id;
        opt.textContent = g.gateway_id + ' (' + g.event_count + ' events' + (g.lat != null ? ', ' + g.lat.toFixed(4) + '°' : '') + ')';
        dom.gatewaySelect.appendChild(opt);
        dom.gatewayCorrelationSelect.appendChild(opt.cloneNode(true));
      });
      url.applyUrlGatewaySelection();
      if (state.currentView === 'site') return loadSite();
      if (state.currentView === 'correlation') return loadCorrelation();
    }).catch(function (e) {
      showApiUnavailable(apiErrMsg(e));
      var siteErr = document.getElementById('site-err');
      var siteMeta = document.getElementById('site-meta');
      if (siteErr) siteErr.textContent = apiErrMsg(e);
      if (siteMeta) siteMeta.textContent = '';
    });
  }

  function loadSite() {
    var dom = window.LoRaWAN.dom;
    var state = window.LoRaWAN.state;
    var api = window.LoRaWAN.api;
    if (!dom || !state) return Promise.resolve();
    var gateway = dom.gatewaySelect.value;
    var siteErr = document.getElementById('site-err');
    var siteMeta = document.getElementById('site-meta');
    if (siteErr) siteErr.textContent = '';
    if (siteMeta) siteMeta.innerHTML = '<span class="spinner" aria-hidden="true"></span> Loading…';
    if (!gateway) {
      var bannerEl = document.getElementById('site-banner');
      if (bannerEl) bannerEl.style.display = 'none';
      if (siteMeta) siteMeta.textContent = '';
      return Promise.resolve();
    }
    var bannerEl = document.getElementById('site-banner');
    var bannerImg = document.getElementById('site-banner-img');
    var bannerCaption = document.getElementById('site-banner-caption');
    if (bannerEl) bannerEl.style.display = 'block';
    if (bannerCaption) bannerCaption.textContent = 'Gateway: ' + gateway;
    if (bannerImg && gateway) {
      var config = window.LoRaWAN.config;
      var mapping = (config && config.GATEWAY_BANNER_IMAGES) ? config.GATEWAY_BANNER_IMAGES : {};
      var fallbackImg = (config && config.GATEWAY_BANNER_FALLBACK) ? config.GATEWAY_BANNER_FALLBACK : null;
      var placeholderSrc = 'images/site-banner-placeholder.svg';
      var firstSrc = mapping[gateway] ? ('images/' + mapping[gateway]) : (fallbackImg ? ('images/' + fallbackImg) : null);
      if (!firstSrc) {
        var safe = (gateway + '').replace(/[^a-zA-Z0-9-_]/g, '_');
        firstSrc = 'images/site-banner-' + safe + '.jpg';
      }
      bannerImg.onerror = function () {
        var s = bannerImg.src || '';
        var mappedSrc = mapping[gateway] ? ('images/' + mapping[gateway]) : null;
        var usedFallback = fallbackImg && s.indexOf('images/' + fallbackImg) !== -1;
        if ((mappedSrc && s.indexOf(mappedSrc) !== -1) || usedFallback) {
          bannerImg.onerror = null;
          bannerImg.src = placeholderSrc;
        } else if (s.indexOf('.jpg') !== -1 && !mapping[gateway]) {
          bannerImg.src = s.replace(/\.jpg$/i, '.png');
        } else if (s.indexOf('site-banner-') !== -1 && s.indexOf('.png') !== -1) {
          bannerImg.src = 'images/site-banner.jpg';
        } else if (s.indexOf('site-banner.jpg') !== -1) {
          bannerImg.src = 'images/site-banner.png';
        } else {
          bannerImg.onerror = null;
          bannerImg.src = placeholderSrc;
        }
      };
      bannerImg.src = firstSrc;
    }
    api.getGateways().then(function (gateways) {
      var gw = gateways.find(function (g) { return g.gateway_id === gateway; });
      var siteLoc = document.getElementById('site-location');
      if (siteLoc) siteLoc.textContent = (gw && gw.lat != null) ? 'Location: ' + gw.lat.toFixed(4) + '°N, ' + gw.lon.toFixed(4) + '°W' + (gw.alt != null ? ', ' + gw.alt + ' m' : '') : 'Location: not in dataset';
      return api.getSiteEvents(gateway, null, null);
    }).then(function (events) {
      if (!Array.isArray(events)) {
        if (siteMeta) siteMeta.textContent = '';
        if (siteErr) siteErr.textContent = 'Invalid response';
        return;
      }
      var byProfile = {};
      var lastByDev = {};
      events.forEach(function (ev) {
        var p = ev.device_profile_name || 'Other';
        if (!byProfile[p]) byProfile[p] = [];
        byProfile[p].push(ev);
        var key = ev.dev_eui;
        if (!lastByDev[key] || ev.time > lastByDev[key].time) lastByDev[key] = ev;
      });
      var summaryHtml = '<div class="row" style="flex-wrap: wrap; gap: 0.5rem;">';
      Object.keys(byProfile).forEach(function (profile) {
        var arr = byProfile[profile];
        var devices = new Set(arr.map(function (e) { return e.dev_eui; })).size;
        summaryHtml += '<span style="background: var(--border); padding: 0.25rem 0.5rem; border-radius: 4px;">' + profile + ': ' + devices + ' device(s), ' + arr.length + ' events</span>';
      });
      summaryHtml += '</div>';
      var siteSummary = document.getElementById('site-summary');
      if (siteSummary) siteSummary.innerHTML = summaryHtml;
      var siteDevicesEl = document.getElementById('site-devices');
      if (siteDevicesEl) {
        var config = window.LoRaWAN.config;
        var profileToView = {};
        if (config && config.VIEW_PROFILES) {
          Object.keys(config.VIEW_PROFILES).forEach(function (v) {
            (config.VIEW_PROFILES[v] || []).forEach(function (p) { profileToView[p] = v; });
          });
        }
        var uniqueDevices = [];
        var seen = {};
        events.forEach(function (ev) {
          var k = ev.dev_eui;
          if (!seen[k]) { seen[k] = true; uniqueDevices.push({ dev_eui: ev.dev_eui, device_name: ev.device_name, device_profile_name: ev.device_profile_name }); }
        });
        siteDevicesEl.innerHTML = '';
        uniqueDevices.forEach(function (d) {
          var profileName = d.device_profile_name || '';
          var view = profileToView[profileName] || 'level';
          var a = document.createElement('a');
          a.href = '?view=' + encodeURIComponent(view) + '&profile=' + encodeURIComponent(profileName) + '&device=' + encodeURIComponent(d.dev_eui);
          a.className = 'site-device-link';
          a.textContent = (d.device_name || d.dev_eui) + (d.device_profile_name ? ' (' + d.device_profile_name + ')' : '');
          a.addEventListener('click', function (e) {
            e.preventDefault();
            var params = new URLSearchParams();
            params.set('view', view);
            params.set('profile', profileName);
            params.set('device', d.dev_eui);
            window.history.pushState({}, '', (window.location.pathname || '') + '?' + params.toString());
            if (window.LoRaWAN.setActiveView) window.LoRaWAN.setActiveView(view, { preserveUrl: true });
          });
          siteDevicesEl.appendChild(a);
        });
        if (!uniqueDevices.length) siteDevicesEl.innerHTML = '<p class="meta empty-state">No devices at this site.</p>';
      }
      var rssiCtx = document.getElementById('chart-site-rssi');
      if (rssiCtx && window.Chart) {
        if (state.chartSiteRssi) state.chartSiteRssi.destroy();
        var rssiLabels = events.slice(-200).map(function (e) { return e.time; });
        var rssiData = events.slice(-200).map(function (e) { return e.rssi != null ? e.rssi : null; });
        state.chartSiteRssi = new window.Chart(rssiCtx.getContext('2d'), {
          type: 'line',
          data: { labels: rssiLabels, datasets: [{ label: 'RSSI (dBm)', data: rssiData, borderColor: '#58a6ff', tension: 0.2, spanGaps: true }] },
          options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: true, ticks: { maxTicksLimit: 10 } }, y: { reverse: true, title: { display: true, text: 'RSSI (dBm)' } } } }
        });
      }
      var healthRows = Object.keys(lastByDev).map(function (k) { return lastByDev[k]; }).sort(function (a, b) { return (b.time || '').localeCompare(a.time || ''); });
      var healthHtml = '<table style="width:100%; font-size:0.875rem; margin-top:0.5rem;"><thead><tr><th>Device</th><th>Type</th><th>Last seen</th><th>RSSI</th><th>SNR</th><th>Battery</th><th>Margin</th><th>Power</th></tr></thead><tbody>';
      healthRows.slice(0, 30).forEach(function (ev) {
        var battery = ev.battery != null ? ev.battery : (ev.battery_normalized != null ? ev.battery_normalized : ev.battery_level_join);
        healthHtml += '<tr><td>' + (ev.device_name || ev.dev_eui) + (ev.synthetic ? ' [Synthetic]' : '') + '</td><td>' + (ev.device_profile_name || '') + '</td><td>' + (ev.time || '').slice(0, 19) + '</td><td>' + (ev.rssi != null ? ev.rssi : '') + '</td><td>' + (ev.snr != null ? ev.snr : '') + '</td><td>' + (battery != null ? battery : '') + '</td><td>' + (ev.margin != null ? ev.margin : '') + '</td><td>' + formatPower(ev.external_power_source) + '</td></tr>';
      });
      healthHtml += '</tbody></table>';
      var siteHealth = document.getElementById('site-health');
      if (siteHealth) siteHealth.innerHTML = healthRows.length ? healthHtml : '<p class="meta empty-state">No events.</p>';
      if (siteMeta) siteMeta.textContent = events.length + ' events total. Showing last-seen per device (up to 30).';
      if (state.chartSite) state.chartSite.destroy();
      var ctx = document.getElementById('chart-site');
      if (ctx) {
        var labels = events.slice(-100).map(function (e) { return e.time; });
        var rssi = events.slice(-100).map(function (e) { return e.rssi != null ? e.rssi : null; });
        state.chartSite = new window.Chart(ctx.getContext('2d'), {
          type: 'line',
          data: { labels: labels, datasets: [{ label: 'RSSI (last 100)', data: rssi, borderColor: '#58a6ff', tension: 0.2, spanGaps: true }] },
          options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: true, ticks: { maxTicksLimit: 8 } }, y: { reverse: true } } }
        });
      }
      state.siteEventsCache = events;
      var scrubWrap = document.getElementById('site-scrubber-wrap');
      var scrubber = document.getElementById('site-scrubber');
      var stateAsOf = document.getElementById('site-state-as-of');
      if (events.length > 1) {
        if (scrubWrap) scrubWrap.style.display = 'block';
        if (scrubber) { scrubber.min = 0; scrubber.max = events.length - 1; scrubber.value = events.length - 1; scrubber.step = 1; }
        updateSiteScrubber(events.length - 1);
      } else {
        if (scrubWrap) scrubWrap.style.display = 'none';
        if (stateAsOf) stateAsOf.style.display = 'none';
      }
    }).catch(function (e) {
      if (siteMeta) siteMeta.textContent = '';
      if (siteErr) siteErr.textContent = e.name === 'AbortError' ? 'Request timed out.' : e.message;
    });
  }

  function updateSiteScrubber(index) {
    var state = window.LoRaWAN.state;
    if (!state || !state.siteEventsCache || !state.siteEventsCache.length) return;
    var events = state.siteEventsCache;
    var i = Math.min(Math.max(0, Math.round(index)), events.length - 1);
    var untilTime = events[i].time;
    var scrubberTime = document.getElementById('site-scrubber-time');
    if (scrubberTime) scrubberTime.textContent = (untilTime || '').slice(0, 19);
    var filtered = events.filter(function (e) { return e.time <= untilTime; });
    var lastByDev = {};
    filtered.forEach(function (ev) {
      var key = ev.dev_eui;
      if (!lastByDev[key] || ev.time > lastByDev[key].time) lastByDev[key] = ev;
    });
    var rows = Object.keys(lastByDev).map(function (k) { return lastByDev[k]; }).sort(function (a, b) { return (b.time || '').localeCompare(a.time || ''); });
    var stateEl = document.getElementById('site-state-as-of');
    if (stateEl) {
      stateEl.style.display = 'block';
      var html = '<p class="meta">State as of ' + (untilTime || '').slice(0, 19) + ' — ' + rows.length + ' device(s) had reported by then:</p>';
      html += '<table style="width:100%; font-size:0.8rem;"><thead><tr><th>Device</th><th>Type</th><th>Last seen</th></tr></thead><tbody>';
      rows.slice(0, 20).forEach(function (ev) {
        html += '<tr><td>' + (ev.device_name || ev.dev_eui) + '</td><td>' + (ev.device_profile_name || '') + '</td><td>' + (ev.time || '').slice(0, 19) + '</td></tr>';
      });
      html += '</tbody></table>';
      stateEl.innerHTML = html;
    }
  }

  function mergeCorrelationEvents(events) {
    var lastTemp = null, lastHum = null, lastOpen = null;
    var labels = [], temp = [], hum = [], open = [];
    events.forEach(function (ev) {
      if (ev.type === 'door') lastOpen = ev.open;
      if (ev.type === 'climate') { lastTemp = ev.temperature; lastHum = ev.humidity; }
      labels.push(ev.time);
      temp.push(lastTemp);
      hum.push(lastHum);
      open.push(lastOpen);
    });
    return { labels: labels, temp: temp, hum: hum, open: open };
  }

  function loadCorrelation() {
    var dom = window.LoRaWAN.dom;
    var state = window.LoRaWAN.state;
    var api = window.LoRaWAN.api;
    if (!dom || !state) return Promise.resolve();
    var gateway = dom.gatewayCorrelationSelect.value;
    var corrErr = document.getElementById('correlation-err');
    var corrMeta = document.getElementById('correlation-meta');
    if (corrErr) corrErr.textContent = '';
    if (corrMeta) corrMeta.innerHTML = '<span class="spinner" aria-hidden="true"></span> Loading...';
    if (!gateway) { if (corrMeta) corrMeta.textContent = ''; return Promise.resolve(); }
    api.getCorrelation(gateway).then(function (data) {
      var events = Array.isArray(data.events) ? data.events : [];
      var merged = mergeCorrelationEvents(events);
      if (corrMeta) corrMeta.textContent = events.length + ' events (door + climate).';
      var corrAnomEl = document.getElementById('correlation-anomalies');
      api.getAnomalies(gateway).then(function (anom) {
        var list = Array.isArray(anom.anomalies) ? anom.anomalies : [];
        var html = '<p class="meta"><strong>Anomalies</strong> (door open + temp change &gt; 1°C in 60 min):</p>';
        if (list.length) list.forEach(function (a) { html += '<div class="anomaly-item"><strong>' + (a.time || '').slice(0, 19) + '</strong> ' + (a.description || a.type || '') + '</div>'; });
        else html += '<p class="meta empty-state">None detected.</p>';
        if (corrAnomEl) corrAnomEl.innerHTML = html;
      }).catch(function () { if (corrAnomEl) corrAnomEl.innerHTML = '<p class="meta"><strong>Anomalies</strong> – could not load.</p>'; });
      if (state.chartCorrelation) state.chartCorrelation.destroy();
      var ctx = document.getElementById('chart-correlation');
      if (ctx) {
        state.chartCorrelation = new window.Chart(ctx.getContext('2d'), {
          type: 'line',
          data: {
            labels: merged.labels,
            datasets: [
              { label: 'Temperature °C', data: merged.temp, borderColor: '#58a6ff', tension: 0.2, spanGaps: true },
              { label: 'Humidity %', data: merged.hum, borderColor: '#d2a8ff', tension: 0.2, spanGaps: true, yAxisID: 'y1' },
              { label: 'Door open (1)', data: merged.open, borderColor: '#f85149', stepped: true, spanGaps: false }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { display: true, ticks: { maxTicksLimit: 12 } },
              y: { beginAtZero: false, title: { display: true, text: 'Temp °C' } },
              y1: { position: 'right', beginAtZero: true, max: 100, title: { display: true, text: 'Humidity %' } }
            }
          }
        });
      }
    }).catch(function (e) {
      if (corrErr) corrErr.textContent = e.name === 'AbortError' ? 'Request timed out.' : e.message;
      if (corrMeta) corrMeta.textContent = '';
    });
  }

  function loadMap() {
    var dom = window.LoRaWAN.dom;
    var state = window.LoRaWAN.state;
    var api = window.LoRaWAN.api;
    if (!state) return;
    var mapErr = document.getElementById('map-err');
    if (mapErr) mapErr.textContent = '';
    api.getGateways(true).then(function (gateways) {
      var withLoc = gateways.filter(function (g) { return g.lat != null && g.lon != null; });
      if (!withLoc.length) {
        if (mapErr) mapErr.innerHTML = '<p class="meta empty-state">No gateway locations in dataset.</p>';
        if (state.mapInstance) { state.mapInstance.remove(); state.mapInstance = null; }
        state.mapMarkers = [];
        return;
      }
      var container = document.getElementById('map-container');
      if (state.mapInstance) { state.mapInstance.remove(); state.mapInstance = null; }
      (state.mapMarkers || []).forEach(function (m) { m.remove(); });
      state.mapMarkers = [];
      var center = withLoc[0];
      state.mapInstance = L.map(container).setView([center.lat, center.lon], 3);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(state.mapInstance);
      dom.gatewaySelect.innerHTML = '';
      dom.gatewayCorrelationSelect.innerHTML = '';
      gateways.forEach(function (gw) {
        var opt = document.createElement('option');
        opt.value = gw.gateway_id;
        opt.textContent = gw.gateway_id + ' (' + (gw.event_count || 0) + ' events' + (gw.lat != null ? ', ' + gw.lat.toFixed(4) + '°' : '') + ')';
        dom.gatewaySelect.appendChild(opt);
        dom.gatewayCorrelationSelect.appendChild(opt.cloneNode(true));
      });
      withLoc.forEach(function (g) {
        var m = L.marker([g.lat, g.lon]).addTo(state.mapInstance);
        m.bindPopup('<b>' + g.gateway_id + '</b><br/>' + (g.event_count || 0) + ' events');
        m.on('click', function () {
          dom.gatewaySelect.value = g.gateway_id;
          dom.gatewayCorrelationSelect.value = g.gateway_id;
          window.LoRaWAN.setActiveView('site');
          window.LoRaWAN.url.pushUrlState();
        });
        state.mapMarkers.push(m);
      });
      return api.getDevicesWithHealth();
    }).then(function (devices) {
      var weak = devices ? devices.filter(function (d) { return d.rssi != null && d.rssi < -100; }) : [];
      var weakEl = document.getElementById('map-weak-links');
      if (!weakEl) return;
      if (weak.length) {
        var weakHtml = '<p class="meta" style="margin-top:0.5rem;">Weak links (RSSI &lt; -100): ' + weak.length + ' device(s)</p><table style="font-size:0.8rem;"><tr><th>Device</th><th>Type</th><th>RSSI</th></tr>';
        weak.forEach(function (d) { weakHtml += '<tr><td>' + (d.device_name || d.dev_eui) + (d.synthetic ? ' [Synthetic]' : '') + '</td><td>' + (d.device_profile_name || '') + '</td><td>' + d.rssi + '</td></tr>'; });
        weakHtml += '</table>';
        weakEl.innerHTML = weakHtml;
      } else {
        weakEl.innerHTML = '<p class="meta empty-state">No weak links (RSSI &lt; -100).</p>';
      }
    }).catch(function (e) {
      if (mapErr) mapErr.textContent = e.name === 'AbortError' ? 'Request timed out.' : e.message;
    });
  }

  function setCardsVisibility() {
    var dom = window.LoRaWAN.dom;
    var state = window.LoRaWAN.state;
    if (!dom || !state) return;
    var isDeviceView = ['level', 'soil', 'climate', 'doors', 'sw3l'].indexOf(state.currentView) !== -1;
    dom.cardDashboard.style.display = state.currentView === 'dashboard' ? 'block' : 'none';
    dom.cardDevice.style.display = isDeviceView ? 'block' : 'none';
    dom.cardHealth.style.display = state.currentView === 'health' ? 'block' : 'none';
    dom.cardMap.style.display = state.currentView === 'map' ? 'block' : 'none';
    dom.cardSite.style.display = state.currentView === 'site' ? 'block' : 'none';
    dom.cardCorrelation.style.display = state.currentView === 'correlation' ? 'block' : 'none';
    if (state.currentView === 'dashboard') loadDashboard();
    else {
      stopDashboardDeviceCycle();
      if (state.currentView === 'site') loadGateways();
      else if (state.currentView === 'correlation') loadGateways();
      else if (state.currentView === 'health') loadHealth();
      else if (state.currentView === 'map') loadMap();
    }
  }

  window.LoRaWAN.views = {
    showApiUnavailable: showApiUnavailable,
    hideApiUnavailable: hideApiUnavailable,
    loadProfiles: loadProfiles,
    loadDevices: loadDevices,
    loadChart: loadChart,
    loadPassport: loadPassport,
    exportCsv: exportCsv,
    loadHealth: loadHealth,
    initHealthSort: initHealthSort,
    loadDashboard: loadDashboard,
    loadGateways: loadGateways,
    loadSite: loadSite,
    updateSiteScrubber: updateSiteScrubber,
    loadCorrelation: loadCorrelation,
    loadMap: loadMap,
    setCardsVisibility: setCardsVisibility
  };
})();
