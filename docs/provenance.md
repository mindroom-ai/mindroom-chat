# Provenance

This repository has two kinds of code. The spec (`docs/baspowers/specs/2026-11-02-clean-room-client-design.md`, section 2) defines them.

## Lane P: files ported from MindRoom Chat

- Source: `mindroom-ai/mindroom-chat` at `fc3a5905` (`dev`, 2026-11-02), imported in two waves.
- Selection: `git blame -w -M -C -C` attributes at least 95% of the file's lines to Bas Nijholt (`bas@nijho.lt`). Every line attributed to anyone else was blanked when copied and listed in the wave's hole file (path, line). Lane C rewrites the blanked lines.
- Wave 1: `docs/provenance/portable.tsv` (path, Bas lines, blanked lines): 1581 files, 329,229 Bas lines, 655 blanked lines in `docs/provenance/holes.tsv`. The TypeScript code and tests under `src/` and `e2e/`.
- Wave 2: `docs/provenance/portable-wave2.tsv`, same columns: 192 files, 93,171 Bas lines, 4 blanked lines in `docs/provenance/holes-wave2.tsv`. The other files Bas wrote: the native shells (`ios/`, `android/`), `patches/`, locales, test fixtures and traces, `public/` assets, `scripts/`, `serve.py`, the Docker entrypoint, and repository tooling.
- `docs/provenance/import.txt` has one line per wave: the import commit in this repository, then the source (`mindroom-chat fc3a5905`).
- Grant: per Bas Nijholt's instruction of 2026-11-02, as the author of the lines in the files of both waves he licenses them under the Apache License 2.0 for this project. `NOTICE` records this.
- Tool: `scripts/port_files.py <chat checkout> <commit> [--wave N]` performs an import; `--verify` recomputes it and compares it with that wave's import commit. `scripts/verify-ported.sh <chat checkout>` (`just verify-ported`) runs the verification for every wave in `import.txt`.
- Holes: `scripts/check_holes.py --wave N --rev <commit>` (`just check-holes`) checks that each wave's files differ from the import only in their blanked lines, at the commit that filled them (`f824c82` for wave 1, `2717365` for wave 2).
- Dropped: `docs/provenance/dropped.tsv` (path, wave, reason) lists the Lane P files deleted because their feature is not part of this client (Element Call, the room-level thread filter bar, Simple Mode) or because they are MindRoom Chat repository tooling (`.envrc`, `.github/`, `.claude/`, `.agents/skills`, `.gitattributes` with its merge driver, the release-tag and merge-driver scripts, the test of the release workflow). `FORK_CHANGES.md` (wave 2) was deleted (a repository-wide grep by the F4 implementer printed about 15 of its lines, all mentions of tooling file names; see the session log for other sessions that read it): it describes MindRoom Chat internals that were not ported, and Lane C must not read it. Dropped files stay in the portable lists as imported: `check_holes.py` skips them, `verify-ported.sh` still verifies them (it reads the import commit, not the working tree), and the similarity audit counts them in neither lane.

## Lane C: clean code

Everything else. Written without access to Cinny or MindRoom Chat source beyond the Lane P files in this repository. Inputs are listed in the spec, section 2.

Supporting inventories, computed by the orchestrator from blame and imports only:

- `docs/provenance/seams.tsv`: modules that Lane P files import but that are not ported (path in MindRoom Chat, number of importing files, Bas share of the original, imported names). Lane C implements them at the same paths. Rows that came from strings which only look like imports (fixtures of the import-parser tests, a comment, and two modules the e2e specs load inside the page) were removed on 2026-11-03.
- `docs/provenance/seams-dropped.tsv`: the same columns plus a reason, for seams (or single names of a seam) intentionally not built because their feature was dropped; their Lane P importers were deleted or no longer import them.
- `docs/provenance/external.tsv`: npm packages imported by Lane P files, with import counts.

`scripts/similarity-audit.sh <corpus dir>...` compares Lane C with each corpus: Lane P is both portable lists minus `dropped.tsv`; Lane C is every other file, tracked or untracked but not ignored, under `src/`, `scripts/` and `e2e/`, plus the root config files. Only the orchestrator runs it against Cinny and MindRoom Chat, and only its report (paths and line ranges) is kept.

## What the orchestrator saw

The orchestrating session (Claude Opus 5.5, 2026-11-02) ran MindRoom Chat `fc3a5905` locally and captured `docs/design/reference/`; computed blame and import graphs over MindRoom Chat; read MindRoom Chat repository metadata (license, package manifest, path names, settings labels in the running app); and read the MindRoom backend docs and source (Apache-2.0). It never opened a Cinny-authored source file.

