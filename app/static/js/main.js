/**
 * Main: DOM refs, state, setActiveView, event binding, init.
 */
(function () {
  'use strict';

  function isDeviceView() {
    var state = window.LoRaWAN.state;
    return state && ['level', 'soil', 'climate', 'doors', 'sw3l'].indexOf(state.currentView) !== -1;
  }

  function setActiveView(view, options) {
    var state = window.LoRaWAN.state;
    var views = window.LoRaWAN.views;
    var url = window.LoRaWAN.url;
    var config = window.LoRaWAN.config;
    if (!state || !views) return;
    state.currentView = view;
    if (state.autoRefreshInterval) {
      clearInterval(state.autoRefreshInterval);
      state.autoRefreshInterval = null;
    }
    var autoRefresh = document.getElementById('auto-refresh');
    if (autoRefresh) autoRefresh.checked = false;
    var lastUpdated = document.getElementById('last-updated');
    if (lastUpdated) lastUpdated.textContent = '';
    document.querySelectorAll('nav a').forEach(function (a) {
      var isActive = a.dataset.view === view;
      a.classList.toggle('active', isActive);
      if (isActive) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    views.setCardsVisibility();
    if (isDeviceView()) views.loadProfiles();
    else if (view === 'site' || view === 'correlation') views.loadGateways();
    else if (view === 'map') views.loadMap();
    if (!(options && options.preserveUrl)) url.pushUrlState();
  }

  function init() {
    var config = window.LoRaWAN.config;
    var url = window.LoRaWAN.url;
    var views = window.LoRaWAN.views;
    if (!config || !url || !views) return;

    window.LoRaWAN.dom = {
      profileSelect: document.getElementById('profile'),
      deviceSelect: document.getElementById('device'),
      rangeSelect: document.getElementById('range'),
      fportSelect: document.getElementById('fport'),
      metaEl: document.getElementById('meta'),
      errEl: document.getElementById('err'),
      cardDashboard: document.getElementById('card-dashboard'),
      cardDevice: document.getElementById('card-device'),
      cardHealth: document.getElementById('card-health'),
      cardMap: document.getElementById('card-map'),
      cardSite: document.getElementById('card-site'),
      cardCorrelation: document.getElementById('card-correlation'),
      gatewaySelect: document.getElementById('gateway'),
      gatewayCorrelationSelect: document.getElementById('gateway-correlation')
    };

    window.LoRaWAN.state = {
      chart: null,
      doorTimeChart: null,
      chartSiteRssi: null,
      currentView: 'level',
      autoRefreshInterval: null,
      chartSite: null,
      chartCorrelation: null,
      mapInstance: null,
      mapMarkers: [],
      siteEventsCache: [],
      healthSortKey: 'last_seen',
      healthSortDir: -1
    };

    var dom = window.LoRaWAN.dom;
    var state = window.LoRaWAN.state;

    document.querySelectorAll('nav a').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        setActiveView(a.dataset.view);
      });
    });
    dom.profileSelect.addEventListener('change', function () { views.loadDevices(); url.pushUrlState(); });
    dom.deviceSelect.addEventListener('change', function () { views.loadChart(); url.pushUrlState(); });
    dom.rangeSelect.addEventListener('change', function () { views.loadChart(); url.pushUrlState(); });
    dom.fportSelect.addEventListener('change', function () { views.loadChart(); });
    document.getElementById('btn-passport').addEventListener('click', function () { views.loadPassport(); });
    document.getElementById('btn-export-csv').addEventListener('click', function () { views.exportCsv(); });
    document.getElementById('auto-refresh').addEventListener('change', function () {
      if (state.autoRefreshInterval) clearInterval(state.autoRefreshInterval);
      state.autoRefreshInterval = null;
      document.getElementById('last-updated').textContent = '';
      if (this.checked && isDeviceView()) {
        state.autoRefreshInterval = setInterval(views.loadChart, config.AUTO_REFRESH_MS);
        views.loadChart();
      }
    });
    dom.gatewaySelect.addEventListener('change', function () { views.loadSite(); url.pushUrlState(); });
    dom.gatewayCorrelationSelect.addEventListener('change', function () { views.loadCorrelation(); url.pushUrlState(); });
    var siteScrubber = document.getElementById('site-scrubber');
    if (siteScrubber) {
      siteScrubber.addEventListener('input', function () {
        views.updateSiteScrubber(Number(this.value));
      });
    }

    var urlState = url.getUrlState();
    var initialView = (urlState.view && config.VALID_VIEWS.indexOf(urlState.view) !== -1) ? urlState.view : 'dashboard';
    setActiveView(initialView);
    if (initialView === 'health') views.loadHealth();
    views.initHealthSort();
  }

  window.LoRaWAN.setActiveView = setActiveView;
  window.LoRaWAN.isDeviceView = isDeviceView;
  window.LoRaWAN.init = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
