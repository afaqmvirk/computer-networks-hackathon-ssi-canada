/**
 * Dashboard config: API base, timeouts, view–profile mapping.
 */
(function () {
  'use strict';
  window.LoRaWAN = window.LoRaWAN || {};
  window.LoRaWAN.config = {
    API: window.location.origin + '/api',
    FETCH_TIMEOUT_MS: 15000,
    AUTO_REFRESH_MS: 15000,
    VIEW_PROFILES: {
      level: ['Dragino DDS75-LB Ultrasonic Distance Sensor', 'EM500-UDL'],
      soil: ['Makerfabs Soil Moisture Sensor'],
      climate: ['rbs305-ath', 'Multitech RBS301 Temp Sensor'],
      doors: ['rbs301-dws'],
      sw3l: ['SW3L']
    },
    VALID_VIEWS: ['dashboard', 'level', 'soil', 'climate', 'doors', 'sw3l', 'health', 'map', 'site', 'correlation'],
    /** Gateway ID -> banner image filename in app/static/images. Synthetic uses Carleton; e250 uses Kanata; others use Great Slave Lake. */
    GATEWAY_BANNER_IMAGES: {
      'synthetic-gateway-01': 'carleton.png',
      '00800000a000e250': 'kanata.png',
      '008000000002aa4b': 'site-great-slave-lake-1.png'
    },
    /** Fallback banner for any gateway not in GATEWAY_BANNER_IMAGES (e.g. other real gateways). */
    GATEWAY_BANNER_FALLBACK: 'site-great-slave-lake-2.png'
  };
})();
