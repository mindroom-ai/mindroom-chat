# AGENTS.md

MindRoom Chat (`mindroom-ai/mindroom-chat`) is an Apache-2.0 web client for MindRoom, built on `matrix-js-sdk` with its Rust crypto.

## Code rules

- **No copyleft code.** Never copy code from GPL or AGPL projects, which most other Matrix clients are. The MindRoom backend (`/home/basnijholt/Work/dev/mindroom/`, Apache-2.0) defines the event formats the client reads (`docs/architecture.md` "MindRoom event formats").
- **Strict flags.** Every file, tests and `e2e/` included, compiles with the flags of `config/tsconfig.strict.json`; `just strict` and CI's "Strict check" step fail on any error. `just typecheck` and CI's "Type check" step compile the app sources on their own (`config/tsconfig.app.json`: `src/` without tests) with the same flags.
- **Type-aware lint.** Every TypeScript file, tests and `e2e/` included, passes the type-aware ESLint rules of `just lint`.
- **Placement and layers.** A file goes where `docs/architecture.md` "Placement and naming" puts it: one folder per domain under `src/app/`, tests beside their subject, no barrel files. A domain imports only domains in a lower layer (`docs/architecture.md` "Layers"); type-only and dynamic imports count, tests are exempt, and `just lint` fails on an import that climbs. A new domain needs a place in `LAYERS` in `.eslintrc.cjs`.

## Licenses and product

