# AGENTS.md

MindRoom Chat (`mindroom-ai/mindroom-chat`) is an Apache-2.0 web client for MindRoom, built on `matrix-js-sdk` with its Rust crypto. It is a clean-room rebuild: files whose lines `git blame` credits to Bas Nijholt (at least 95% of each) are ported from the legacy MindRoom Chat client (`mindroom-ai/mindroom-chat-legacy`), and everything else is written fresh without access to the upstream client or the legacy client's source. Below, "MindRoom Chat" as a source means that legacy client.

## The two lanes

- **Lane P (ported):** files listed in `docs/provenance/portable.tsv` (first import), `docs/provenance/portable-wave2.tsv` (second import) and `docs/provenance/portable-wave3.tsv` (third import: binary assets, verified by blob hash), copied from MindRoom Chat `fc3a5905`; the lists keep the paths the files had when they were imported. `git blame` credited Bas with at least 95% of each text file's lines; every other line was blanked (`docs/provenance/holes.tsv`, `docs/provenance/holes-wave2.tsv`). `docs/provenance/import.txt` names each wave's import commit, one line per wave. Per Bas Nijholt's instruction of 2026-11-02, he licenses the lines he wrote in the files of the first and second imports under Apache-2.0 for this project; third-party material in those files keeps its own license, and per his instruction of 2026-11-05 his MindRoom artwork in the third import, and the Android icons drawn from it, is under Apache-2.0 too (`NOTICE`, `docs/provenance.md`).
- **Dropped:** `docs/provenance/dropped.tsv` lists Lane P files deleted during the rewrite, at their import-time paths: with a dropped feature, as dead code, or merged into another file. MindRoom Chat repository tooling and `FORK_CHANGES.md` were removed from every commit; `FORK_CHANGES.md` is not an input, and no session may read it from any copy.
- **No upstream code, in any commit:** `scripts/upstream-overlap/check.py` (`just upstream-overlap <upstream clone>`) must report 0 findings for every new commit before it is pushed (`--history` checks all of them). Only the orchestrator holds the upstream clone; other sessions may run the check on their own files when told the corpus path, and may never open the corpus or the checker's cache (`$XDG_CACHE_HOME/upstream-overlap`, default `~/.cache/upstream-overlap`), which holds upstream lines. The pre-push hook enforces it in every clone it is installed in (`just install-hooks <upstream clone>`): each push checks every commit it adds, file by file as the commit has it, and is refused on any finding, a missing corpus or a checker error. A later commit that deletes the lines does not help; rewrite the commits that carry them. `--history` leaves out the findings in old file versions that `scripts/upstream-overlap/reviewed-history.tsv` lists as reviewed; only the coordinator adds rows to it, each with its reason, and it never applies to new commits, which the pre-push check holds to every finding. Never push with `--no-verify`; `UPSTREAM_OVERLAP_BYPASS='<reason>'` is the coordinator's emergency bypass, printed and logged.
- **Lane C (clean):** everything else, including the seams (modules that Lane P files import but that were not ported; `docs/provenance/seams.tsv`, by import-time path) and the app shell.

