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
- **Test backend.** `just agent-stack <slot> up` runs a real MindRoom backend against an end-to-end slot's homeserver, which must already run, with a stub model by default (no model is called). It needs `uv` and a MindRoom Git checkout. The agent specs (`e2e/<domain>/agent-*.spec.ts` that use `e2e/helpers/agentStack.ts`) start it themselves and skip without a checkout. The docstring of `scripts/agent-stack/stack.py` describes its options, ports, environment variables and exit codes, and `e2e/helpers/agentStack.ts` the options of the specs' `test`.

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

## A client plugin in its own repository

A client plugin ([client-plugins.md](client-plugins.md)) can live in a repository of its own and build, typecheck, lint and run its unit tests against a checkout of this app, with no file of the app changed. The plugin's repository holds the checkout at its top as `.mindroom-chat`, a git-ignored link or a submodule, with its dependencies installed (`just install`); the plugin lists the packages the app shares with plugins under `peerDependencies`, which every build, test and config here takes from the app (with `legacy-peer-deps=true` in its `.npmrc`, npm does not install them in the plugin's directory). The configs below resolve their paths from the checkout's directory, so they work wherever the link points.

- **Typecheck.** The plugin's `tsconfig.json` extends `tsconfig.plugin.json`, and its `tsconfig.strict.json` adds `tsconfig.plugin.strict.json`, the flags of the app's `tsconfig.strict.json`:

  ```json
  { "extends": "./.mindroom-chat/tsconfig.plugin.json", "include": ["src", "e2e"] }
  ```

  ```json
  { "extends": ["./.mindroom-chat/tsconfig.plugin.strict.json", "./tsconfig.json"] }
  ```

  The base has the app's compiler options, `paths` for `@mindroom/client-sdk/*` (`testing` included), for each package the app shares with plugins, for `vitest`, and for the end-to-end specs `@mindroom/e2e/*` (the app's `e2e/helpers/`) and `@playwright/test`, all to the app's copies, and the app's ambient types (`types` `node`, from the app's `typeRoots`; a plugin with global types of its own sets both). A plugin's own `paths` replace the base's rather than adding to them, so a plugin that maps names of its own, such as the package names of its build module's aliases, repeats the base's entries with `./.mindroom-chat/` before each, the two of `@playwright/test` in their order: TypeScript takes its types from the first, and Playwright, which reads these `paths` as it loads the specs, its module from the second. `.mindroom-chat/node_modules/.bin/tsc -p tsconfig.json` checks the plugin and the app modules the SDK reaches; under the strict flags the app's own ported modules have errors that the app's `just strict` ignores, so the plugin keeps the errors in its own files: `tsc -p tsconfig.strict.json --pretty false | grep 'error TS' | grep -v '^\.mindroom-chat/'` prints none.
- **Lint.** The plugin's `.eslintrc.cjs` extends `.eslintrc.plugin.cjs`, the rules of the app's own code without its lanes and layers: logical sides in styles, `PopOut` from the SDK rather than folds, the React, hooks and accessibility rules, and the type-aware rules with the types of the plugin's `tsconfig.strict.json`. One more rule refuses an import that reaches the app's `src/` or `e2e/` by its path rather than through `@mindroom/client-sdk/<subpath>`, or in the plugin's specs `@mindroom/e2e/<helper>`. Files in the plugin's `e2e/` are tests, as the app's own specs are: they may use `any` and launch WebKit only through `@mindroom/e2e/webkit`. ESLint 8 loads its plugins from the directory `--resolve-plugins-relative-to` names, so the plugin runs the app's ESLint from its own directory:

  ```js
  module.exports = { root: true, extends: ['./.mindroom-chat/.eslintrc.plugin.cjs'] };
  ```

  ```bash
  .mindroom-chat/node_modules/.bin/eslint --resolve-plugins-relative-to .mindroom-chat --ext .ts,.tsx src
  ```

- **Unit tests.** From the checkout, `MINDROOM_CLIENT_PLUGINS=<plugin directory> MINDROOM_CLIENT_PLUGIN_TESTS_ONLY=1 npx vitest run` runs the plugin's tests alone, with its build module's hooks, so the names its `resolveId` maps resolve as in the build (`vitest.config.ts`); without `MINDROOM_CLIENT_PLUGIN_TESTS_ONLY` they run with the app's. Tests of the checkout inside the plugin's directory never run as the plugin's.
- **Build.** `MINDROOM_CLIENT_PLUGINS=<plugin directory> just build` in the checkout, or the image's `MINDROOM_CLIENT_PLUGINS` build argument (`Dockerfile`).
- **E2E.** The plugin's specs (`*.spec.ts` in its `e2e/` and the folders below it) run in the checkout's Playwright while `E2E_PLUGIN_DIRS` names the plugin's directory, in a Chromium project named after the directory (`playwright.config.ts`), with the app's global setup and its accounts. They import the app's helpers as `@mindroom/e2e/<helper>`, such as `@mindroom/e2e/matrix` for `e2e/helpers/matrix.ts`, and `@playwright/test` as the app's; a fixture page in the plugin's `e2e/fixtures/` loads at `/e2e-plugins/<directory name>/e2e/fixtures/<page>.html`. Such a page imports the app through `@mindroom/client-sdk/fixtures` (and the other subpaths), never its `src/`: `await bootFixturePage({ id, plugin, appearance: 'dark' })` before it renders gives it the app's styles, theme and translations with the plugin's strings, and `fixtureMindroomServer({ client, apiUrl })` a `MindroomServer` for a signed-in `createClient` client against a live backend ([client-plugins.md](client-plugins.md#fixtures)). From the checkout, with absolute directories:

  ```bash
  E2E_PLUGIN_DIRS=<plugin directory> MINDROOM_CLIENT_PLUGINS=<plugin directory> just e2e-slot 3 --preview npx playwright test --project=<directory name>
  ```

  The run builds the plugin in from a copy in its snapshot, so edits made in the plugin's directory meanwhile never reach it (the copy holds the plugin's directory alone, and a link in it that leads out of it, such as a local package npm installed, still leads where it did), and `E2E_PLUGIN_DIRS=<plugin directory> MINDROOM_CLIENT_PLUGINS=<plugin directory> just e2e-suite` runs the plugin's specs with the app's, each as `e2e-plugins/<directory name>/e2e/<spec>` in a run of its own, with a copy of the plugin's directory as it is when that run starts.

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

