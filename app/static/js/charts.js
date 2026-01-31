/**
 * Chart helpers: anomaly annotations, radio meta, device chart factory.
 */
(function () {
  'use strict';

  function buildAnomalyAnnotations(labels, list) {
    var out = {};
    (list || []).forEach(function (a, i) {
      var t = (a.time && new Date(a.time).getTime()) || NaN;
      if (isNaN(t) || !labels.length) return;
      var bestIdx = 0;
      var bestDiff = Infinity;
      labels.forEach(function (l, idx) {
        var d = Math.abs((new Date(l).getTime()) - t);
        if (d < bestDiff) { bestDiff = d; bestIdx = idx; }
      });
      var short = (a.description || a.type || 'Anomaly').slice(0, 35);
      out['anom' + i] = {
        type: 'line',
        xMin: bestIdx,
        xMax: bestIdx,
        borderColor: 'rgba(248,81,73,0.9)',
        borderWidth: 2,
        label: { display: true, content: short, color: '#f85149', font: { size: 10 } }
      };
    });
    return out;
  }

  function radioMeta(data) {
    var pt = (Array.isArray(data) && data.length) ? data.find(function (d) { return d.f_port != null || d.frequency != null || d.spreading_factor != null; }) : null;
    if (!pt) return '';
    var parts = [];
    if (pt.f_port != null) parts.push('fPort ' + pt.f_port);
    if (pt.frequency != null) parts.push((pt.frequency / 1e6).toFixed(2) + ' MHz');
    if (pt.spreading_factor != null) parts.push('SF' + pt.spreading_factor);
    return parts.length ? ' | Radio: ' + parts.join(', ') : '';
  }

  function createDeviceChart(ctx, data, view, annotationOpts) {
    var labels = data.map(function (d) { return d.time; });
    var Chart = window.Chart;
    if (!Chart) throw new Error('Chart.js not loaded');

    var commonOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: annotationOpts,
      scales: { x: { display: true, ticks: { maxTicksLimit: 10 } } }
    };

    if (view === 'level') {
      var dist = data.map(function (d) { return d.object && typeof d.object.distance === 'number' ? d.object.distance : null; });
      return new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Distance', data: dist, borderColor: '#58a6ff', tension: 0.2, spanGaps: true }] },
        options: Object.assign({}, commonOpts, { scales: { x: commonOpts.scales.x, y: { beginAtZero: true } } })
      });
    }
    if (view === 'soil') {
      var soil = data.map(function (d) { return d.object && typeof d.object.soil_val === 'number' ? d.object.soil_val : null; });
      var temp = data.map(function (d) { return d.object && typeof d.object.temp === 'number' ? d.object.temp : null; });
      return new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Soil value', data: soil, borderColor: '#58a6ff', tension: 0.2, spanGaps: true },
            { label: 'Temp °C', data: temp, borderColor: '#3fb950', tension: 0.2, spanGaps: true, yAxisID: 'y1' }
          ]
        },
        options: Object.assign({}, commonOpts, { scales: { x: commonOpts.scales.x, y: { beginAtZero: true }, y1: { position: 'right', beginAtZero: false } } })
      });
    }
    if (view === 'climate') {
      var tempC = data.map(function (d) { return d.object && typeof d.object.temperature === 'number' ? d.object.temperature : null; });
      var hum = data.map(function (d) { return d.object && typeof d.object.humidity === 'number' ? d.object.humidity : null; });
      return new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Temperature °C', data: tempC, borderColor: '#58a6ff', tension: 0.2, spanGaps: true },
            { label: 'Humidity %', data: hum, borderColor: '#d2a8ff', tension: 0.2, spanGaps: true, yAxisID: 'y1' }
          ]
        },
        options: Object.assign({}, commonOpts, { scales: { x: commonOpts.scales.x, y: { beginAtZero: false }, y1: { position: 'right', beginAtZero: true, max: 100 } } })
      });
    }
    if (view === 'doors') {
      var open = data.map(function (d) { return d.object && typeof d.object.open !== 'undefined' ? d.object.open : null; });
      return new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Open (1) / Closed (0)', data: open, borderColor: '#f85149', stepped: true, spanGaps: false }] },
        options: Object.assign({}, commonOpts, { scales: { x: commonOpts.scales.x, y: { min: -0.1, max: 1.1, ticks: { stepSize: 1 } } } })
      });
    }
    // sw3l / default: battery
    var bat = data.map(function (d) { return d.battery_normalized != null ? d.battery_normalized : (d.object && (d.object.BAT != null) ? d.object.BAT : null); });
    return new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: [{ label: 'Battery (V)', data: bat, borderColor: '#a371f7', tension: 0.2, spanGaps: true }] },
      options: Object.assign({}, commonOpts, { scales: { x: commonOpts.scales.x, y: { beginAtZero: false } } })
    });
  }

  window.LoRaWAN.charts = {
    buildAnomalyAnnotations: buildAnomalyAnnotations,
    radioMeta: radioMeta,
    createDeviceChart: createDeviceChart
  };
})();