## Session log

| Date | Session | Model | Task | Sources consulted |
|---|---|---|---|---|
| 2026-11-02 | orchestrator | Claude Opus 5.5 | spec, inventories, Lane P import, reference screenshots | as above |
| 2026-11-02 | Task 2 implementer | Claude Sonnet 5.5 | license check, verify-ported, similarity-audit scripts | this repository, `node_modules` package manifests; no MindRoom Chat or Cinny source |
| 2026-11-02 | Task 3b implementer | Claude Opus 5.5 | filled the blanked Lane P lines (619 written fresh, 36 separator lines left empty), `scripts/check_holes.py`, placeholder `src/app/locales/en.json` | this repository (Lane P files, `seams.tsv`), `node_modules` type definitions (matrix-js-sdk, folds, focus-trap, vite); no MindRoom Chat or Cinny source |
| 2026-11-03 | Task 13d implementer | Claude Sonnet 5.5 | English i18n overlay `src/app/locales/additions/en.json`, `src/app/englishResources.ts`, locale copy in `vite.config.js` | this repository, `i18n-add-task-*.json`, vite and i18next type definitions; no MindRoom Chat or Cinny source |
| 2026-11-03 | Task 13b implementer | Claude Opus 5.5 | deleted Simple Mode, the room-level thread filter bar and Element Call leftovers; `dropped.tsv`, `seams-dropped.tsv`, `check_holes.py` skip | this repository (Lane P files, `seams.tsv`, `docs/design/reference/`), `node_modules` type definitions; no MindRoom Chat or Cinny source |
| 2026-11-03 | Task 13a implementer | Claude Opus 5.5 | build and dev-server fixes, signed-in discovery info, unread selector loop, `e2e/lane-c/boot.spec.ts`, e2e specs re-pointed from the filter bar to the header switch, `docs/design/m1-screenshots/` | this repository (Lane P files, `docs/design/reference/`), `scripts/reference/seed.py`, vanilla-extract, jotai, Playwright and matrix-js-sdk type definitions and sources in `node_modules`; no MindRoom Chat or Cinny source |
| 2026-11-03 | Final fix F3 implementer | Claude Opus 5.5 | login well-known origin check, room and space routes that follow joins, space path after a join, live theme, register policy, safe route decoding, `historical` power level removed | this repository (Lane P files, `seams.tsv`), matrix-js-sdk, react-router and jotai type definitions and sources in `node_modules`; no MindRoom Chat or Cinny source |
| 2026-11-03 | Final fix F4 implementer | Claude Opus 5.5 | dropped MindRoom Chat repository tooling (wave 2), both waves in `NOTICE`, this page and `AGENTS.md`, `verify-ported.sh` and `similarity-audit.sh` over both waves, Vite build assets (`runtime-config.js`, `authentication-recovery.js`, `version.json`, build version constants, dev `/sw.js`), media token path check, `blurhash` package, `tsconfig.app.json` type gate | this repository (Lane P files, `docs/provenance/`), `node_modules` package manifests, license files and type definitions (blurhash, @novnc/novnc, @fontsource/inter, vite, esbuild); `FORK_CHANGES.md` was deleted unopened (a repository-wide grep for tool file names listed about 15 of its lines, all mentions of tooling file names); no MindRoom Chat or Cinny source |
| 2026-11-03 | Final fix F1 implementer | Claude Opus 5.5 | dismissible unsupported-auth dialog in device verification setup; deleted unused editor toolbar, room and emoticon autocompletes, command element helper, page hero parts, `FileHeader`, unused styles and data attributes; shared `getRoomIconSrc` and avatar style; octet-stream attachment saves, blob-only PDF viewer, secret field autocomplete; join dialog focus trap, image Enter key, menu roles, thumbnail load keying | this repository (Lane P files and tests, `seams.tsv`), focus-trap, focus-trap-react, vanilla-extract and matrix-js-sdk type definitions and sources in `node_modules`; no MindRoom Chat or Cinny source |
| 2026-11-03 | Final fix F2 implementer | Claude Opus 5.5 | composer named `RoomInput` with the placeholder as its accessible name; Enter sends after an `@` query that matches nobody; approval cards in the timeline and in pins get their room and thread; Signal codec override on the recorder's send path; Copy Text with Tool Calls, loading copy label, model badge on collapsed rows; thread events end with `thread.events`; encrypted rows repaint on edits; inline Markdown nesting cap and one fence pairing per parse; localStorage atoms read on creation | this repository (Lane P files and tests, `seams.tsv`), matrix-js-sdk, slate-react and jotai type definitions and sources in `node_modules`; no MindRoom Chat or Cinny source |
| 2026-11-02 | Task 1 implementer | Claude Sonnet 5.5 | scaffold: package.json, tsconfig, Vite, Vitest, ESLint, flake, justfile, AGENTS.md, NOTICE | this repository, library documentation; no MindRoom Chat or Cinny source |
| 2026-11-02 | Task 3 implementer | Claude Sonnet 5.5 | Tuwunel compose stack, Playwright config, e2e global setup | this repository (ported e2e helpers), Tuwunel generated config; no MindRoom Chat or Cinny source |
| 2026-11-03 | Tasks 4 to 12 implementers (9 parallel sessions) and their fix rounds | Claude Opus 5.5 | all seams in docs/provenance/seams.tsv: foundation, state, hooks, components (two parts), pages and features, plugins, MindRoom threads and messages, remaining MindRoom modules | this repository (Lane P files and tests, seams.tsv, docs/design/reference/), MindRoom backend docs and source (Apache-2.0), node_modules type definitions; no MindRoom Chat or Cinny source |
| 2026-11-03 | dependencies chore | Claude Sonnet 5.5 | installed missing packages and patch-package, filled the wave 2 en.json blanks, check_holes waves | this repository, npm registry metadata; no MindRoom Chat or Cinny source |
| 2026-11-03 | orchestrator | Claude Opus 5.5 | wave 2 (non-code text files) and wave 3 (binary assets) imports; strict blame over MindRoom Chat fc3a5905; similarity audits | MindRoom Chat repository metadata and blame (as above); ran the audit tool over a Cinny v4.12.8 checkout and MindRoom Chat without reading their sources |
| 2026-11-03 | Task 13c implementer | Claude Opus 5.5 | join and knock awaits, listener removal, Delete and Pin permissions, sync policy constants, glass ESLint rule, iOS package scripts, media auth header scope | this repository; it read FORK_CHANGES.md (Lane P at the time, since dropped) to learn which checks the non-ported App Store preflight performed, and implemented only the version guard |
| 2026-11-03 | task reviewers, re-reviewers, final reviewers | Claude Sonnet 5.5 and Claude Opus 5.5 | read-only review of every task, fix round and the whole branch | this repository and review packages; the Task 13c reviewer and the final reviewer of tooling and provenance read parts of FORK_CHANGES.md before it was dropped; no MindRoom Chat or Cinny source |
| 2026-11-03 | types pin and Signal fix | Claude Sonnet 5.5, Claude Haiku 5.5 | pinned @types/react 18.2.39 and @types/react-dom 18.2.17; Signal voice override audio/aac | this repository; no MindRoom Chat or Cinny source |
| 2026-11-03 | audit rewriters R1 to R5 and one follow-up | Claude Opus 5.5, Claude Sonnet 5.5 | rewrote 135 Lane C spans the similarity audit flagged (given file and line ranges only, never the matched code) | this repository, library documentation; no MindRoom Chat, Cinny or audit report contents |
| 2026-11-03 | credit change | Claude Sonnet 5.5 | removed the Cinny credit from the UI at Bas's request; Bas-directed edit to Lane P authUi.ts (also branding.ts, their tests, the App Store description, NOTICE) | this repository; no MindRoom Chat or Cinny source |

## Similarity audit

`scripts/similarity-audit.sh` (jscpd 4, at least 50 tokens) compares Lane C files with a Cinny `v4.12.8` checkout and MindRoom Chat `fc3a5905`. Reports keep paths and line ranges only, no code.

| Run | Cinny clones | MindRoom Chat clones | Report |
|---|---|---|---|
| before rewrite | 52 (694 lines) | 129 (1842 lines) | `docs/provenance/audit/2026-11-03-before-rewrite/` |
| after rewrite | 0 | 16 (182 lines) | `docs/provenance/audit/2026-11-03/` |

None of the 135 flagged spans before the rewrite was explained by a Lane P file in this repository, so all were rewritten from their file and line ranges alone. After the rewrite, 15 of the 16 MindRoom Chat clones are new Lane C tests that mirror the setup of ported Lane P tests present in this repository (the matched MindRoom Chat files are Lane P here), and the last one is the dependency list in `package.json` (package names and versions).
