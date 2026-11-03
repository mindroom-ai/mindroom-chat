# AGENTS.md

mindroom-client is an Apache-2.0 web client for MindRoom, built on `matrix-js-sdk` with its Rust crypto. It is a clean-room rebuild: files authored by Bas Nijholt are ported from MindRoom Chat, and everything else is written fresh without access to the upstream client or MindRoom Chat source.

## The two lanes

- **Lane P (ported):** files listed in `docs/provenance/portable.tsv`, copied from MindRoom Chat at their original paths. Bas authored at least 95% of each file's lines; every other line was blanked (`docs/provenance/holes.tsv`).
- **Lane C (clean):** everything else, including the seams (modules that Lane P files import but that are not ported; `docs/provenance/seams.tsv`) and the app shell.

`docs/provenance.md` describes both lanes, and every session that works in this repository logs itself there.

### Lane C rules

- **Lane C rules (spec section 2).** Never open, search, fetch, or install as source: the upstream client named in `docs/provenance.md` (its GitHub organization, any fork or mirror), MindRoom Chat (`mindroom-ai/mindroom-chat`, `/home/basnijholt/Work/dev/mindroom-chat`, `/tmp/chat-ref`, any other checkout), Element Web, Element X, Element Call, FluffyChat, Nheko, Fractal, NeoChat, SchildiChat, and `mindroom/docs/baspowers/`, `mindroom/docs/dev/`. `folds` may be installed and its published API docs and type definitions read.
- Allowed inputs: this repository (including Lane P files), `docs/provenance/seams.tsv`, `docs/design/reference/`, the Matrix specification, library documentation and type definitions, `/home/basnijholt/Work/dev/mindroom/docs/` (other pages) and `/home/basnijholt/Work/dev/mindroom/src/`.

### Lane P edit rules

- **Lane P files** (listed in `docs/provenance/portable.tsv`) may be edited only to: fill their blanked lines (`docs/provenance/holes.tsv`), re-point an import, adapt a call to a Lane C interface, or delete code for dropped features (thread filter bar, Simple Mode, Element Call). Never rewrite their logic.
- Do not run Prettier or any other formatter over a Lane P file.
- **Seams:** a seam keeps its path and exports every name listed for it in `seams.tsv` with types that satisfy all Lane P call sites. Its implementation is new code. A seam may export more than listed when Lane C needs it.

## Licenses and product

- Licenses: dependencies must be MIT, Apache-2.0, BSD, ISC, 0BSD, Zlib, Unicode, CC0, BlueOak, OFL (fonts), or MPL-2.0 used unmodified. Never add `@element-hq/element-call-embedded`.
- Product: no thread filter bar, no Simple Mode; the Compact and Full switch is an icon button in the room header.

## Commands

Every command runs in `nix develop` (Node 22, npm, Chromium as `CHROMIUM_PATH`, Python 3, `just`).

| Recipe | What it does |
|---|---|
| `just install` | `npm ci` |
| `just typecheck` | `tsc --noEmit -p .`; stops at the first syntax error, so blanked lines hide semantic errors |
| `just typecheck-all` | `scripts/typecheck-all.mjs`: syntax and semantic errors together |
| `just test [args]` | `vitest run`; DOM tests opt in with `// @vitest-environment jsdom` |
| `just lint` | ESLint over `src`, `e2e`, `scripts`, and the config files |
| `just format <paths>` | Prettier (2.8.8, matches the Lane P style) on Lane C files you wrote |
| `just dev` | Vite on `http://127.0.0.1:4200` |
| `just build` | production build into `dist/` |
| `just license-check` | `scripts/license-check.mjs`: fails on any installed package outside the license allowlist; runs its `node --test` suite first |
| `just verify-ported [chat checkout]` | recomputes the Lane P import (`port_files.py --verify`); prints a notice and passes when no path is given |
| `just similarity-audit <corpus dir>...` | jscpd (`--min-tokens 50`) of Lane C `src` files against each corpus; writes `docs/provenance/audit/<date>/` |
| `just check` | typecheck, lint, test, license-check, verify-ported |

`docs/provenance/m1-baseline.txt` records the starting error counts for the M1 compile.

## Commits

- Unsigned (`git -c commit.gpgsign=false commit`), on branch `build/core-chat`; never push.
- No em dashes in docs, comments, or commit messages.
- Add files by explicit path; never `git add -A`.
