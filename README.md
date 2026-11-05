# MindRoom Client

MindRoom Client is an Apache-2.0 [Matrix](https://matrix.org) client for [MindRoom](https://github.com/mindroom-ai/mindroom), which runs AI agents as Matrix users in your chat rooms. It is a web app (React, TypeScript, Vite) on `matrix-js-sdk` with its Rust crypto, served as static files, and it has iOS and Android shells built with Capacitor. In its interface the app calls itself MindRoom Chat.

[`docs/provenance.md`](docs/provenance.md) explains where each file came from, and [`AGENTS.md`](AGENTS.md) holds the rules for changing code here.

## Features

- Sign-in with a password or single sign-on, registration, and several accounts side by side.
- Rooms, direct messages, spaces, invites, and an Explore page for public room directories.
- Threads: the Compact view shows one card per thread under a filter bar (count, status filters, sort, search, tags); the Full view shows the whole timeline. An open thread fills the main area under a banner where you rename, tag, pin or resolve it.
- MindRoom agent replies: streaming status, tool calls, model and usage details, tool approval cards, and thread titles written by the agents.
- Agent canvases (HTML pages in sandboxed frames), the agent's computer (a remote desktop panel), schedules, background jobs, Connections, and pairing with a Local MindRoom.
- A rich-text composer with Markdown, mentions, emoji, custom emoji and stickers, attachments, and voice messages.
- End-to-end encryption with device verification, key backup and a recovery key.
- Calls over LiveKit (MatrixRTC), a command palette, message search, an Inbox for notifications and invites, and bug reports.
- 17 languages (Arabic is right to left), light and dark themes, and a start from cache when offline.

## Quick start

The Nix dev shell provides Node 24, npm, Python 3, `just`, Git and Chromium (`CHROMIUM_PATH`). Docker is needed for the test homeserver.

```bash
nix develop
just install   # npm ci; applies patches/ with patch-package
just dev       # http://127.0.0.1:4200
```

Without Nix, use Node 24 or newer (`package.json` `engines`; some unit tests fail on Node 22), Python 3, `just` and Docker, and set `CHROMIUM_PATH` for the end-to-end specs.

The dev server answers `/config.json` with `config.mindroom.json`, so the sign-in page offers `mindroom.chat` and `matrix.org`. Type any other homeserver into the Server field: a server name is looked up through `/.well-known/matrix/client`, and a URL works too. Plain HTTP is accepted only for localhost and private network addresses.

`just --list` shows every recipe; `AGENTS.md` describes each one.

## Homeserver and MindRoom backend

- **Homeserver.** `config.json` decides which homeservers the sign-in page offers and whether people may type their own (`homeserverList`, `defaultHomeserver`, `allowCustomHomeservers`). For local work, `just hs-up` starts a disposable Tuwunel homeserver with open registration at `http://127.0.0.1:28008` (server name `matrix.localhost`); `just hs-down` stops it and deletes its data.
- **MindRoom agents.** A MindRoom backend (`mindroom run`) signs its agents in to a homeserver as ordinary Matrix accounts (`@mindroom_<name>:<server>`). Sign the client in to the same homeserver and talk to the agents in their rooms; chat needs nothing else.
- **MindRoom API.** Agent computers and Connections talk to the backend's HTTP API. Each agent publishes the backend's origin (its `MINDROOM_PUBLIC_URL`) as `io.mindroom.server` room state, and the client uses it. Set `mindroom.computers.apiUrl` in `config.json` to pin one origin instead; each user can override it in Settings > General > Computers.
- **Local MindRoom.** Pairing a MindRoom that runs on someone's own machine goes through the provisioning service at `sidebar.mindRoomProvisioningUrl` (default: the account's homeserver).
- **Test backend.** `just agent-stack <slot> up` runs a real backend with a stub model (no model is called) against an end-to-end slot's homeserver; the `e2e/lane-c/agent-*.spec.ts` specs start it themselves.

Every `config.json` key, its default and its effect: [`docs/configuration.md`](docs/configuration.md).

## Checks

