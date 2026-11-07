# Deployment

How to build the client, serve it, and point it at a homeserver and a MindRoom backend. Every `config.json` key, its default and its effect are in [`configuration.md`](configuration.md); the native apps are in [`development.md`](development.md#native-shells) and [`ios-release.md`](ios-release.md).

## Build

`just build` writes a static site to `dist/`:

| File | Purpose |
|---|---|
| `index.html`, `assets/`, `res/`, `sound/`, `public/locales/`, `manifest.json` | the app |
| `config.json` | a copy of `config.mindroom.json`; replace it per deployment ([`configuration.md`](configuration.md)) |
| `runtime-config.js` | sets the deployment globals before the app starts (base path, service worker, sign-in recovery) |
| `authentication-recovery.js` | recovers sign-in behind an authenticating proxy |
| `sw.js` | the service worker: precaches what a signed-in start needs for offline starts, keeps the build's other files and the language catalogs once a page has loaded them, fetches authenticated media |
| `version.json` | the build version, polled by running clients, whose service worker then installs a new deployment for the next start |
| `public/licenses/` | `LICENSE`, `NOTICE` and third-party license texts |

- `MINDROOM_BUILD_VERSION` and `MINDROOM_RELEASE_VERSION` set the version the build reports (otherwise taken from Git: the commit, and the nearest release tag `vYYYY.M.N`).

## Serve

To deploy, serve `dist/` from the root of an origin and answer every path that is not a file with `index.html`; with `hashRouter.enabled` in `config.json`, routes live after `#` and no rewrite is needed. When the MindRoom backend shares the origin, send the paths it serves to the backend before the `index.html` fallback: `/api/` (with WebSocket upgrades, which the agent computer's stream uses), `/v1/`, the pages `/connections`, `/mcp` and `/reports` and the paths under them, and the MCP gateway's discovery paths under `/.well-known/` (MindRoom's [MCP gateway routing table](https://docs.mindroom.chat/deployment/mcp-gateway/#route-browser-and-machine-traffic)); the service worker already leaves those page navigations to the network (`src/boot/serviceWorkerNavigation.ts`). `config.json`, `runtime-config.js`, `authentication-recovery.js` and `version.json` are not precached by the service worker, so a deployment can change the first three without a new build. Leave `version.json` as the build wrote it: a `version` that differs from the one in the bundle makes running clients announce a new version. The precache holds the app shell, the code, styles and images of a signed-in start and the crypto wasm (`scripts/precache-plan.mjs`); other files under `assets/` (chunks loaded on demand, sounds, the thinking marks) and the catalogs under `public/locales/` are kept the first time a page loads them, and a new build's worker keeps the kept files its build still has. A page still open from the previous build therefore loads its on-demand chunks from the server: when a deployment removed them, the page says a new version is available and its Reload starts the new build (`src/app/config/appUpdate.ts`). Keep the previous build's `assets/` files for a while after a deployment to spare open pages even that. The build is not usable under a sub-path: its asset URLs start at `/`.

Who may frame the app is a response header, not part of the build (values in `scripts/frame-headers.json`, rule in `scripts/frame-headers.mjs`): `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` on every path, and `frame-ancestors 'none'` with `X-Frame-Options: DENY` on the pairing page, in every spelling the router renders it under (`/connect`, `/CONNECT/`, `/%63onnect`, under a base path). `vite preview`, `serve.py` and the nginx start script `docker-entrypoint.d/40-frame-headers.sh` send them, and the service worker gives the pairing page its own when it answers from the cached app shell. `netlify.toml` sends them too, but its rules name only `/connect` and `/connect/`, so other spellings may get `'self'` there on a first visit. With `hashRouter.enabled`, the pairing page is `/#/connect`, which reaches the server and the service worker as `/`, so it gets the `'self'` headers too; in a frame, the page itself shows a warning and does not pair (`src/app/local-mindroom/ConnectPage.tsx`).

- `cd dist && python3 ../serve.py 8090` serves a build with the `index.html` fallback and the framing headers, over plain HTTP on every interface: use it to try a build, and put HTTPS in front of any deployment. It generates its own `runtime-config.js` from `APP_BASE_PATH` and `APP_ENABLE_SERVICE_WORKER`.
- The repository has no Dockerfile. `docker-entrypoint.d/` holds start scripts for an image based on the official `nginx` image, with `dist/` in `/usr/share/nginx/html` and the build's `runtime-config.js` copied to `/opt/mindroom/runtime-config.js`. `99-runtime-config.sh` writes `runtime-config.js` from `APP_BASE_PATH`, `APP_ENABLE_SERVICE_WORKER`, `APP_AUTHENTICATION_RECOVERY_PROBE_URL` and `APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL`, then appends the build's own. `40-frame-headers.sh` writes `/etc/nginx/conf.d/mindroom-frame-headers.conf`, which sends the framing headers from the `http` block; a `server` or `location` with an `add_header` of its own must `include /etc/nginx/mindroom-frame-headers.inc`, because nginx then drops the inherited headers. The nginx site needs the same `index.html` fallback.

## Homeserver and MindRoom backend

- **Homeserver.** `config.json` decides which homeservers the sign-in page offers and whether people may type their own (`homeserverList`, `defaultHomeserver`, `allowCustomHomeservers`).
- **MindRoom agents.** A MindRoom backend (`mindroom run`) signs its agents in to a homeserver as ordinary Matrix accounts (`@mindroom_<name>:<server>`). Sign the client in to the same homeserver and talk to the agents in their rooms; chat needs nothing else.
- **MindRoom API.** Agent computers and Connections talk to the backend's HTTP API. Each agent publishes the backend's origin (its `MINDROOM_PUBLIC_URL`) as `io.mindroom.server` room state, and the client uses it. Set `mindroom.computers.apiUrl` in `config.json` to pin one origin instead; each user can override it in Settings > Agents & connections > Computers, under Advanced.
- **Local MindRoom.** Pairing a MindRoom that runs on someone's own machine goes through the provisioning service at `sidebar.mindRoomProvisioningUrl`, or the account's homeserver when the key is unset. `config.mindroom.json` sets it to `https://mindroom.chat`, and accounts on another homeserver cannot sign in to a provisioning service on a different origin, so a deployment for another homeserver changes or removes this key along with its homeserver settings.
