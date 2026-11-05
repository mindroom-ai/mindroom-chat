# AGENTS.md

mindroom-client is an Apache-2.0 web client for MindRoom, built on `matrix-js-sdk` with its Rust crypto. It is a clean-room rebuild: files authored by Bas Nijholt are ported from MindRoom Chat, and everything else is written fresh without access to the upstream client or MindRoom Chat source.

## The two lanes

- **Lane P (ported):** files listed in `docs/provenance/portable.tsv` (first import), `docs/provenance/portable-wave2.tsv` (second import) and `docs/provenance/portable-wave3.tsv` (third import: binary assets, verified by blob hash), copied from MindRoom Chat `fc3a5905` at their original paths. Bas authored at least 95% of each text file's lines; every other line was blanked (`docs/provenance/holes.tsv`, `docs/provenance/holes-wave2.tsv`). `docs/provenance/import.txt` names each wave's import commit, one line per wave. Per Bas Nijholt's instruction of 2026-11-02, he licenses the lines he wrote in the files of both imports under Apache-2.0 for this project (`NOTICE`).
- **Dropped:** `docs/provenance/dropped.tsv` lists Lane P files deleted with a dropped feature. MindRoom Chat repository tooling and `FORK_CHANGES.md` were removed from every commit; `FORK_CHANGES.md` is not an input, and no session may read it from any copy.
- **No upstream code, in any commit:** `scripts/upstream-overlap/check.py` (`just upstream-overlap <upstream clone>`) must report 0 findings for every new commit before it is pushed (`--history` checks all of them). Only the orchestrator holds the upstream clone; other sessions may run the check on their own files when told the corpus path, and may never open the corpus.
- **Lane C (clean):** everything else, including the seams (modules that Lane P files import but that are not ported; `docs/provenance/seams.tsv`) and the app shell.

A file keeps its lane when it moves: the lists keep import-time paths, and `docs/provenance/moves.tsv` (old path, new path, batch; written by the move tool) maps each moved file to its current path. `node scripts/provenance-paths.cjs lane <path>` prints a file's lane.

`docs/provenance.md` describes both lanes, and every session that works in this repository logs itself there.

### Lane C rules

- **Lane C rules (spec section 2).** Never open, search, fetch, or install as source: the upstream client named in `docs/provenance.md` (its GitHub organization, any fork or mirror), MindRoom Chat (`mindroom-ai/mindroom-chat`, `/home/basnijholt/Work/dev/mindroom-chat`, `/tmp/chat-ref`, any other checkout), Element Web, Element X, Element Call, FluffyChat, Nheko, Fractal, NeoChat, SchildiChat, and `mindroom/docs/baspowers/`, `mindroom/docs/dev/`. `folds` may be installed and its published API docs and type definitions read.
- Allowed inputs: this repository (including Lane P files, but not `FORK_CHANGES.md`), `docs/provenance/seams.tsv`, `docs/design/reference/`, the Matrix specification, library documentation and type definitions, `/home/basnijholt/Work/dev/mindroom/docs/` (other pages) and `/home/basnijholt/Work/dev/mindroom/src/`.
- Lane C code must pass `just strict` (`tsconfig.strict.json`) and the type-aware ESLint rules that `just lint` applies to Lane C TypeScript.

### Lane P edit rules

