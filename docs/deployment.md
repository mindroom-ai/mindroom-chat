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
| `public/plugins/<id>/` | the files of each client plugin's `public/` directory, in a build with plugins ([`architecture.md`](architecture.md#client-plugins)) |

- `branding` in `config.json` puts a company's logo, name and footer on the sign-in pages without a new build ([`configuration.md`](configuration.md#branding)).
- `MINDROOM_BUILD_VERSION` and `MINDROOM_RELEASE_VERSION` set the version the build reports (otherwise taken from Git: the commit, and the nearest release tag `vYYYY.M.N`); client plugins add a digest of their files to the first.

## Serve

To deploy, serve `dist/` from the root of an origin and answer every path that is not a file with `index.html`, but a missing file under `/public/` with 404; with `hashRouter.enabled` in `config.json`, routes live after `#` and no rewrite is needed. When the MindRoom backend shares the origin, send the paths it serves to the backend before the `index.html` fallback: `/api/` (with WebSocket upgrades, which the agent computer's stream uses), `/v1/`, the pages `/connections`, `/mcp` and `/reports` and the paths under them, and the MCP gateway's discovery paths under `/.well-known/` (MindRoom's [MCP gateway routing table](https://docs.mindroom.chat/deployment/mcp-gateway/#route-browser-and-machine-traffic)); the service worker already leaves those page navigations to the network (`src/boot/serviceWorkerNavigation.ts`). `config.json`, `runtime-config.js`, `authentication-recovery.js` and `version.json` are not precached by the service worker, so a deployment can change the first three without a new build. Leave `version.json` as the build wrote it: a `version` that differs from the one in the bundle makes running clients announce a new version. The precache holds the app shell, the code, styles and images of a signed-in start and the crypto wasm (`scripts/precache-plan.mjs`); other files under `assets/` (chunks loaded on demand, sounds, the thinking marks) and the catalogs under `public/locales/` are kept the first time a page loads them, and a new build's worker keeps the kept files its build still has. A page still open from the previous build therefore loads its on-demand chunks from the server: when a deployment removed them, the page says a new version is available and its Reload starts the new build (`src/app/config/appUpdate.ts`). Keep the previous build's `assets/` files for a while after a deployment to spare open pages even that. The build is not usable under a sub-path: its asset URLs start at `/`.

Who may frame the app is a response header, not part of the build (values in `scripts/frame-headers.json`, rule in `scripts/frame-headers.mjs`): `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` on every path, and `frame-ancestors 'none'` with `X-Frame-Options: DENY` on the pairing page, in every spelling the router renders it under (`/connect`, `/CONNECT/`, `/%63onnect`, under a base path). `vite preview`, `serve.py` and the nginx start script `docker-entrypoint.d/40-frame-headers.sh` send them, and the service worker gives the pairing page its own when it answers from the cached app shell. `netlify.toml` sends them too, but its rules name only `/connect` and `/connect/`, so other spellings may get `'self'` there on a first visit. With `hashRouter.enabled`, the pairing page is `/#/connect`, which reaches the server and the service worker as `/`, so it gets the `'self'` headers too. In a frame of its own origin the app does not start at all (`src/index.tsx`): the `index.html` fallback answers a page the server lacks, so a frame whose page is gone would otherwise run a second copy of the app. Where a server sends no framing headers, the pairing page in a frame of another origin shows a warning and does not pair (`src/app/local-mindroom/ConnectPage.tsx`).

- `cd dist && python3 ../serve.py 8090` serves a build with the `index.html` fallback and the framing headers, over plain HTTP on every interface: use it to try a build, and put HTTPS in front of any deployment. It generates its own `runtime-config.js` from `APP_BASE_PATH` and `APP_ENABLE_SERVICE_WORKER`.
- The container image (below) serves a build through nginx with the same fallback and headers.

## Container image

Every release publishes `ghcr.io/mindroom-ai/mindroom-chat` for `linux/amd64` and `linux/arm64`, built from the release's commit as that release. Releases are the calendar versions `vYYYY.M.N` of [`ios-release.md`](ios-release.md#calendar-versions): one after every push to `main` whose CI passes, and any cut by hand with `just release`.

| Tag | Image |
|---|---|
| `YYYY.M.N`, for example `2026.11.0` | release `v2026.11.0` |
| `vYYYY.M.N` | the same image, under the release's Git tag |
| `sha-<commit>` | the same image, under the first 7 characters of the release's commit |
| `latest`, `dev`, `commit-<sha>`, branch names | the earlier MindRoom Chat app, which its own repository still publishes to this package; this repository never moves them |

A release's tags never move to another image. The image reports its release everywhere: `version.json` holds `{"version":"v2026.11.0","release":"v2026.11.0"}`, Settings > About shows `v2026.11.0`, and the labels `org.opencontainers.image.version` and `org.opencontainers.image.revision` name the release and its commit.

`.github/workflows/image.yml` builds it: `release.yml` calls it after an automatic release, and the release event starts it for one cut by hand. It builds each platform's image, starts it and checks what it serves (`scripts/image-smoke-test.sh`: the release in `version.json`, the app shell on any route, a 404 for a missing build file or file under `/public/`, `config.json`, `notices.json`, `runtime-config.js`, the cache and framing headers), and pushes only when both pass. If the push fails, the release stays without an image: rerun the workflow run's failed job (Actions, the run, **Re-run failed jobs**). Pull requests that change the image, and a manual run of the workflow, do the same checks as the next release and push nothing.

### Updating a deployment

Pin a release and move the pin to update; a running page notices the new `version.json` within five minutes and offers to reload.

- **Newest release:** `gh release view --repo mindroom-ai/mindroom-chat --json tagName --jq .tagName`, or the [releases page](https://github.com/mindroom-ai/mindroom-chat/releases).
- **MindRoom Helm chart** (`charts/mindroom-client`, MindRoom's `cluster/k8s/client`): set `image.tag` to the release, for example `--set image.tag=2026.11.0`, or `image.digest` to its digest. The chart's default tag, `latest`, is still the earlier app.
- **Automated updates** (Renovate, Flux image automation, Argo CD Image Updater): track tags matching `^\d{4}\.\d{1,2}\.\d+$` and order them as versions, not as text (`2026.11.10` is newer than `2026.11.9`).
- **Docker:** `docker run -d -p 8080:80 -v "$PWD/config.json:/app/config.json:ro" ghcr.io/mindroom-ai/mindroom-chat:2026.11.0`, then pull and start the next tag.

### What the image holds

- `nginx:1.30-alpine` listening on port 80, with the build in `/app` and `/usr/share/nginx/html` a link to it. Mount a deployment's `config.json` over `/app/config.json` ([`configuration.md`](configuration.md)).
- `docker/default.conf`, the site: every path that is not a file gets `index.html`; files under `/assets/` (hashed names) are cached for a year and a missing one is a 404, as is a missing file under `/public/`; every other response is revalidated (`Cache-Control: no-cache`). `notices.json` comes from `/opt/mindroom/notices/notices.json`, an empty list; mount a directory holding your own `notices.json` over `/opt/mindroom/notices`.
- `docker-entrypoint.d/`, run by nginx's entrypoint before it starts. `99-runtime-config.sh` writes `runtime-config.js` from `APP_BASE_PATH`, `APP_ENABLE_SERVICE_WORKER`, `APP_AUTHENTICATION_RECOVERY_PROBE_URL` and `APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL`, then appends the build's own, kept in `/opt/mindroom/runtime-config.js`. `40-frame-headers.sh` writes `/etc/nginx/conf.d/mindroom-frame-headers.conf`, which sends the framing headers from the `http` block; a `server` or `location` with an `add_header` of its own must `include /etc/nginx/mindroom-frame-headers.inc`, because nginx then drops the inherited headers, as `docker/default.conf` does.
- The MindRoom Helm chart starts `nginx` itself, as user 101 with a read-only root file system, mounts its own site config over `docker/default.conf` and answers `runtime-config.js` itself, so the start scripts do not run there; its README lists the settings.

`docker build -t mindroom-chat .` builds the image from a checkout; pass `--build-arg MINDROOM_BUILD_VERSION=<tag> --build-arg MINDROOM_RELEASE_VERSION=<tag>` to name its version, since `.git` stays out of the build (otherwise it reports a digest of its sources and `v` plus the package version). With client plugins (`--build-arg MINDROOM_CLIENT_PLUGINS=<directories in the build stage>`, [`configuration.md`](configuration.md#build-time-variables)) the version gets `-plugins-` and a digest of their files. The app is built once, on the build machine's platform, and copied into each platform's nginx image.

## Homeserver and MindRoom backend

- **Homeserver.** `config.json` decides which homeservers the sign-in page offers and whether people may type their own (`homeserverList`, `defaultHomeserver`, `allowCustomHomeservers`).
- **MindRoom agents.** A MindRoom backend (`mindroom run`) signs its agents in to a homeserver as ordinary Matrix accounts (`@mindroom_<name>:<server>`). Sign the client in to the same homeserver and talk to the agents in their rooms; chat needs nothing else.
- **MindRoom API.** Agent computers and Connections talk to the backend's HTTP API. Each agent publishes the backend's origin (its `MINDROOM_PUBLIC_URL`) as `io.mindroom.server` room state, and the client uses it. Set `mindroom.computers.apiUrl` in `config.json` to pin one origin instead; each user can override it in Settings > Agents & connections > Computers, under Advanced.
- **Local MindRoom.** Pairing a MindRoom that runs on someone's own machine goes through the provisioning service at `sidebar.mindRoomProvisioningUrl`, or the account's homeserver when the key is unset. `config.mindroom.json` sets it to `https://mindroom.chat`, and accounts on another homeserver cannot sign in to a provisioning service on a different origin, so a deployment for another homeserver changes or removes this key along with its homeserver settings.