The lists keep import-time paths, and `docs/provenance/moves.tsv` (old path, new path, batch) maps the files moved during the rewrite to their paths then (`docs/provenance.md` "Moves" describes the rewrite's moves). These records describe the rewrite as it was done and are no longer kept up to date: a move, rename or deletion adds no rows. The tools that sort files by lane read them, so a Lane P file moved after the rewrite is Lane C to them: `just strict` and `just lint` hold it to Lane C's rules, and a move fixes what they report in the moved file. `node scripts/provenance-paths.cjs lane <path>` prints the lane the tools give a file.

`docs/provenance.md` records the clean-room rewrite: both lanes and the rewrite's session log. It is no longer updated; don't edit it.

### Lane C rules

- **Lane C rules (spec section 2; where the spec, written before the move, names MindRoom Chat or `mindroom-ai/mindroom-chat`, it means the legacy client).** Never open, search, fetch, or install as source: the upstream client named in `docs/provenance.md` (its GitHub organization, any fork or mirror), the legacy MindRoom Chat client (`mindroom-ai/mindroom-chat-legacy`, which was `mindroom-ai/mindroom-chat` until 2026-11-07 UTC, when that name passed to this repository; `/home/basnijholt/Work/dev/mindroom-chat`, `/tmp/chat-ref`, any other checkout), Element Web, Element X, Element Call, FluffyChat, Nheko, Fractal, NeoChat, SchildiChat, and `mindroom/docs/baspowers/`, `mindroom/docs/dev/`. `folds` may be installed and its published API docs and type definitions read.
- Allowed inputs: this repository (including Lane P files, but not `FORK_CHANGES.md`), `docs/provenance/seams.tsv`, `docs/design/reference/`, the Matrix specification, library documentation and type definitions, `/home/basnijholt/Work/dev/mindroom/docs/` (other pages) and `/home/basnijholt/Work/dev/mindroom/src/`.
- Lane C code must pass `just strict` (`tsconfig.strict.json`) and the type-aware ESLint rules that `just lint` applies to Lane C TypeScript.

### Both lanes

- **Placement and layers.** A file goes where `docs/architecture.md` "Placement and naming" puts it: one folder per domain under `src/app/`, tests beside their subject, no barrel files. A domain imports only domains in a lower layer (`docs/architecture.md` "Layers"); type-only and dynamic imports count, tests are exempt, and `just lint` fails on an import that climbs. A new domain needs a place in `LAYERS` in `.eslintrc.cjs`.

### Lane P files

- **Lane P files** (listed in `docs/provenance/portable.tsv`, `portable-wave2.tsv` and `portable-wave3.tsv`) are edited like any other file; the lists only record where they came from.
- **Seams:** a seam's implementation is new code. A seam may move, be renamed, merged or deleted like any Lane C module: every Lane P import of it is re-pointed with it, and the names Lane P call sites use keep types that satisfy them. A deleted or merged seam adds no provenance row.

## Licenses and product

- Licenses: dependencies must be MIT, Apache-2.0, BSD, ISC, 0BSD, Zlib, Unicode, CC0, BlueOak, OFL (fonts), or MPL-2.0 used unmodified. `scripts/license-check.mjs` also accepts Python-2.0 (argparse) and Unlicense, and three packages by name (`require-like`, `caniuse-lite`, `jsonify`); `NOTICE` lists them with the reasons. Never add `@element-hq/element-call-embedded`.
- Product: no app-wide Simple Mode. The thread filter bar has its own simple and advanced filters (simple by default, `simpleThreadFilters`) and no view buttons; the room header's filter button shows or hides it. The header's view switch toggles Compact and Threads; Classic is reached only through Jump to Time or a stored choice. A room without a stored choice opens in Threads while its `io.mindroom.thread_mode` state is `room`, else in Compact with agents and Threads without. The rail's bell opens Activity (mentions, replies in the user's threads, finished agent runs, and approvals, questions and invites it answers in place) as a popover, and as its section on a second click; Activity and Threads are sections whose list sits beside the thread it opens, and the Inbox is gone. On phones a top bar stays above every page with the menu button, a search field that opens the command palette, the Activity bell, which slides the Activity list up as a sheet, and the account; the menu button slides in a drawer with the icon rail and the section's room list over the page, and a room's members slide in the same way from the end edge. The room header there keeps Back, the name, the button of a call that is on, the toggle of each plugin side panel whose `placement` is `row`, and the room menu, which holds the view switch, the filter bar toggle and the header's other actions.

## Commands

Every command runs in `nix develop` (Node 24, npm, Chromium as `CHROMIUM_PATH`, Python 3, `just`). Outside it, use Node 24 or newer (`package.json` `engines`): some unit tests fail on Node 22.