- **Lane P files** (listed in `docs/provenance/portable.tsv`, `portable-wave2.tsv` and `portable-wave3.tsv`) may be edited only to: fill their blanked lines (`docs/provenance/holes.tsv`, `holes-wave2.tsv`), re-point an import, adapt a call to a Lane C interface, or delete code for dropped features (Simple Mode, Element Call, the filter bar's view buttons). Never rewrite their logic.
- Do not run Prettier or any other formatter over a Lane P file.
- **Seams:** a seam keeps its path (or the one `moves.tsv` gives it) and exports every name listed for it in `seams.tsv` with types that satisfy all Lane P call sites. Its implementation is new code. A seam may export more than listed when Lane C needs it.

## Licenses and product

- Licenses: dependencies must be MIT, Apache-2.0, BSD, ISC, 0BSD, Zlib, Unicode, CC0, BlueOak, OFL (fonts), or MPL-2.0 used unmodified. `scripts/license-check.mjs` also accepts Python-2.0 (argparse) and Unlicense, and three packages by name (`require-like`, `caniuse-lite`, `jsonify`); `NOTICE` lists them with the reasons. Never add `@element-hq/element-call-embedded`.
- Product: no app-wide Simple Mode. The thread filter bar has its own simple and advanced filters (simple by default, `simpleThreadFilters`) and no view buttons; the room header's filter button shows or hides it. The header's view switch toggles Compact and Threads; Classic is reached only through Jump to Time or a stored choice.

## Commands

Every command runs in `nix develop` (Node 24, npm, Chromium as `CHROMIUM_PATH`, Python 3, `just`). Outside it, use Node 24 or newer (`package.json` `engines`): some unit tests fail on Node 22.

| Recipe | What it does |
|---|---|
| `just install` | `npm ci` |
| `just typecheck` | `tsc --noEmit -p tsconfig.app.json`: the app sources under `src/` without tests; must report 0 errors |
| `just typecheck-tests` | `tsc --noEmit -p .`: everything, tests and `e2e/` included; reports its errors without failing |
| `just typecheck-all` | `scripts/typecheck-all.mjs`: syntax and semantic errors together over `tsconfig.json` |
| `just strict` | `scripts/strict-check.mjs`: `tsc` over `tsconfig.strict.json` (unused names, implicit returns, switch fallthrough, `override`, unchecked index access); fails on Lane C errors only and prints the count of Lane P errors it ignores |
| `just test [args]` | `vitest run`; DOM tests opt in with `// @vitest-environment jsdom` |
| `just lint` | ESLint over `src`, `e2e`, `scripts`, and the config files; Lane C TypeScript also gets type-aware rules (floating and misused promises, `await` of non-promises, exhaustive switches, needless assertions, enum comparisons) with the types of `tsconfig.strict.json`, takes `PopOut` and `TooltipProvider` from `src/app/components/directional` rather than `folds`, and writes styles with logical sides (`paddingInlineStart`, `insetInlineEnd`, `textAlign: 'start'`, no four-part `margin` or `padding`) so they mirror in right-to-left languages; a side that must stay physical takes a disable comment with its reason (safe-area insets are allowed) |
| `just format <paths>` | Prettier (2.8.8, matches the Lane P style) on Lane C files you wrote |
| `just dev` | Vite on `http://127.0.0.1:4200`; also serves `/runtime-config.js`, `/authentication-recovery.js` and a development `/sw.js` |
| `just build` | production build into `dist/`, with `runtime-config.js`, `authentication-recovery.js`, `version.json` and `sw.js` |
| `just license-check` | `scripts/license-check.mjs`: fails on any installed package outside the license allowlist; runs its `node --test` suite first |
| `just verify-ported [chat checkout]` | recomputes both Lane P import waves (`port_files.py --wave N --verify`); prints a notice and passes when no path is given |
| `just check-holes` | `scripts/check_holes.py`: each wave's Lane P files differ from the import only in their blanked lines, at the commit that filled them |
| `just similarity-audit <corpus dir>...` | jscpd (`--min-tokens 50`) of Lane C files (`src/`, `scripts/`, `e2e/`, root config; both portable lists minus `dropped.tsv` excluded) against each corpus; writes `docs/provenance/audit/<date>/` |
| `just hs-up` | starts the disposable Tuwunel test homeserver (`e2e/docker-compose.yaml`, `http://127.0.0.1:28008`) and waits until it is healthy |
| `just hs-down` | stops the test homeserver and deletes its data |
| `just e2e [args]` | Playwright in the Chromium from `CHROMIUM_PATH` against the dev server, which it starts when nothing listens on port 4200; run `just hs-up` first for specs that need the homeserver |
| `just e2e-slot <n> [--snapshot[=<rev>]] [--preview] [--rtc] <command>` | `scripts/e2e-slot.sh`: runs the command with slot n's own Tuwunel (port 28100+n) and app port (4300+n). `--snapshot` runs it in a clean copy of a commit (default HEAD) with an empty homeserver, so uncommitted edits in the checkout cannot break the run; `--preview` serves that commit's production build through `vite preview`; `--rtc` starts the slot's call service (`scripts/e2e-rtc.sh`) for the call specs, which skip without it |
| `just e2e-suite [--slots 25-28] [--out <tsv>] [specs] [-- <playwright options>]` | `scripts/e2e-suite.sh`: every spec file (or the given ones) of one commit in its own `--preview` snapshot run, spread over the slots (the call specs with `--rtc`), then one TSV row per spec (`scripts/e2e-results-tsv.mjs`); tests skipped for a missing service, fixture, account or setting have their own column, `skipped (no service)`, and the summary names their specs |
| `just agent-stack <n> up\|down\|status\|usage [--model stub\|real] [--calls <service URL> [--calls-profile realtime\|live]] [--checkout <dir>] [--ref <rev>]` | `scripts/agent-stack/stack.py`: a real MindRoom backend from a checkout (`--checkout`, else `$E2E_MINDROOM_CHECKOUT`, else `/home/basnijholt/Work/dev/mindroom`; at its `origin/main`, copied with `git archive`, never edited) with the stub model `scripts/agent-stack/stub_model.py` (no model is called) against slot n's homeserver; API on 29600+n, stub on 29700+n. `--model real` (or `E2E_AGENT_MODEL=real`) runs Claude Haiku 5.5 and GPT-6 Luna instead, scripted to give the stub's hashtags the same meaning; it takes `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from the environment only (source the key file into the command; set `E2E_AGENT_STACK_ROOT` to a private directory) and `usage` or `down` reports its model calls, tokens and price. `--calls <service URL>` (the slot's `scripts/e2e-rtc.sh` service) makes the helper answer voice calls with `gpt-realtime-2.1-mini` (`--calls-profile live`: `gpt-live-1`), with `OPENAI_API_KEY` from the environment, from an environment with MindRoom's `matrix_calls` extra; `usage` and `down` then also list each call's voice tokens, and `e2e/lane-c/agent-call.spec.ts` uses it. The `e2e/lane-c/agent-*.spec.ts` specs start it themselves and skip without a checkout or, for a real model, without keys; `e2e-slot <n> down` stops it |
| `just script-tests` | tests of the e2e tooling: `scripts/e2e-results-tsv.test.mjs` (Node's test runner), `scripts/test_matrix_http.py` and `scripts/reference/test_seed.py` (unittest) |
| `just upstream-overlap [<upstream clone>] [--history]` | `scripts/upstream-overlap/check.py`: no run of 3+ shared lines or 30+ shared tokens with any upstream version, in every tracked file at HEAD or (`--history`) in every commit; prints a notice and passes without a clone |
| `just check` | the full local check: `typecheck`, `strict`, `lint`, `test`, `script-tests`, `license-check`, `verify-ported`, `check-holes`, `upstream-overlap`; `just check` passes no checkout or clone, so `verify-ported` and `upstream-overlap` print their notices. CI (`.github/workflows/ci.yml`) runs `typecheck`, `strict`, `lint`, `test` and a smoke subset of the e2e specs on every push to main and every pull request |
| `scripts/push-gate.sh <checkout> --slot <n> --corpus <upstream clone> [--rev <commit>] [--base <rev>]` | the checks the coordinator runs before every push, all on the commit (default the checkout's HEAD) rather than the working tree: the production build, `typecheck`, `strict`, ESLint on the files `base...rev` changes, the unit suite (files that fail run once more, and only a second failure counts), `upstream-overlap --history` (only findings reachable from the commit fail), a scan of everything `base..rev` adds for the values of the key file `$PUSH_GATE_KEY_FILE` (default `/tmp/m2-keys/llm.env`; it prints names, never values), the old upstream name in commit messages, and 15 smoke specs through `just e2e-suite` on the slot (or slots, `46,47`); one summary table, exit 0 only when every check passes |

`docs/provenance/m1-baseline.txt` records the starting error counts for the M1 compile and the current `just typecheck-tests` total.

## Commits

- Unsigned (`git -c commit.gpgsign=false commit`), on branch `main`; never push.
- No em dashes in docs, comments, or commit messages.
- Add files by explicit path; never `git add -A`.