| Command | What it does |
|---|---|
| `just check` | The full local check (CI, `.github/workflows/ci.yml`, runs `typecheck`, `strict`, `lint` and `test`): `typecheck`, `strict`, `lint`, `test`, `script-tests`, `license-check`, and the provenance checks (`verify-ported`, `check-holes` and the overlap check of `docs/provenance.md`; the ones that need an outside checkout skip without it) |
| `just typecheck` | `tsc` over the app sources without tests; must report 0 errors |
| `just strict` | `tsc` with `tsconfig.strict.json`; fails on errors in Lane C files only |
| `just lint` | ESLint, with type-aware rules for Lane C TypeScript |
| `just test [files]` | Vitest unit tests (next to the code as `*.test.ts(x)`; DOM tests opt in with `// @vitest-environment jsdom`) |
| `just typecheck-tests` | `tsc` over everything, tests and `e2e/` included; reports its errors without failing |

### End-to-end specs

The specs in `e2e/` run in Playwright with the Chromium from `CHROMIUM_PATH`. `e2e/global-setup.ts` lists the environment variables they read. Without `E2E_USERNAME`, it registers its own accounts on the local test homeserver and seeds a fixture room.

```bash
just hs-up
just e2e e2e/account/password-login.spec.ts   # starts the dev server on port 4200 unless one is running
just hs-down
```

Several runs can share a machine through slots. Slot `n` has its own homeserver on port 28100+n and its own app port 4300+n:

```bash
just e2e-slot 3 npx playwright test e2e/account/password-login.spec.ts             # dev server on the working tree
just e2e-slot 3 --snapshot npx playwright test e2e/account/password-login.spec.ts  # dev server on a clean copy of HEAD
just e2e-slot 3 --preview npx playwright test e2e/account/password-login.spec.ts   # production build of HEAD
just e2e-slot 3 --rtc --preview npx playwright test e2e/calls/calls.spec.ts  # with the slot's call service
just e2e-slot 3 down                                                        # stop the slot, delete its data
```

- `--snapshot[=<rev>]` copies a commit (default `HEAD`) to `$E2E_SNAPSHOT_ROOT/slot-<n>` and runs the command there with an empty homeserver, so uncommitted edits never reach the run. `--preview` also builds that commit and serves it with `vite preview`. Specs that import `/src/` modules need the dev server (`--snapshot` without `--preview`).
- `E2E_MAX_CONCURRENT` (default 6, `0` for no limit) caps how many slot runs go at once, over every shell that uses the same `E2E_SNAPSHOT_ROOT` (default `/tmp/mindroom-client-e2e`).
- `just e2e-suite --slots 25-28 --out results.tsv [specs] [-- <playwright options>]` runs every spec file (or the given ones) of one commit, each in its own `--preview` slot run, and writes one TSV row per spec (passed, failed, skipped, first error, flaky, seconds, server, load average, and the tests skipped for a missing service, fixture, account or setting, which the summary names). The call specs get their slot's call service. `--rev <rev>` picks another commit, `--dev` uses the dev server for all specs, and `--resume <run directory>` finishes an interrupted run. Playwright options default to `--retries 1`.
- `scripts/e2e-rtc.sh <slot> up|down|env` starts LiveKit and a MatrixRTC authorization service for the call specs; `e2e-slot --rtc` starts it before the slot's homeserver, which announces it, and stops it after the command.

## Build and deploy

`just build` writes a static site to `dist/`:

| File | Purpose |
|---|---|
| `index.html`, `assets/`, `res/`, `sound/`, `public/locales/`, `manifest.json` | the app |
| `config.json` | a copy of `config.mindroom.json`; replace it per deployment ([`docs/configuration.md`](docs/configuration.md)) |
| `runtime-config.js` | sets the deployment globals before the app starts (base path, service worker, sign-in recovery) |
| `authentication-recovery.js` | recovers sign-in behind an authenticating proxy |
| `sw.js` | the service worker: precaches what a signed-in start needs for offline starts, keeps the build's other files and the language catalogs once a page has loaded them, fetches authenticated media |
| `version.json` | the build version, polled by running clients, whose service worker then installs a new deployment for the next start |
| `public/licenses/` | `LICENSE`, `NOTICE` and third-party license texts |

