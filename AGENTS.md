# AGENTS.md

MindRoom Chat (`mindroom-ai/mindroom-chat`) is an Apache-2.0 web client for MindRoom, built on `matrix-js-sdk` with its Rust crypto.

## Code rules

- **No copyleft code.** Never copy code from GPL or AGPL projects, which most other Matrix clients are. The MindRoom backend (`mindroom-ai/mindroom`, Apache-2.0) defines the event formats the client reads (`docs/architecture.md` "MindRoom event formats").
- **Strict flags.** Every file (tests, `e2e/`, `electron/`, and `scripts/**/*.test.ts` included) compiles with `config/tsconfig.strict.json`; `just strict` and CI's "Strict check" step fail on any error. `just typecheck` and CI's "Type check" step compile `src/` without tests (`config/tsconfig.app.json`) with the same flags.
- **Type-aware lint.** Every TypeScript file, tests and `e2e/` included, passes the type-aware ESLint rules of `just lint`.
- **Placement and layers.** Place files per `docs/architecture.md` "Placement and naming": one folder per domain under `src/app/`, tests beside their subject, no barrel files. Domains import only lower layers (`docs/architecture.md` "Layers"; type-only and dynamic imports count, tests are exempt, `just lint` enforces it). Add new domains to `LAYERS` in `eslint.config.mjs`.
- **Quiet Glass sheets and dialogs.** Dialogs, settings frames, bottom sheets, and picker/directory sheets reuse `src/app/ui/DialogChrome.{tsx,css.ts}` (`DialogCloseButton`, `SheetScrollArea`, `SheetTitleBar`, `InsetField`, `SheetRow`, `SheetRowActionIdle`, `SheetFooter`) with `GlassPrimitives`, `Modal500`, `InsetScrollbar`, and `Segmented.css.ts` instead of adding one-off scrollbars, close buttons, or modal headers.

## Licenses and product

- **Licenses:** dependencies must be MIT, Apache-2.0, BSD, ISC, 0BSD, Zlib, Unicode, CC0, BlueOak, OFL (fonts), or MPL-2.0 used unmodified. See `scripts/license-check.mjs`, `scripts/watch/check_sdk_licenses.py`, and `NOTICE` for the exact allowlists and named exceptions. Never add `@element-hq/element-call-embedded`.
- **No app-wide Simple Mode:** the thread filter bar owns its simple/advanced filters (`simpleThreadFilters`, simple by default, no view buttons) and is toggled from the room header.
- **Room views:** the header's view switch toggles Compact and Threads; Classic is reached only via Jump to Time or a stored choice. Without a stored choice, a room opens in Threads when `io.mindroom.thread_mode` is `room`, else Compact with agents and Threads without.
- **Sections and no Inbox:** Activity (bell opens a popover on first click and its section on second click) and Threads are sections whose list sits beside the open thread; Inbox is removed.
- **Phone navigation:** phones keep a top bar above every page with a drawer for the rail and room list, use their own page-slide transition instead of browser View Transitions (which crash iOS WebKit; disabled under reduced motion), and omit a back button in the room header (the menu button returns to the list; room header promotes up to three actions when space permits).
- **Interface tour:** runs in a dialog on a sample room (Quick and Full levels), never on the live page.

## Commands

Run commands in `nix develop` (Node 24, npm, Chromium as `CHROMIUM_PATH`, Python 3, `just`). Outside Nix, use Node 24.15+ or 26+ (`package.json` `engines`): jsdom 31 requires `^24.15.0 || >=26` and some unit tests fail on Node 22.

