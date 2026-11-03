# M0 + M1: Foundations, Port, and Compile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development, because Lane C needs implementers whose inputs are only this repository and the allowed sources, and the plan is long.

**Goal:** The ported MindRoom Chat files (Lane P, already in the repository) type-check, their unit tests run, every seam they import exists as new code (Lane C), and the app boots to the login screen and signs in against the Tuwunel test stack.

**Architecture:** Same stack and paths as MindRoom Chat at `fc3a5905`. Lane P files keep their paths; each seam in `docs/provenance/seams.tsv` is written fresh at its path, exporting the names listed there, with behavior inferred from how Lane P files use it.

**Tech Stack:** React 18.2, TypeScript 5.4.2, Vite 5.4, `@vitejs/plugin-react`, `@vanilla-extract/css` 1.9.3, `@vanilla-extract/vite-plugin` 3.7.1, folds 2.7.1, jotai 2.6, TanStack Query 5.24, React Router 6.30, Slate 0.123, i18next 23, `matrix-js-sdk` 41.7.0, Vitest 2.1.8, Playwright 1.58.2. Exact versions for every package a Lane P file imports: `docs/provenance/external.tsv`.

**Spec:** `docs/baspowers/specs/2026-11-02-clean-room-client-design.md` (sections 2, 3, 4, 7, 8 bind every task). Look: `docs/design/reference/`.

## Global Constraints

- **Lane C rules (spec section 2).** Never open, search, fetch, or install as source: the upstream client named in `docs/provenance.md` (its GitHub organization, any fork or mirror), MindRoom Chat (`mindroom-ai/mindroom-chat`, `/home/basnijholt/Work/dev/mindroom-chat`, `/tmp/chat-ref`, any other checkout), Element Web, Element X, Element Call, FluffyChat, Nheko, Fractal, NeoChat, SchildiChat, and `mindroom/docs/baspowers/`, `mindroom/docs/dev/`. `folds` may be installed and its published API docs and type definitions read.
- Allowed inputs: this repository (including Lane P files), `docs/provenance/seams.tsv`, `docs/design/reference/`, the Matrix specification, library documentation and type definitions, `/home/basnijholt/Work/dev/mindroom/docs/` (other pages) and `/home/basnijholt/Work/dev/mindroom/src/`.
- **Lane P files** (listed in `docs/provenance/portable.tsv`) may be edited only to: fill their blanked lines (`docs/provenance/holes.tsv`), re-point an import, adapt a call to a Lane C interface, or delete code for dropped features (thread filter bar, Simple Mode, Element Call). Never rewrite their logic.
- **Seams:** a seam keeps its path and exports every name listed for it in `seams.tsv` with types that satisfy all Lane P call sites. Its implementation is new code. A seam may export more than listed when Lane C needs it.
- Licenses: dependencies must be MIT, Apache-2.0, BSD, ISC, 0BSD, Zlib, Unicode, CC0, BlueOak, OFL (fonts), or MPL-2.0 used unmodified. Never add `@element-hq/element-call-embedded`.
- Product: no thread filter bar, no Simple Mode; the Compact and Full switch is an icon button in the room header.
- Commits: unsigned (`git -c commit.gpgsign=false commit`), on branch `build/core-chat`; never push. No em dashes in docs, comments, or commit messages.
- Every command runs in `nix develop` once Task 1 lands.

## Review Focus

1. A seam whose signature satisfies `tsc` but whose behavior contradicts its Lane P callers (for example a hook that never updates): ported unit tests that import the seam must pass, not only compile. Each seam task runs them.
2. A blanked line filled with something that compiles but changes the file's logic: hole fills are reviewed line by line against the surrounding code.
3. Lane C code that reproduces upstream internals from memory: reviewers flag code whose structure is not explained by the Lane P call sites, the screenshots, or the Matrix spec; the orchestrator's similarity audit catches the rest.
4. A dependency pulled in with a copyleft license through a transitive path: the license check runs on the installed tree in every task that changes `package.json`.
5. Session storage written by the seams in a format the ported session code does not read back (sign-in lost on reload): Task 13's end-to-end test reloads and stays signed in.

---

