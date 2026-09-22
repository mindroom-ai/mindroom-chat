window.__APP_BASE_PATH__ = '/';
window.__ENABLE_SERVICE_WORKER__ = true;
window.__SERVICE_WORKER_NAVIGATION_FALLBACK_EXCLUDE_PATHS__ = [];
// Omit this object (or set null) unless a reverse proxy protects the probe and destination.
window.__AUTHENTICATION_RECOVERY_CONFIG__ = null;
(function () {
  var script = document.createElement('script');
  script.src = new URL('authentication-recovery.js', document.currentScript.src).href;
  script.async = false;
  window.__AUTHENTICATION_RECOVERY_READY__ = new Promise(function (resolve) {
    script.onload = resolve;
    script.onerror = resolve;
  });
  document.head.appendChild(script);
})();