- `--snapshot[=<rev>]` copies a commit (default `HEAD`) to `$E2E_SNAPSHOT_ROOT/slot-<n>` and runs the command there with an empty homeserver, so uncommitted edits never reach the run. `--preview` also builds that commit and serves it with `vite preview`; with `E2E_PLUGIN_DIRS` or `MINDROOM_CLIENT_PLUGINS`, it copies their directories into the snapshot, names the copies in both variables and makes a build of the run's own. Specs that import `/src/` modules need the dev server (`--snapshot` without `--preview`).
- `E2E_MAX_CONCURRENT` (default 6, `0` for no limit) caps how many slot runs go at once, over every shell that uses the same `E2E_SNAPSHOT_ROOT` (default `/tmp/mindroom-client-e2e`).
- `just e2e-suite --slots 25-28 --out results.tsv [specs] [-- <playwright options>]` (Linux only: it reads `/proc/loadavg`) runs every spec file (or the given ones) of one commit, each in its own `--preview` slot run, and writes one TSV row per spec (passed, failed, skipped, first error, flaky, seconds, server, load average, and the tests skipped for a missing service, fixture, account or setting, which the summary names). The call specs get their slot's call service. `--rev <rev>` picks another commit, `--dev` uses the dev server for all specs but those of plugin directories, and `--resume <run directory>` finishes an interrupted run. Specs that import `/src/` modules run on the dev server even without `--dev`, so they get no production-build coverage. Playwright options default to `--retries 1`.
- `scripts/e2e-rtc.sh <slot> up|down|env` starts LiveKit and a MatrixRTC authorization service for the call specs; `e2e-slot --rtc` starts it before the slot's homeserver, which announces it, and stops it after the command.

## Native shells

`capacitor.config.ts` (app ID `chat.mindroom.app`; Android's `android/app/build.gradle` uses `com.mindroom_ai.app`) points both shells at `dist/`.

- **iOS** (macOS with Xcode and CocoaPods): `npm run build:ios` builds and writes `dist/config.json` from `config.mindroom.json` with `config.mindroom.ios.json` merged over it (set `MINDROOM_COMPUTER_API_URL` to pin the computer API). Then `npx cap sync ios` and open `ios/App/App.xcworkspace` in Xcode. Xcode Cloud runs `ios/App/ci_scripts/`, which version the app from the release tags. `scripts/build-macos-app.sh [--sign]` builds the Mac Catalyst app; `ios/App/fastlane/screenshots/README.md` covers App Store screenshots.
- **Android**: `npm run build`, then `npx cap sync android`, then build `android/` with Android Studio or Gradle.

[`ios-release.md`](ios-release.md) covers releases and the App Store app.

## README screenshots

The images in `docs/screenshots/` show the reference seed (`scripts/reference/seed.py`, the Launch War Room) in this client, signed in as Priya Raman with no stored settings besides the theme: 1440x900 at device scale 1 for the desktop, and 390x844 at device scale 3 for the phone, whose images are then scaled to half size. To retake them, start a fresh slot and register a throwaway account first (a fresh homeserver makes its first account the admin, which cannot leave the admin room), then seed it with an underscore suffix so the agent accounts are named like MindRoom's (`scripts/e2e-slot.sh <n> python3 scripts/reference/seed.py _demo`, with `E2E_SEED_AGENT_AVATARS` and `E2E_SEED_PEOPLE_AVATARS` naming the avatar folders that `seed.py` describes), and capture each view with Playwright.