| Recipe | What it does |
|---|---|
| `just install` | `npm ci` |
| `just typecheck` | `tsc --noEmit -p tsconfig.app.json`: the app sources under `src/` without tests; must report 0 errors |
| `just typecheck-tests` | `tsc --noEmit -p .`: everything, tests and `e2e/` included; reports its errors without failing |
| `just typecheck-all` | `scripts/typecheck-all.mjs`: syntax and semantic errors together over `tsconfig.json` |
| `just strict` | `scripts/strict-check.mjs`: `tsc` with the stricter flags of `tsconfig.strict.json`; fails on Lane C errors only and prints the count of Lane P errors it ignores |
| `just test [args]` | `vitest run`; DOM tests opt in with `// @vitest-environment jsdom` |
| `just lint` | ESLint over `src`, `e2e`, `scripts` and the config files, with type-aware rules for Lane C TypeScript, which also takes `PopOut` and `TooltipProvider` from `src/app/ui/directional.tsx` and writes styles with logical sides (the rules and their exceptions: the `justfile` comment) |
| `just format <paths>` | Prettier (2.8.8, matches the Lane P style) on the files you changed |
| `just dev` | Vite on `http://127.0.0.1:4200`; also serves `/runtime-config.js`, `/authentication-recovery.js` and a development `/sw.js` |
| `just build` | production build into `dist/`; `docs/deployment.md` "Build" and the `justfile` comment list what it holds |
| `just bundle-report [<dist>] [args]` | what a first visit to a build downloads, its largest chunks, and the size budget `scripts/perf/bundle-budget.json`; its options: the `justfile` comment and the `scripts/perf/bundle-report.mjs` header |
| `just release [<commit>] [--dry-run] [--yes]` | tags GitHub main with the next calendar version `vYYYY.M.N` and publishes its release and container image; shows the plan and asks first. Options: the `justfile` comment; automatic releases: `docs/ios-release.md`; the image: `docs/deployment.md` |
| `just license-check` | `scripts/license-check.mjs`: fails on any installed package outside the license allowlist; runs its `node --test` suite first |
| `just verify-ported [legacy chat checkout]` | recomputes both Lane P import waves (`port_files.py --wave N --verify`); prints a notice and passes when no path is given |
| `just check-holes` | `scripts/check_holes.py`: each wave's Lane P files differ from the import only in their blanked lines, at the commit that filled them |
| `just identifier-renames` | `scripts/check-identifier-renames.mjs` (rules in its header): Lane P lines that a commit of `docs/provenance/identifier-renames.tsv` changes differ only by its renames; runs its `node --test` suite first |
| `just similarity-audit <corpus>...` | jscpd of Lane C files against each corpus, a directory or `<dir>@<commit>`; writes `docs/provenance/audit/<date>/`. What counts: the `scripts/similarity-audit.sh` header |
| `just hs-up` | starts the disposable Tuwunel test homeserver (`e2e/docker-compose.yaml`, `http://127.0.0.1:28008`) and waits until it is healthy |
| `just hs-down` | stops the test homeserver and deletes its data |
| `just e2e [args]` | Playwright in the Chromium from `CHROMIUM_PATH` against the dev server, which it starts when nothing listens on port 4200; run `just hs-up` first for specs that need the homeserver |
| `just e2e-slot <n> [options] <command>\|down` | runs the command with slot n's own homeserver (port 28100+n) and app port (4300+n); `--snapshot` tests a commit instead of the working tree, `--preview` its production build, `--rtc` adds the call service of the call specs. Options: the `scripts/e2e-slot.sh` header |
| `just e2e-suite [options] [specs] [-- <playwright options>]` | every spec file (or the given ones) of one commit, each in its own `e2e-slot --preview` snapshot run, spread over slots; one TSV row per spec. Options: the `scripts/e2e-suite.sh` header |
| `just agent-stack <n> up\|down\|status\|usage [options]` | a real MindRoom backend, with a stub model (no model is called) or a real one, against slot n's homeserver; the agent specs start it themselves (`e2e/helpers/agentStack.ts`). Options, ports, keys and exit codes: the `scripts/agent-stack/stack.py` docstring |
| `just script-tests` | tests of the e2e tooling, the notices generator, the bundle report and the iOS test fixture generators; the `justfile` comment lists the files and says why no upstream clone is needed |
| `just upstream-overlap [<upstream clone>] [--history]` | `scripts/upstream-overlap/check.py`: no run of 3+ shared lines or 30+ shared tokens with any upstream version, in every tracked file at HEAD or (`--history`) in every commit; prints a notice and passes without a clone |
| `just install-hooks <upstream clone> [<clone>...]` | installs the pre-push hook that checks each commit a push adds for upstream overlap; install again after the hook or the checker changes. Details: the `justfile` comment and the headers it names |
| `just check` | the full local check: `typecheck`, `strict`, `lint`, `test`, `script-tests`, `license-check`, `verify-ported`, `check-holes`, `identifier-renames`, `upstream-overlap`; it gives `verify-ported` and `upstream-overlap` no checkout or clone, so both print their notices. What CI runs: the `justfile` comment |
| `scripts/push-gate.sh <checkout> --slot <n> --corpus <upstream clone> [--rev <commit>] [--base <rev>]` | the checks the coordinator runs on a commit before every push: build, type, lint and unit checks, the overlap history, a key scan and 15 smoke specs; one summary table. Details: the script's header |

`docs/provenance/m1-baseline.txt` records the starting error counts for the M1 compile and the current `just typecheck-tests` total.

## Commits

- Unsigned (`git -c commit.gpgsign=false commit`), on a branch, delivered as a pull request; never push to `main`.
- No em dashes in docs, comments, or commit messages.
- Add files by explicit path; never `git add -A`.

## Pull requests

- A pull request that changes what people see carries screenshots of that change, taken at the pull request's head (a throwaway Playwright spec on a `just e2e-slot` slot, or the dev server). Attach them with `gh pr create --attach '<file>#<alt text>'` when opening it, or `gh pr comment <number> --body '<what they show>' --attach '<file>#<alt text>'` on an open one; repeat `--attach` for each image. Take them again after a change that alters what they show.
