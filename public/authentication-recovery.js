/* Native reverse-proxy recovery. Keep this asset outside all service-worker caches. */
(function (window) {
  if (window.__AUTHENTICATION_RECOVERY__) return;
  var marker = 'authentication-recovery-navigation';
  var current = new URL(window.location.href);
  var raw = window.__AUTHENTICATION_RECOVERY_CONFIG__;
  var config;
  function localUrl(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Missing URL');
    // Page-relative paths would change the probe identity after a recovery navigation.
    if (!/^(?:\/(?!\/)|https?:\/\/)/i.test(value.trim()))
      throw new Error('Recovery URLs must be root-relative or absolute');
    var url = new URL(value, current);
    if (
      url.origin !== current.origin ||
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('Recovery URLs must be same-origin HTTP URLs');
    return url;
  }
  try {
    if (raw) config = { probe: localUrl(raw.probeUrl), navigation: localUrl(raw.navigationUrl) };
  } catch (_) {
    /* Invalid configuration disables automatic recovery. */
  }
  var timeout =
    raw && Number.isFinite(raw.timeoutMs) ? Math.min(30000, Math.max(1000, raw.timeoutMs)) : 5000;
  var storageKey =
    'mindroom.authentication-recovery:' + (config ? config.probe.href : current.origin);
  var checking;
  var navigating;
  var lastAutomaticCheck = 0;

  function deadline(promise) {
    var timer;
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        timer = setTimeout(function () {
          reject(new Error('Recovery timed out'));
        }, timeout);
      }),
    ]).finally(function () {
      clearTimeout(timer);
    });
  }

  function navigate() {
    if (navigating) return navigating;
    navigating = (async function () {
      try {
        // Record before any side effect. If storage is denied, do not risk a boot loop.
        if (window.sessionStorage.getItem(storageKey)) return 'blocked';
        window.sessionStorage.setItem(storageKey, '1');
        var workers = window.navigator.serviceWorker;
        var controller = workers && workers.controller;
        if (controller) {
          var registration = await deadline(workers.getRegistration(window.location.href));
          // A missing registration means another tab already unregistered it.
          if (registration) {
            if (registration.active !== controller) {
              return 'blocked';
            }
            await deadline(registration.unregister());
          }
        }
        var target = new URL(config ? config.navigation.href : window.location.href);
        if (!target.hash) target.hash = new URL(window.location.href).hash;
        target.searchParams.set(marker, '1');
        var source = new URL(window.location.href);
        if (target.pathname === source.pathname && target.search === source.search) {
          // Assigning an equal URL (or only a new fragment) is a same-document navigation.
          window.history.replaceState(window.history.state, '', target.href);
          window.location.reload();
        } else {
          window.location.assign(target.href);
        }
        return 'navigating';
      } catch (_) {
        return 'blocked';
      }
    })().then(function (result) {
      // A failed attempt remains bounded in storage, but restored authentication can reset it.
      if (result !== 'navigating') navigating = undefined;
      return result;
    });
    return navigating;
  }

  function check() {
    if (!config) return Promise.resolve('disabled');
    if (navigating) return navigating;
    if (checking) return checking;
    var pending = (async function () {
      if (window.navigator.onLine === false) return 'unavailable';
      var abort = new AbortController();
      var timer = setTimeout(function () {
        abort.abort();
      }, timeout);
      try {
        var response = await window.fetch(config.probe.href, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'manual',
          signal: abort.signal,
        });
        if (response.status === 401 || response.type === 'opaqueredirect') return await navigate();
        // 403 can mean authenticated but unauthorized. Only the probe's exact 204 is healthy.
        if (response.status !== 204) return response.status === 403 ? 'denied' : 'unavailable';
        try {
          window.sessionStorage.removeItem(storageKey);
        } catch (_) {
          /* Keep app usable. */
        }
        return 'healthy';
      } catch (_) {
        return 'unavailable';
      } finally {
        clearTimeout(timer);
      }
    })().finally(function () {
      if (checking === pending) checking = undefined;
    });
    checking = pending;
    return checking;
  }

  function automaticCheck() {
    if (window.document.visibilityState === 'hidden') return;
    var now = Date.now();
    if (now - lastAutomaticCheck < 10000) return;
    lastAutomaticCheck = now;
    void check();
  }
  window.__AUTHENTICATION_RECOVERY__ = {
    check: check,
    configurationLoaded: function () {
      // Only fresh validated configuration can reset the unconfigured explicit sign-in path.
      if (!config) {
        try {
          window.sessionStorage.removeItem(storageKey);
        } catch (_) {
          /* Keep app usable. */
        }
      }
    },
    // The existing sign-in action uses the same proof and budget when configured.
    navigate: config ? check : navigate,
  };
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    // History restoration resumes the same document after its navigation promise settled.
    navigating = undefined;
    checking = undefined;
    lastAutomaticCheck = 0;
    if (config) automaticCheck();
  });
  if (config) {
    window.addEventListener('focus', automaticCheck);
    window.addEventListener('online', automaticCheck);
    window.document.addEventListener('visibilitychange', automaticCheck);
    setInterval(automaticCheck, 60000);
    automaticCheck();
  }
})(window);
