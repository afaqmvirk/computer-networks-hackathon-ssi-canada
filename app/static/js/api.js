/**
 * API layer: fetch with timeout, all GET helpers.
 */
(function () {
  'use strict';
  var cfg = window.LoRaWAN.config;
  var API = cfg.API;
  var timeoutMs = cfg.FETCH_TIMEOUT_MS;

  function fetchWithTimeout(url, options, ms) {
    var ctrl = new AbortController();
    var id = setTimeout(function () { ctrl.abort(); }, ms || timeoutMs);
    return fetch(url, Object.assign(options || {}, { signal: ctrl.signal })).finally(function () { clearTimeout(id); });
  }

  function getProfiles() {
    return fetchWithTimeout(API + '/profiles', {}).then(function (r) {
      if (!r.ok) throw new Error('Profiles failed');
      return r.json().then(function (j) {
        if (!Array.isArray(j)) throw new Error('Invalid API response');
        return j;
      });
    });
  }

  function getDevices(profile) {
    var url = profile ? API + '/devices?profile=' + encodeURIComponent(profile) : API + '/devices';
    return fetchWithTimeout(url, {}).then(function (r) {
      if (!r.ok) throw new Error('Devices failed');
      return r.json().then(function (j) {
        if (!Array.isArray(j)) throw new Error('Invalid API response');
        return j;
      });
    });
  }

  function getDevicesWithHealth() {
    return fetchWithTimeout(API + '/devices?include_health=1', {}).then(function (r) {
      if (!r.ok) throw new Error('Devices failed');
      return r.json().then(function (j) {
        if (!Array.isArray(j)) throw new Error('Invalid API response');
        return j;
      });
    });
  }

  function getDevicePassport(devEui) {
    return fetchWithTimeout(API + '/device/' + encodeURIComponent(devEui), {}).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? 'Device not found' : 'Passport failed');
      return r.json();
    });
  }

  function getTimeseries(devEui, fromTime, toTime, fPort) {
    var url = API + '/timeseries?dev_eui=' + encodeURIComponent(devEui) + '&limit=5000';
    if (fromTime) url += '&from=' + encodeURIComponent(fromTime);
    if (toTime) url += '&to=' + encodeURIComponent(toTime);
    if (fPort != null && fPort !== '') url += '&f_port=' + encodeURIComponent(fPort);
    return fetchWithTimeout(url, {}).then(function (r) {
      if (!r.ok) throw new Error('Timeseries failed');
      return r.json().then(function (j) {
        if (!Array.isArray(j)) throw new Error('Invalid API response');
        return j;
      });
    });
  }

  function getGateways(withLocation) {
    if (withLocation === undefined) withLocation = true;
    var url = API + '/gateways?with_location=' + (withLocation ? '1' : '0');
    return fetchWithTimeout(url, {}).then(function (r) {
      if (!r.ok) throw new Error('Gateways failed');
      return r.json();
    });
  }

  function getSiteEvents(gateway, fromTime, toTime) {
    var url = API + '/site?gateway=' + encodeURIComponent(gateway) + '&limit=5000';
    if (fromTime) url += '&from=' + encodeURIComponent(fromTime);
    if (toTime) url += '&to=' + encodeURIComponent(toTime);
    return fetchWithTimeout(url, {}).then(function (r) {
      if (!r.ok) throw new Error('Site events failed');
      return r.json();
    });
  }

  function getCorrelation(gateway, fromTime, toTime) {
    var url = API + '/correlation?gateway=' + encodeURIComponent(gateway) + '&limit=3000';
    if (fromTime) url += '&from=' + encodeURIComponent(fromTime);
    if (toTime) url += '&to=' + encodeURIComponent(toTime);
    return fetchWithTimeout(url, {}).then(function (r) {
      if (!r.ok) throw new Error('Correlation failed');
      return r.json();
    });
  }

  function getAnomalies(gateway, fromTime, toTime) {
    var url = API + '/anomalies?gateway=' + encodeURIComponent(gateway) + '&limit=5000';
    if (fromTime) url += '&from=' + encodeURIComponent(fromTime);
    if (toTime) url += '&to=' + encodeURIComponent(toTime);
    return fetchWithTimeout(url, {}).then(function (r) {
      if (!r.ok) return { anomalies: [] };
      return r.json();
    });
  }

  function getAnomaliesOrg(limit) {
    var url = API + '/anomalies/org?limit=' + (limit || 20);
    return fetchWithTimeout(url, {}).then(function (r) {
      if (!r.ok) return { anomalies: [] };
      return r.json();
    });
  }

  function getAnomaliesDevice(devEui, fromTime, toTime) {
    var url = API + '/anomalies/device?dev_eui=' + encodeURIComponent(devEui) + '&limit=5000';
    if (fromTime) url += '&from=' + encodeURIComponent(fromTime);
    if (toTime) url += '&to=' + encodeURIComponent(toTime);
    return fetchWithTimeout(url, {}).then(function (r) {
      if (!r.ok) return { anomalies: [] };
      return r.json();
    });
  }

  window.LoRaWAN.api = {
    fetchWithTimeout: fetchWithTimeout,
    getProfiles: getProfiles,
    getDevices: getDevices,
    getDevicesWithHealth: getDevicesWithHealth,
    getDevicePassport: getDevicePassport,
    getTimeseries: getTimeseries,
    getGateways: getGateways,
    getSiteEvents: getSiteEvents,
    getCorrelation: getCorrelation,
    getAnomalies: getAnomalies,
    getAnomaliesOrg: getAnomaliesOrg,
    getAnomaliesDevice: getAnomaliesDevice
  };
})();