To deploy, serve `dist/` from the root of an origin and answer every path that is not a file with `index.html`; with `hashRouter.enabled` in `config.json`, routes live after `#` and no rewrite is needed. `config.json`, `runtime-config.js`, `authentication-recovery.js` and `version.json` are not precached by the service worker, so a deployment can change them without a new build. The precache holds the app shell, the code, styles and images of a signed-in start and the crypto wasm (`scripts/precache-plan.mjs`); other files under `assets/` (chunks loaded on demand, sounds, the thinking marks) and the catalogs under `public/locales/` are kept the first time a page loads them, and a new build's worker keeps the kept files its build still has. A page still open from the previous build therefore loads its on-demand chunks from the server: when a deployment removed them, the page says a new version is available and its Reload starts the new build (`src/app/config/appUpdate.ts`). Keep the previous build's `assets/` files for a while after a deployment to spare open pages even that. The build is not usable under a sub-path: its asset URLs start at `/`.

Who may frame the app is a response header, not part of the build (values in `scripts/frame-headers.json`, rule in `scripts/frame-headers.mjs`): `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` on every path, and `frame-ancestors 'none'` with `X-Frame-Options: DENY` on the pairing page, in every spelling the router renders it under (`/connect`, `/CONNECT/`, `/%63onnect`, under a base path). `vite preview`, `serve.py` and the nginx start script `docker-entrypoint.d/40-frame-headers.sh` send them, and the service worker gives the pairing page its own when it answers from the cached app shell. `netlify.toml` sends them too, but its rules name only `/connect` and `/connect/`, so other spellings may get `'self'` there on a first visit.

- `MINDROOM_BUILD_VERSION` and `MINDROOM_RELEASE_VERSION` set the version the build reports (otherwise taken from Git).
- `cd dist && python3 ../serve.py 8090` serves a build with the `index.html` fallback. It generates its own `runtime-config.js` from `APP_BASE_PATH` and `APP_ENABLE_SERVICE_WORKER`.
- The repository has no Dockerfile. `docker-entrypoint.d/` holds start scripts for an image based on the official `nginx` image, with `dist/` in `/usr/share/nginx/html` and the build's `runtime-config.js` copied to `/opt/mindroom/runtime-config.js`. `99-runtime-config.sh` writes `runtime-config.js` from `APP_BASE_PATH`, `APP_ENABLE_SERVICE_WORKER`, `APP_AUTHENTICATION_RECOVERY_PROBE_URL` and `APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL`, then appends the build's own. `40-frame-headers.sh` writes `/etc/nginx/conf.d/mindroom-frame-headers.conf`, which sends the framing headers from the `http` block; a `server` or `location` with an `add_header` of its own must `include /etc/nginx/mindroom-frame-headers.inc`, because nginx then drops the inherited headers. The nginx site needs the same `index.html` fallback.

## Native shells

`capacitor.config.ts` (app ID `chat.mindroom.app`) points both shells at `dist/`.

- **iOS** (macOS with Xcode and CocoaPods): `npm run build:ios` builds and writes `dist/config.json` from `config.mindroom.json` with `config.mindroom.ios.json` merged over it (set `MINDROOM_COMPUTER_API_URL` to pin the computer API). Then `npx cap sync ios` and open `ios/App/App.xcworkspace` in Xcode. Xcode Cloud runs `ios/App/ci_scripts/`. `scripts/build-macos-app.sh [--sign]` builds the Mac Catalyst app; `ios/App/fastlane/screenshots/README.md` covers App Store screenshots.
- **Android**: `npm run build`, then `npx cap sync android`, then build `android/` with Android Studio or Gradle.

## Documentation

- [`docs/configuration.md`](docs/configuration.md): `config.json`, `runtime-config.js` and build variables.
- [`docs/architecture.md`](docs/architecture.md): folders, the two code lanes, and how the MindRoom event formats are handled.
- [`AGENTS.md`](AGENTS.md): rules and the full recipe list.
- [`docs/provenance.md`](docs/provenance.md): where the code came from.
- [`docs/design/reference/`](docs/design/reference/): the screenshots the app is compared with.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