### Task 1: Scaffold, toolchain, and repository rules

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.js` (Lane P tests import this path), `vitest.config.ts`, `index.html`, `.eslintrc.cjs` or `eslint.config.js`, `.prettierrc`, `flake.nix`, `flake.lock`, `justfile`, `.gitignore`, `AGENTS.md`, `CLAUDE.md` (symlink to `AGENTS.md`), `NOTICE`
- Modify: `README.md`

**Interfaces:**
- Produces: `nix develop` with Node 22, npm, Chromium (`CHROMIUM_PATH`), Python 3, `just`. Recipes: `just install` (`npm ci`), `just typecheck` (`tsc --noEmit -p .`), `just test` (`vitest run`), `just lint`, `just dev` (Vite on port 4200), `just build`, `just check` (typecheck, lint, test, license-check, verify-ported). `docs/provenance/m1-baseline.txt` records the first `tsc` error count and the count per error code.

- [ ] **Step 1:** `package.json` dependencies: every package in `docs/provenance/external.tsv` at the version given there (skip `(transitive)` rows and Node built-ins); dev dependencies: TypeScript 5.4.2, Vite 5.4.x, `@vitejs/plugin-react`, `@vanilla-extract/vite-plugin` 3.7.1, Vitest 2.1.8, jsdom, `@testing-library/react`, `fake-indexeddb`, ESLint, Prettier, `@playwright/test` 1.58.2. Run `npm install`, commit the lock file.
- [ ] **Step 2:** `tsconfig.json` (strict, `jsx: react-jsx`, `moduleResolution: bundler`, `include: ["src", "e2e", "vite.config.js", "vitest.config.ts", "playwright.config.ts"]`, `allowJs: true`), `vite.config.js` (React and vanilla-extract plugins; Rust crypto wasm served as an asset), `vitest.config.ts` (jsdom environment, `src/**/*.test.{ts,tsx}`; a setup file only if Lane P tests need globals).
- [ ] **Step 3:** `AGENTS.md`: purpose (two sentences), the two lanes with the Lane C rules copied verbatim from Global Constraints, the Lane P edit rules, the `just` recipes, commit rules. `NOTICE`: copyright 2026 MindRoom; ported files authored by Bas Nijholt (see `docs/provenance.md`); third-party notices heading.
- [ ] **Step 4:** Run `just install && just typecheck`. Expected: many errors (missing seams). Write `docs/provenance/m1-baseline.txt` with the total and the per-code counts (`grep -o 'error TS[0-9]*' | sort | uniq -c`).
- [ ] **Step 5: Commit** `chore: scaffold with MindRoom Chat's stack`.

### Task 2: License check and provenance checks in `just check`

**Files:**
- Create: `scripts/license-check.mjs`, `scripts/license-check.test.mjs`, `scripts/similarity-audit.sh`, `scripts/verify-ported.sh`
- Modify: `justfile`

**Interfaces:**
- Produces: `node scripts/license-check.mjs [node_modules]` exits 1 and prints `name@version license` for every installed package whose license is not on the allowlist from Global Constraints (SPDX `OR` expressions pass when one side is allowed) or that has none; `scripts/verify-ported.sh <chat checkout>` runs `python3 scripts/port_files.py <checkout> fc3a5905 --verify` (it is skipped with a notice when no checkout path is given, so `just check` works without one); `scripts/similarity-audit.sh <corpus dir>...` runs `npx jscpd@4 --min-tokens 50` on Lane C files (every tracked `src/**` file not in `portable.tsv`) against each corpus and writes `docs/provenance/audit/<date>/`.

- [ ] **Step 1: Write failing test** `license-check.test.mjs` (`node --test`): a temp `node_modules` with `MIT`, `GPL-3.0-only`, `(MIT OR GPL-3.0)`, `LGPL-2.1`, and an unlicensed package; assert exit 1, output names `GPL-3.0-only`, `LGPL-2.1`, and the unlicensed package, and not the others.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the three scripts; wire `license-check` and `verify-ported` into `just check`.
- [ ] **Step 4:** Run the test and `node scripts/license-check.mjs node_modules`. Expected: test passes; the real tree passes or lists offenders. Remove or replace each offender with a permissive equivalent and note it in the commit body.
- [ ] **Step 5: Commit** `chore: license allowlist and provenance checks`.

### Task 3: Tuwunel test stack and Playwright harness

**Files:**
- Create: `e2e/docker-compose.yaml` (only if no ported compose file exists), `playwright.config.ts`
- Modify: ported e2e helpers only as Lane P rules allow

**Interfaces:**
- Produces: `just hs-up` / `just hs-down` (Tuwunel `ghcr.io/mindroom-ai/mindroom-tuwunel:latest`, server name `matrix.localhost`, port `127.0.0.1:28008`, open registration, `TUWUNEL_WELL_KNOWN__CLIENT=http://127.0.0.1:28008`); `just e2e [spec]` runs Playwright with Chromium at `CHROMIUM_PATH` against `just dev`. The config reads whatever environment variables the ported e2e helpers in `e2e/` expect (read them to find out).

- [ ] **Step 1:** Read the ported e2e helpers, list the environment variables and fixtures they need, and write the config and compose file to provide them.
- [ ] **Step 2:** `just hs-up`, then `curl -s http://127.0.0.1:28008/_matrix/client/versions`. Expected: JSON listing `org.matrix.simplified_msc3575`.
- [ ] **Step 3:** `just e2e --list`. Expected: Playwright lists the ported specs without configuration errors (they will fail to run until later tasks).
- [ ] **Step 4: Commit** `test(e2e): Tuwunel stack and Playwright config`.

### Tasks 4 to 12: Seams

