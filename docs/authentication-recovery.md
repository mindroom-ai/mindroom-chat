# Reverse-proxy authentication recovery

The client can recover an expired reverse-proxy login while preserving the Matrix session, encryption keys, local storage, IndexedDB, and cached assets.
This is opt-in and does not implement authentication policy.

Set these image environment variables:

```sh
APP_AUTHENTICATION_RECOVERY_PROBE_URL=/authentication-recovery-probe
APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL=/
```

Alternatively, a deployment that supplies `runtime-config.js` can set:

```js
window.__AUTHENTICATION_RECOVERY_CONFIG__ = {
  probeUrl: '/authentication-recovery-probe',
  navigationUrl: '/',
  timeoutMs: 5000,
};
```

Both URLs must resolve to the application's origin, use HTTP or HTTPS, and contain no credentials.
Use root-relative paths or same-origin absolute URLs; page-relative paths and protocol-relative URLs are rejected so the retry identity stays stable across navigations.
The optional timeout defaults to 5 seconds and is bounded to 1–30 seconds.
A missing or invalid object disables automatic recovery.

The image serves `/authentication-recovery-probe` with HTTP 204 and `Cache-Control: no-store`.
Protect this exact endpoint with the same reverse-proxy session policy as the application.
An expired session must return HTTP 401 or redirect to interactive sign-in.
The client uses a credentialed, uncached request with manual redirect handling.
Only HTTP 204 confirms a healthy session; HTTP 403 means access denied and does not trigger recovery.
HTTP 200, other statuses, network errors, offline state, and timeouts do not trigger recovery.
Do not return a public 204 before the authentication check, and do not exempt chat, configuration, Matrix, or API routes from authentication.
The navigation destination must initiate the normal protected sign-in flow and return the user to the application.
The current fragment is retained unless the configured destination supplies one.

## Bootstrap and cached clients

`runtime-config.js` loads the image's `/authentication-recovery.js` as a classic script.
Current HTML also loads this idempotent asset directly, so existing custom runtime scripts retain the explicit sign-in action.
Both assets are served with `Cache-Control: no-store` and excluded from the current service worker's precache.
The image also supports its existing single-segment deployment prefix, such as `/chat/authentication-recovery.js` and `/chat/authentication-recovery-probe`.
The bootstrap does not need the Matrix app bundle or configuration fetch to succeed.
If the reverse proxy protects all assets, allow only the exact runtime configuration and bootstrap asset routes needed to run recovery; retain authentication on the probe and navigation destination.

Deployments generating their own `runtime-config.js` must include this loader after setting the configuration:

```js
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
```

The bootstrap is idempotent and exposes `window.__AUTHENTICATION_RECOVERY__.check()` and `.navigate()`.
The existing configuration-error sign-in action delegates to this owner and shares its probe and retry budget.
For configured deployments, `navigate()` confirms expiry using the probe before any navigation.
Without configuration, the explicit sign-in action still uses scoped worker removal and the retry bound.
A successfully fetched and validated fresh client configuration notifies the owner through `configurationLoaded()` to reset only that unconfigured manual budget; cached configuration and failed loads never reset it.

A cached predecessor HTML page can receive this fix if it already fetches mutable `runtime-config.js` from the network.
A page that precaches that script, contains all its bootstrap code inline, or never references a mutable asset cannot consume new code merely because the server changed.
Such deployments need an already-configured external bootstrap asset or a separate client update path.
This release does not promise automatic repair of every historical cache.

## Recovery bounds

The bootstrap checks at startup, while the page is visible every minute, and on focus, visibility changes, or reconnect, with automatic checks throttled to once per ten seconds.
Concurrent checks share one request.
Confirmed expiry records one attempt in session storage before any side effect, unregisters only the registration matching the app's controlling worker, and navigates to the protected destination.
An equal path/query forces a full reload instead of a fragment-only navigation.
Unrelated service-worker registrations and every cache remain intact.
The current document may remain controlled until it unloads, which is expected.

One attempt is allowed per tab and probe URL until a later HTTP 204 confirms restored authentication.
A failed unregister, timeout, unavailable session storage, or repeated expiry stops automatic navigation.
When browser history restores a previous document from the back-forward cache, recovery discards its stale in-memory navigation state and probes again.
The retry budget stays in session storage until an exact HTTP 204 confirms restored authentication.
The configuration error screen retains its retry/offline options and reports recovery failure.
Closing the tab ends its session-storage budget; an explicit connection retry does not clear the budget.
Authentication policy and cross-tab coordination remain the deployment's responsibility.

## Validation

```sh
npm test
E2E_NO_WEB_SERVER=1 npm run test:e2e -- e2e/authentication-recovery.spec.ts
node --test scripts/test-authentication-recovery-nginx.mjs
uv run --no-project python scripts/test_authentication_recovery_netlify.py
```

The browser suite starts its own loopback fixture and bundles actual Workbox legacy and current workers.
It reproduces marker-only legacy interception, recovers on normal relaunch for legacy/current/no-worker clients, and verifies storage and unrelated registrations survive.
The nginx test requires Docker and `nginx:alpine` and checks the actual image routes and runtime URL serialization.
Helm authentication policy belongs to the consuming chart; this repository contains no chart.
