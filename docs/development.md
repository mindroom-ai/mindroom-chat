# Development

How to run the client from a checkout, the checks every change passes, the end-to-end specs, and the native shells. [`AGENTS.md`](../AGENTS.md) holds the rules for changing code here and describes the `just` recipes; [`architecture.md`](architecture.md) explains the layout.

## Setup

The Nix dev shell provides Node 24, npm, Python 3, `just`, Git and, on Linux, Chromium (`CHROMIUM_PATH`); on macOS, set `CHROMIUM_PATH` to a Chromium you installed before running the end-to-end specs. Docker is needed for the test homeserver, and `flock` (part of util-linux on Linux, not shipped with macOS) for slot runs.

```bash
nix develop
just install   # npm ci; applies patches/ with patch-package
just dev       # http://127.0.0.1:4200
```

Without Nix, use Node 24 or newer (`package.json` `engines`; some unit tests fail on Node 22), Python 3, `just` and Docker, and set `CHROMIUM_PATH` for the end-to-end specs.

The dev server answers `/config.json` with `config.mindroom.json`, so the sign-in page offers `mindroom.chat` and `matrix.org`. Type any other homeserver into the Server field: a server name is looked up through `/.well-known/matrix/client`, and a URL works too. Plain HTTP is accepted only for localhost and private network addresses.

- **Test homeserver.** `just hs-up` starts a disposable Tuwunel homeserver with open registration at `http://127.0.0.1:28008` (server name `matrix.localhost`) that binds OpenID tokens to the audience they were requested for (`io.mindroom.openid_audience`); `just hs-down` stops it and deletes its data. Every end-to-end run starts the Tuwunel image that `e2e/docker-compose.yaml` pins by release tag and digest: CI, `just hs-up`, slot runs, `scripts/e2e-matrix-up.sh` (unless `MINDROOM_TUWUNEL_IMAGE` names another) and the remote test runners. Server behaviour, such as read and unread counts, changes between releases, so a new release reaches the specs only through a commit that bumps the pin:
  1. Pick the release (`gh release list -R mindroom-ai/mindroom-tuwunel`) and read its notes.
  2. Look up the digest of its multi-platform index, which must list `linux/amd64` and `linux/arm64`: `docker buildx imagetools inspect ghcr.io/mindroom-ai/mindroom-tuwunel:<tag>`, or only the digest with `--format '{{.Manifest.Digest}}'`.
  3. Set the `image:` line of `e2e/docker-compose.yaml` to `ghcr.io/mindroom-ai/mindroom-tuwunel:<tag>@sha256:<digest>`.
  4. Run the smoke specs of `.github/workflows/ci.yml` (and any spec the release notes touch) against it, and fix the client in the same branch when one fails.
- **Test backend.** `just agent-stack <slot> up` runs a real MindRoom backend against an end-to-end slot's homeserver, which must already run, with a stub model by default (no model is called); `--model real` or `E2E_AGENT_MODEL=real` calls paid models with the API keys in the environment instead. A checkout with call transcripts runs with them on, transcribing with a stand-in that answers with each recording's length; `--transcription real` or `E2E_AGENT_TRANSCRIPTION=real` transcribes with OpenAI's speech-to-text and writes the notes with GPT-6 Luna, with `OPENAI_API_KEY` from the environment. It needs `uv` and a MindRoom Git checkout (`--checkout` or `E2E_MINDROOM_CHECKOUT`). The agent specs (`e2e/<domain>/agent-*.spec.ts` that use `e2e/helpers/agentStack.ts`) start it themselves and skip without a checkout. `--client-sessions` lets the slot's Chat sign in to the backend's plugin routes, on a homeserver that binds OpenID tokens; `--computers` gives the helper a Worker Computer, in Docker workers built from the same MindRoom commit. `E2E_PLUGIN_DIRS` names plugin directories (separated like `PATH`, relative to the repository), for the stack and the app server alike: a MindRoom plugin at a directory's top (`mindroom.plugin.json`) passes `mindroom plugins check --json` before the stack starts, or the start stops with the check's detail, and then the backend loads it and the helper offers its tools; `e2e/stub-scenarios.json` adds hashtag scenarios to the stub model (`scripts/agent-stack/stub_model.py`); and the app server serves each directory at `/e2e-plugins/<directory name>/`, so a fixture page in its `e2e/fixtures/` loads at `/e2e-plugins/<directory name>/e2e/fixtures/<page>.html`: the dev server from where the directory is, a `--preview` build from a copy in its snapshot. `e2e/fixtures/sample-plugin` is one, which `e2e/messages/agent-plugin-directory.spec.ts` uses.

`just --list` shows every recipe; `AGENTS.md` describes them.

## Checks