Each seam task owns the rows of `docs/provenance/seams.tsv` whose path starts with the given prefixes, plus the blanked lines (`holes.tsv`) in Lane P files under the same prefixes. Shared rules for every seam task:

- For each owned seam: find every Lane P importer (`grep -rl "<module path without extension>" src e2e`), read how it uses each imported name, then write the module so all those uses type-check and behave as the callers expect. Use `matrix-js-sdk`, folds, jotai, TanStack Query, React Router, Slate, and i18next as the callers do. UI seams match `docs/design/reference/`.
- A seam that needs another task's seam imports it at its `seams.tsv` path; if that module does not exist yet, create it with the listed exports and a body that throws `new Error("not implemented: <path>#<name>")`, and list it in the report. The owning task replaces the body.
- Fill each owned hole so the file compiles and reads naturally; never change the surrounding Lane P lines except as the Lane P rules allow.
- Verification for every seam task:
  - `just typecheck 2>&1 | grep -E "<owned prefixes>"` reports no `TS2307` (cannot find module), `TS2305`, or `TS2724` (missing export) errors for owned modules.
  - `npx vitest run $(grep -rl -E "<owned module paths>" src --include='*.test.ts' --include='*.test.tsx')` passes, except tests that fail only because a module owned by a later task still throws "not implemented"; list those in the report with the missing module.
  - Report the total `tsc` error count before and after.
- **Commit** once per task: `feat(seams): <area>`.

| Task | Owned prefixes | Notes |
|---|---|---|
| 4 | `src/types/`, `src/app/utils/`, `src/app/cs-api.ts`, `src/app/cs-errorcode.ts`, `src/colors.css.ts`, `src/app/styles/`, `src/index.css`, `src/client/`, `src/sw.ts`, `public/`, `scripts/` | Foundation types and helpers; `colors.css.ts` defines the light and dark palettes from the reference screenshots on top of folds tokens; icons come from `@tabler/icons-react` or folds, never copied assets |
| 5 | `src/app/state/` | Session storage (`sessions.ts`: read and write the format the Lane P session code expects), settings atom, room drafts, other jotai state |
| 6 | `src/app/hooks/` | Client, config, screen size, async callbacks, room and timeline hooks |
| 7 | `src/app/components/` rows 1 to 35 by importer count | Shared UI components on folds |
| 8 | `src/app/components/` remaining rows | Same |
| 9 | `src/app/pages/`, `src/app/features/`, `src/app/locales/`, `src/app/i18n*`, `src/index.tsx` | Routes and path helpers, settings pages, feature screens Lane P imports; `en.json` holds only strings Lane P and Lane C use, written fresh; `src/index.tsx` becomes the app entry |
| 10 | `src/app/plugins/` | Markdown, emoji, link handling, call plugin minus Element Call |
| 11 | `src/app/mindroom/threads/`, `src/app/mindroom/messages/` | Mixed MindRoom modules not ported; the largest Lane C task |
| 12 | every other `src/app/mindroom/` row, and any `seams.tsv` row no earlier task owns | Remaining MindRoom modules |

### Task 13: Boot, sign in, and drop removed features

**Files:**
- Modify: entry and shell modules from Tasks 9 to 12 as needed; Lane P files only to delete dropped-feature code
- Create: `e2e/lane-c/boot.spec.ts`

**Interfaces:**
- Consumes: all seams.
- Produces: `just dev` serves the app; the login screen matches `docs/design/reference/` login styling; password login against the test homeserver works; the signed-in home shows the sidebar sections of `home.png`. Thread filter bar, Simple Mode setting, and Element Call code and tests are deleted (every Lane P file whose only purpose is one of them, and their references).

- [ ] **Step 1: Write failing end-to-end test** `boot.spec.ts`: register a user through the client-server API, sign in through the UI with the server field set to `http://127.0.0.1:28008`, expect the sidebar with a "Rooms" section; reload and expect to stay signed in.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Fix whatever stands between the current state and the test passing; delete the dropped features.
- [ ] **Step 4:** Run `just check` and `just e2e e2e/lane-c/boot.spec.ts`. Expected: `tsc` reports 0 errors; Vitest passes except tests listed in the report with a reason; the boot test passes.
- [ ] **Step 5: Commit** `feat: boot and sign in; remove filter bar, Simple Mode, Element Call`.

### Task 14: Orchestrator wrap-up (not for an implementer)

- [ ] **Step 1:** `scripts/verify-ported.sh /tmp/chat-ref`; `scripts/similarity-audit.sh` against the upstream client `v4.12.8` and MindRoom Chat `fc3a5905` (Lane C files only); rewrite through a Lane C task anything above a trivial idiom.
- [ ] **Step 2:** Log every session in `docs/provenance.md`.
- [ ] **Step 3:** Push, open the pull request to `main`, request review, merge after approval. Then write the M2 plan (core parity, visual match, ported end-to-end tests).
