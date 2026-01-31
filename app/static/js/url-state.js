/**
 * URL state: read/write ?view, profile, device, gateway, range. Apply to DOM.
 */
(function () {
  'use strict';

  function getUrlState() {
    var p = new URLSearchParams(window.location.search);
    return {
      view: p.get('view') || 'level',
      profile: p.get('profile') || '',
      device: p.get('device') || '',
      gateway: p.get('gateway') || '',
      range: p.get('range') || 'all'
    };
  }

  function pushUrlState() {
    var state = window.LoRaWAN.state;
    var dom = window.LoRaWAN.dom;
    if (!state || !dom) return;
    var params = new URLSearchParams();
    if (state.currentView) params.set('view', state.currentView);
    if (dom.profileSelect && dom.profileSelect.value) params.set('profile', dom.profileSelect.value);
    if (dom.deviceSelect && dom.deviceSelect.value) params.set('device', dom.deviceSelect.value);
    if (dom.gatewaySelect && dom.gatewaySelect.value) params.set('gateway', dom.gatewaySelect.value);
    if (dom.rangeSelect && dom.rangeSelect.value && dom.rangeSelect.value !== 'all') params.set('range', dom.rangeSelect.value);
    var q = params.toString();
    var url = q ? (window.location.pathname + '?' + q) : window.location.pathname;
    if (window.location.search !== ('?' + q)) window.history.replaceState({}, '', url);
  }

  function applyUrlDeviceSelection() {
    var dom = window.LoRaWAN.dom;
    if (!dom) return;
    var s = getUrlState();
    if (s.device && dom.deviceSelect && dom.deviceSelect.querySelector('option[value="' + s.device + '"]')) dom.deviceSelect.value = s.device;
    if (s.profile && dom.profileSelect && dom.profileSelect.querySelector('option[value="' + s.profile + '"]')) dom.profileSelect.value = s.profile;
    if (s.range && dom.rangeSelect) dom.rangeSelect.value = s.range;
  }

  function applyUrlGatewaySelection() {
    var dom = window.LoRaWAN.dom;
    if (!dom) return;
    var s = getUrlState();
    if (s.gateway && dom.gatewaySelect && dom.gatewaySelect.querySelector('option[value="' + s.gateway + '"]')) {
      dom.gatewaySelect.value = s.gateway;
      if (dom.gatewayCorrelationSelect) dom.gatewayCorrelationSelect.value = s.gateway;
    }
  }

  window.LoRaWAN.url = {
    getUrlState: getUrlState,
    pushUrlState: pushUrlState,
    applyUrlDeviceSelection: applyUrlDeviceSelection,
    applyUrlGatewaySelection: applyUrlGatewaySelection
  };
})();