| Command | What it does |
|---|---|
| `just check` | The full local check (CI, `.github/workflows/ci.yml`, runs `typecheck`, `strict`, `lint`, `test` and a smoke subset of the end-to-end specs): `typecheck`, `strict`, `lint`, `test`, `script-tests`, `license-check`, and the provenance checks (`verify-ported`, `check-holes`, `identifier-renames` and the overlap check of `docs/provenance.md`; the ones that need an outside checkout skip without it) |
| `just typecheck` | `tsc` over the app sources without tests; must report 0 errors |
| `just strict` | `tsc` with `tsconfig.strict.json`; fails on errors in Lane C files only |
| `just lint` | ESLint, with type-aware rules for Lane C TypeScript |
| `just test [files]` | Vitest unit tests (next to the code as `*.test.ts(x)`; DOM tests opt in with `// @vitest-environment jsdom`) |
| `just typecheck-tests` | `tsc` over everything, tests and `e2e/` included; reports its errors without failing |

## End-to-end specs

The specs in `e2e/` run in Playwright with the Chromium from `CHROMIUM_PATH`. `e2e/global-setup.ts` lists the environment variables they read. Without `E2E_USERNAME`, it registers its own accounts on the local test homeserver and seeds a fixture room.

```bash
just hs-up
just e2e e2e/account/password-login.spec.ts   # starts the dev server on port 4200 unless one is running
just hs-down
```

Several runs can share a machine through slots. Slot `n` has its own homeserver on port 28100+n and its own app port 4300+n. Slot 0 is the `just hs-up` homeserver (ports 28008 and 4200), so `--snapshot` or `down` on slot 0 deletes that homeserver's data:

```bash
just e2e-slot 3 npx playwright test e2e/account/password-login.spec.ts             # dev server on the working tree
just e2e-slot 3 --snapshot npx playwright test e2e/account/password-login.spec.ts  # dev server on a clean copy of HEAD
just e2e-slot 3 --preview npx playwright test e2e/account/password-login.spec.ts   # production build of HEAD
just e2e-slot 3 --rtc --preview npx playwright test e2e/calls/calls.spec.ts  # with the slot's call service
just e2e-slot 3 down                                                        # stop the slot, delete its data
```

- `--snapshot[=<rev>]` copies a commit (default `HEAD`) to `$E2E_SNAPSHOT_ROOT/slot-<n>` and runs the command there with an empty homeserver, so uncommitted edits never reach the run. `--preview` also builds that commit and serves it with `vite preview`. Specs that import `/src/` modules need the dev server (`--snapshot` without `--preview`).
- `E2E_MAX_CONCURRENT` (default 6, `0` for no limit) caps how many slot runs go at once, over every shell that uses the same `E2E_SNAPSHOT_ROOT` (default `/tmp/mindroom-client-e2e`).
- `just e2e-suite --slots 25-28 --out results.tsv [specs] [-- <playwright options>]` (Linux only: it reads `/proc/loadavg`) runs every spec file (or the given ones) of one commit, each in its own `--preview` slot run, and writes one TSV row per spec (passed, failed, skipped, first error, flaky, seconds, server, load average, and the tests skipped for a missing service, fixture, account or setting, which the summary names). The call specs get their slot's call service. `--rev <rev>` picks another commit, `--dev` uses the dev server for all specs, and `--resume <run directory>` finishes an interrupted run. Specs that import `/src/` modules run on the dev server even without `--dev`, so they get no production-build coverage. Playwright options default to `--retries 1`.
- `scripts/e2e-rtc.sh <slot> up|down|env` starts LiveKit and a MatrixRTC authorization service for the call specs; `e2e-slot --rtc` starts it before the slot's homeserver, which announces it, and stops it after the command.

## Native shells

`capacitor.config.ts` (app ID `chat.mindroom.app`; Android's `android/app/build.gradle` uses `com.mindroom_ai.app`) points both shells at `dist/`.

- **iOS** (macOS with Xcode and CocoaPods): `npm run build:ios` builds and writes `dist/config.json` from `config.mindroom.json` with `config.mindroom.ios.json` merged over it (set `MINDROOM_COMPUTER_API_URL` to pin the computer API). Then `npx cap sync ios` and open `ios/App/App.xcworkspace` in Xcode. Xcode Cloud runs `ios/App/ci_scripts/`, which version the app from the release tags. `scripts/build-macos-app.sh [--sign]` builds the Mac Catalyst app; `ios/App/fastlane/screenshots/README.md` covers App Store screenshots.
- **Android**: `npm run build`, then `npx cap sync android`, then build `android/` with Android Studio or Gradle.

[`ios-release.md`](ios-release.md) covers releases and the App Store app.

## README screenshots

The images in `docs/screenshots/` show the reference seed (`scripts/reference/seed.py`, the Launch War Room) in this client, signed in as Priya Raman with no stored settings besides the theme: 1440x900 at device scale 1 for the desktop, and 390x844 at device scale 3 for the phone, whose images are then scaled to half size. To retake them, start a fresh slot and register a throwaway account first (a fresh homeserver makes its first account the admin, which cannot leave the admin room), then seed it with an underscore suffix so the agent accounts are named like MindRoom's (`scripts/e2e-slot.sh <n> python3 scripts/reference/seed.py _demo`, with `E2E_SEED_AGENT_AVATARS` and `E2E_SEED_PEOPLE_AVATARS` naming the avatar folders that `seed.py` describes), and capture each view with Playwright.