| Recipe                                                | What it does                                                                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `just install`                                        | `npm ci`                                                                                                                                                                                                                |
| `just typecheck`                                      | `tsc --noEmit -p config/tsconfig.app.json` (`src/` without tests, strict flags; 0 errors)                                                                                                                               |
| `just strict`                                         | `tsc --noEmit -p config/tsconfig.strict.json` (app, tests, `e2e/`, `electron/`, script tests; 0 errors)                                                                                                                 |
| `just test [args]`                                    | `vitest run` (`src/`, `electron/`, `scripts/**/*.test.ts`); DOM tests opt in with `// @vitest-environment jsdom`                                                                                                        |
| `just lint`                                           | ESLint over `src/`, `e2e/`, `scripts/`, `electron/`, and config files (`package.json` `"lint"`), with type-aware TS rules, directional `PopOut`/`TooltipProvider` (`src/app/ui/directional.tsx`), and logical CSS sides |
| `just format <paths>`                                 | Prettier 3 (`package.json` pins `3.10.1`) on changed files                                                                                                                                                              |
| `just dev [args]`                                     | Vite on `http://127.0.0.1:4200` (serves `/runtime-config.js`, `/authentication-recovery.js`, and dev `/sw.js`)                                                                                                          |
| `just build`                                          | Production build into `dist/` (`scripts/build.sh`, also run by `npm run build:ios`) with `bundled-plugins.txt` plugins while `MINDROOM_CLIENT_PLUGINS` is unset (`docs/deployment.md` "Build")                          |
| `just build-desktop`                                  | Build the bundled web app (`npm run build:ios`) and Electron desktop shell (`electron/build.mjs`)                                                                                                                       |
| `just desktop`                                        | Launch the Electron desktop shell against `dist/` (run `just build-desktop` first)                                                                                                                                      |
| `just e2e-desktop [args]`                             | Run the Electron Playwright specs (`playwright.electron.config.ts`)                                                                                                                                                     |
| `just bundle-report [<dist>] [args]`                  | Report initial download and largest chunks against `scripts/perf/bundle-budget.json` (`docs/perf-and-testing.md`)                                                                                                       |
| `just release [<commit>] [--dry-run] [--yes]`         | Tag GitHub `main` with next CalVer `vYYYY.M.N` and publish release, container image, and Mac DMG (`docs/ios-release.md`, `docs/deployment.md`)                                                                          |
| `just license-check`                                  | Run `scripts/license-check.test.mjs` and check `node_modules` via `scripts/license-check.mjs`                                                                                                                           |
| `just hs-up`                                          | Start the disposable Tuwunel homeserver (`e2e/docker-compose.yaml`, `http://127.0.0.1:28008`) and wait until healthy                                                                                                    |
| `just hs-down`                                        | Stop the test homeserver and delete its data                                                                                                                                                                            |
| `just e2e [args]`                                     | Playwright with `CHROMIUM_PATH` against port 4200 (starts dev server if idle; run `just hs-up` first when needed)                                                                                                       |
| `just e2e-slot <n> [options] <cmd>\|up\|down`         | Run `<cmd>` on isolated slot `n` (homeserver `28100+n`, app `4300+n`; `--snapshot`, `--preview`, `--fresh`, `--rtc`)                                                                                                    |
| `just e2e-suite [options] [specs] [-- <pw opts>]`     | Run specs of one commit in `--preview` `e2e-slot` runs across slots, emitting TSV results (`docs/perf-and-testing.md`)                                                                                                  |
| `just agent-stack <n> up\|down\|status\|usage [opts]` | Run a real MindRoom backend (`stub`, `real`, or `live` model; `--agents N` for stub workers) against slot `n`                                                                                                           |
| `just watch-sdk [--fetch\|--publish]`                 | Build (`scripts/watch/build-sdk.sh`, checking crate licenses) or fetch `matrix-rust-sdk` into `ios/Watch/MatrixRustSDK/`                                                                                                |
| `just watch-kit-test`                                 | `swift test` of `ios/Watch/MindRoomWatchKit` (macOS only)                                                                                                                                                               |
| `just script-tests`                                   | Node and unittest suites for E2E tooling, notices, bundled plugins, iOS fixtures, bundle report, real-work perf, and replay (`scripts/perf/replay/replay.test.mjs`; full list in `justfile`)                            |
| `just check`                                          | Full local check: `typecheck`, `strict`, `lint`, `test`, `script-tests`, `license-check`                                                                                                                                |
| `scripts/push-gate.sh <checkout> --slot <n> [opts]`   | Pre-push gate on a commit archive: build + bundle budget, `tsc`, `strict`, `lint`, `vitest`, secret scan, and 15 smoke specs                                                                                            |

Live tests run on a fresh throwaway deployment started with `~/repos/dev/scripts/live.py up --chat <this checkout> [--backend <mindroom worktree>]` (`mindroom-ai/dev`), never on lab or production.

## Performance and testing scripts

Full CLI flags, env vars, port formulas, and safety rules live in [`docs/perf-and-testing.md`](docs/perf-and-testing.md).

| Area                              | Entry points                                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real-activity replay harness      | `scripts/perf/replay/{capture,server,multiplier}.mjs` + `e2e/perf/real-work.live.spec.ts` (`PERF_TARGET=external PERF_REPLAY_CAPTURE=...`); local-only, dedicated capture device, personal machines only |
| Synthetic real-work load          | `scripts/perf/real-work/{driver.py,matrix.sh,compare.mjs}` + `e2e/perf/workloads/*.json`                                                                                                                 |
| Profiles, traces, bundle, WebKit  | `scripts/perf/{cpuprofile-summary,trace-summary,bundle-report,webkit-insert-probe}.mjs`, `scripts/perf/seed-large-room.py`                                                                               |
| E2E isolation, RTC, backend, gate | `scripts/{e2e-slot,e2e-suite,e2e-rtc,e2e-matrix-up,e2e-matrix-down,push-gate}.sh`, `scripts/e2e-results-tsv.mjs`, `scripts/agent-stack/stack.py`                                                         |

## Commits

- Unsigned (`git -c commit.gpgsign=false commit`), on a branch, delivered as a pull request; never push to `main`.
- No em dashes in docs, comments, or commit messages.
- Add files by explicit path; never `git add -A`.

## Pull requests

- A pull request that changes what people see carries screenshots of that change, taken at the pull request's head (a throwaway Playwright spec on a `just e2e-slot` slot, or the dev server). Attach them with `gh pr create --attach '<file>#<alt text>'` when opening it, or `gh pr comment <number> --body '<what they show>' --attach '<file>#<alt text>'` on an open one; repeat `--attach` for each image. Take them again after a change that alters what they show.