- Licenses: dependencies must be MIT, Apache-2.0, BSD, ISC, 0BSD, Zlib, Unicode, CC0, BlueOak, OFL (fonts), or MPL-2.0 used unmodified. `scripts/license-check.mjs` also accepts Python-2.0 (argparse) and Unlicense, and three packages by name (`require-like`, `caniuse-lite`, `jsonify`); `NOTICE` lists them with the reasons. The Rust crates the Apple Watch app links are checked against the same list by `scripts/watch/check_sdk_licenses.py`, which also accepts `xxhash-rust` (BSL-1.0) by name; `NOTICE` gives the reason. Never add `@element-hq/element-call-embedded`.
- Product: no app-wide Simple Mode. The thread filter bar has its own simple and advanced filters (simple by default, `simpleThreadFilters`) and no view buttons; the room header's filter button shows or hides it. The header's view switch toggles Compact and Threads; Classic is reached only through Jump to Time or a stored choice. A room without a stored choice opens in Threads while its `io.mindroom.thread_mode` state is `room`, else in Compact with agents and Threads without. The rail's bell opens Activity (mentions, replies in the user's threads, finished agent runs, and approvals, questions and invites it answers in place) as a popover, and as its section on a second click; Activity and Threads are sections whose list sits beside the thread it opens, and the Inbox is gone. On phones a top bar stays above every page with the menu button, a search field that opens the command palette, the Activity bell, which slides the Activity list up as a sheet, and the account; the menu button slides in a drawer with the icon rail and the section's room list over the page, and a room's members slide in the same way from the end edge. What shows deeper there (a page after the list, a thread that fills its room) comes in from the end edge over what was shown, and leaves to that edge on the way back, as a page of a phone's own apps does; the top bar stays, and nothing slides with reduced motion or in a browser without view transitions, where the drawer slides as before. The room header there keeps Back, the name, the button of a call that is on, the toggle of each plugin side panel whose `placement` is `row`, and the room menu, which holds the view switch, the filter bar toggle and the header's other actions. The interface tour teaches threads in a dialog on a sample room, never on the live page, in a Quick level (eight steps, the last two on resolving a thread and on the filter that hides resolved threads) and a Full level (twelve, the Quick tour's first); a card offers it until the account answers, and it opens from the command palette, Settings (About), the welcome page and a Compact room that has no thread.

## Commands

Every command runs in `nix develop` (Node 24, npm, Chromium as `CHROMIUM_PATH`, Python 3, `just`). Outside it, use Node 24 or newer (`package.json` `engines`): some unit tests fail on Node 22.

| Recipe | What it does |
|---|---|
| `just install` | `npm ci` |
| `just typecheck` | `tsc --noEmit -p config/tsconfig.app.json`: the app sources under `src/` without tests, with the stricter flags of `config/tsconfig.strict.json`, which it extends; must report 0 errors |
| `just strict` | `tsc --noEmit -p config/tsconfig.strict.json`: everything, tests and `e2e/` included, with the stricter flags; must report 0 errors |
| `just test [args]` | `vitest run`; DOM tests opt in with `// @vitest-environment jsdom` |
| `just lint` | ESLint over `src`, `e2e`, `scripts` and the config files, with type-aware rules for TypeScript, `PopOut` and `TooltipProvider` from `src/app/ui/directional.tsx`, and logical sides in styles (the files each rule covers and its exceptions: the `justfile` comment) |
| `just format <paths>` | Prettier (2.8.8) on the files you changed |
| `just dev` | Vite on `http://127.0.0.1:4200`; also serves `/runtime-config.js`, `/authentication-recovery.js` and a development `/sw.js` |
| `just build` | production build into `dist/`; `docs/deployment.md` "Build" and the `justfile` comment list what it holds |
| `just bundle-report [<dist>] [args]` | what a first visit to a build downloads, its largest chunks, and the size budget `scripts/perf/bundle-budget.json`, which CI checks after its build. Options: the `scripts/perf/bundle-report.mjs` header |
| `just release [<commit>] [--dry-run] [--yes]` | tags GitHub main with the next calendar version `vYYYY.M.N` and publishes its release, container image and Mac DMG; shows the plan and asks first. Options: the `justfile` comment; automatic releases: `docs/ios-release.md`; the image: `docs/deployment.md` |
| `just license-check` | `scripts/license-check.mjs`: fails on any installed package outside the license allowlist; runs its `node --test` suite first |
| `just hs-up` | starts the disposable Tuwunel test homeserver (`e2e/docker-compose.yaml`, `http://127.0.0.1:28008`) and waits until it is healthy |
| `just hs-down` | stops the test homeserver and deletes its data |
| `just e2e [args]` | Playwright in the Chromium from `CHROMIUM_PATH` against the dev server, which it starts when nothing listens on port 4200; run `just hs-up` first for specs that need the homeserver |
| `just e2e-slot <n> [options] <command>\|down` | runs the command with slot n's own homeserver (port 28100+n) and app port (4300+n); `--snapshot` runs it on a commit instead of the working tree, `--preview` its production build, `--rtc` adds the call service of the call specs. Options: the `scripts/e2e-slot.sh` header |
| `just e2e-suite [options] [specs] [-- <playwright options>]` | every spec file (or the given ones) of one commit, each in its own `e2e-slot` snapshot run, spread over slots; one TSV row per spec. Options: the `scripts/e2e-suite.sh` header |
| `just agent-stack <n> up\|down\|status\|usage [options]` | a real MindRoom backend, with a stub model (no model is called) or a real one, against slot n's homeserver; the agent specs start it themselves (`e2e/helpers/agentStack.ts`). `--agents N` adds N stub agents to the lobby (the real-work perf load, `e2e/perf/real-work.live.spec.ts`, spreads its streams over them). Options, ports, keys and exit codes: the `scripts/agent-stack/stack.py` docstring |
| `just watch-sdk [--fetch\|--publish]` | `scripts/watch/build-sdk.sh`: builds matrix-rust-sdk for the Apple Watch app into `ios/Watch/MatrixRustSDK/` on a Mac with rustup (pinned tag and patch in `ios/Watch/sdk/`), checking the linked crates' licenses; `--fetch` downloads the published build. Options: its header |
| `just watch-kit-test` | `swift test` of `ios/Watch/MindRoomWatchKit`, the watch app's pure Swift (MindRoom's event formats); macOS only |
| `just script-tests` | tests of the e2e tooling, the notices generator, the bundle report, the iOS test fixture generators and the real-work perf load (`scripts/perf/real-work/test_driver.py`, `scripts/perf/real-work/compare.test.mjs`); the `justfile` comment lists the files |
| `just check` | the full local check, every recipe its `justfile` line names. What CI runs: the `justfile` comment |
| `scripts/push-gate.sh <checkout> --slot <n> [--rev <commit>] [--base <rev>]` | the checks the coordinator runs on a commit before every push: build, type, lint and unit checks, a key scan and 15 smoke specs; one summary table. Details: the script's header |

## Commits

- Unsigned (`git -c commit.gpgsign=false commit`), on a branch, delivered as a pull request; never push to `main`.
- No em dashes in docs, comments, or commit messages.
- Add files by explicit path; never `git add -A`.

## Pull requests

- A pull request that changes what people see carries screenshots of that change, taken at the pull request's head (a throwaway Playwright spec on a `just e2e-slot` slot, or the dev server). Attach them with `gh pr create --attach '<file>#<alt text>'` when opening it, or `gh pr comment <number> --body '<what they show>' --attach '<file>#<alt text>'` on an open one; repeat `--attach` for each image. Take them again after a change that alters what they show.
