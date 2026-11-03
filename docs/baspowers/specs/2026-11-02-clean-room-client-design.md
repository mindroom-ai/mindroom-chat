# MindRoom Client: Apache-2.0 Rebuild of MindRoom Chat

Date: 2026-11-02 (revised: option C)
Status: approved for implementation

## 1. Purpose

MindRoom Chat is a fork of the upstream client named in `docs/provenance.md` and is licensed AGPL-3.0, so organizations with a no-GPL policy cannot run it.
This project rebuilds it under Apache-2.0 so it looks and works like MindRoom Chat today.

What Bas decided:

- Keep the components Bas wrote himself as close to today's code as possible: liquid glass, the collapsible thread banner, the compact room view, tool calls, model badges, approvals, the command palette, canvas, computer, and the rest of `src/app/mindroom/`.
- Drop the thread filter bar and Simple Mode.
- Option C: React and `matrix-js-sdk` (both permissive), Bas's files ported nearly verbatim, everything the upstream client owns rebuilt clean.

Success criteria:

- Every file is either a ported file wholly authored by Bas (recorded in `docs/provenance/ported-files.tsv`) or new code written without access to the upstream client or MindRoom Chat source.
- No dependency under GPL, AGPL, LGPL, or SSPL. `@element-hq/element-call-embedded` (AGPL) is excluded; calls use LiveKit directly.
- The app matches the reference screenshots in `docs/design/reference/` and passes the ported tests.

## 2. Two provenance lanes

### Lane P: ported (Bas-authored)

- Source: `mindroom-ai/mindroom-chat` at a recorded commit (first import: `dev` at `fc3a5905`).
- A file qualifies only when `git blame -w -M -C -C` attributes every line to Bas Nijholt (`bas@nijho.lt`). Files with any other author's line do not qualify, whatever the share.
- Per Bas Nijholt's instruction of 2026-11-02, as sole author he licenses the qualifying files under Apache-2.0 for this project.
- `docs/provenance/ported-files.tsv` lists path, source commit, line count, and the blame command. `scripts/verify-ported.sh <chat checkout>` recomputes the blame for every listed file and fails when a file no longer qualifies.
- The orchestrator copies these files. Implementers may then change them only to re-point imports to Lane C modules, adapt to Lane C interfaces, and remove dead code for dropped features (filter bar, Simple Mode, Element Call). Each such change is a normal commit.
- Paths stay the same as in MindRoom Chat (`src/app/mindroom/**`, `src/app/components/glass/**`, and so on), so later changes Bas makes there can be ported again with the same tooling.

### Lane C: clean (everything else)

- Covers what the upstream client wrote or co-wrote: the app shell, client setup, sync, room list, room timeline, message rendering, composer, settings frame, auth pages, emoji and stickers, media viewers, members, spaces, and every module a ported file imports that is not itself ported (the seams).
- Implementers work from: this spec, the plans, `docs/design/reference/` screenshots, the seam inventory (`docs/provenance/seams.tsv`: module path, the names ported files import from it, and which files import it), the ported files themselves (to see how a seam is used), the Matrix specification, library documentation (React, `matrix-js-sdk`, folds, vanilla-extract, jotai, TanStack Query, React Router, Slate), and the MindRoom backend docs and source (`mindroom/docs/` except `docs/baspowers/` and `docs/dev/`, `mindroom/src/`).
- Forbidden: the upstream client (any repository, fork, mirror, or package source other than `folds` as an installed dependency), MindRoom Chat outside the files ported into this repository, Element Web, Element X, Element Call, FluffyChat, Nheko, Fractal, NeoChat, SchildiChat.
- A seam keeps the module path and the names the ported files import, so ported files compile unchanged where possible. Its implementation is new: behavior comes from the ported call sites, the screenshots, and the Matrix and library docs.
- The orchestrator (this session) is the dirty side. It ran the reference app, captured the screenshots, computed blame and the seam inventory, and copied Lane P files. It never read upstream-authored source.
- `scripts/similarity-audit.sh` compares Lane C files against the upstream client and MindRoom Chat before each release; the orchestrator runs it and keeps only the report. Lane P files are excluded from the comparison against MindRoom Chat.
- `docs/provenance.md` logs every session: date, agent, model, task, sources consulted.

## 3. Architecture

Same stack as MindRoom Chat, so ported files run unchanged: React 18.2, TypeScript 5.4, Vite 5.4, vanilla-extract, folds 2.7.1 (Apache-2.0), jotai 2, TanStack Query 5, React Router 6, Slate 0.123, i18next, `matrix-js-sdk` 41.7 with its Rust crypto (`@matrix-org/matrix-sdk-crypto-wasm`), Capacitor 8 for native shells later. Versions match MindRoom Chat `fc3a5905`; the M0 plan pins them.

```
mindroom-client/
  src/app/mindroom/**         Lane P (plus Lane C files where a module there is not ported)
  src/app/components/glass/** Lane P
  src/**                      Lane C: seams at the paths ported files import, plus the shell
  e2e/                        ported Playwright tests (Lane P) and new ones (Lane C), Tuwunel stack
  docs/provenance/            ported-files.tsv, seams.tsv, external.tsv, audit reports
  scripts/                    port-files.sh, verify-ported.sh, license-check.mjs, similarity-audit.sh
```

State management and component structure follow what the ported files expect: `matrix-js-sdk` `MatrixClient` in a React context, jotai atoms for UI state, TanStack Query for server reads. Lane C decides the internals of each seam.

## 4. Product decisions

- No thread filter bar and no Simple Mode. Advanced features (command palette) are always on.
- The room view has two modes, Compact (threads as equal-height bars, MindRoom Chat's compact room view) and Full (classic timeline). Without the filter bar, the switch is an icon button in the room header; the choice is remembered per room as today.
- Thread view: the thread replaces the room view in the main area, with the collapsible thread banner (tags, title, pin, resolve, options).
- Look: today's MindRoom Chat look in light and dark (Inter, folds tokens, liquid glass), per `docs/design/reference/`.
- Canvas and Computer panels, approvals, background jobs, schedules, voice, connections, and bug reports come over with the ported files and their seams.
- Calls: LiveKit client directly; no Element Call widget (later milestone).

## 5. MindRoom contracts

Unchanged event formats; the ported files implement them. Reference for Lane C, from the Apache-2.0 backend:

| Contract | Shape | Source |
|---|---|---|
| Stream status | `io.mindroom.stream_status`: `pending`, `streaming`, `approval_pending`, `completed`, `cancelled`, `interrupted`, `error`; in the edit's `m.new_content` and at the top level of the edit content | `constants.py`, `matrix/client_delivery.py`, `docs/streaming.md` |
| Tool trace | `io.mindroom.tool_trace`: `{version, events: [{type, tool_name, args_preview?, result_preview?, truncated?}], content_truncated?}` | `tool_system/events.py` |
| Run metadata | `io.mindroom.ai_run`: `{version, run_id, session_id, status, model: {config, display_name?, id?, provider?}, usage?}` | `ai_run_metadata.py` |
| Thread title | `m.notice` in the thread with `io.mindroom.thread_summary: {version, summary, generated_at, model, pinned}` | `thread_summary/state.py` |
| Thread tags | room state `com.mindroom.thread.tags`, state key `["<root>","<tag>"]`, content `{set_by, set_at, note?, data?}`; tag `resolved` | `thread_tags.py` |
| Tool approval | event type `io.mindroom.tool_approval`, content `{msgtype, body, tool_name, arguments, status, approval_id, approver_user_id, requester_id, requested_at, expires_at, thread_id, agent_name?}` | `approval/manager.py` |
| Canvas page API | `window.mindroom.submit`, `saveState`, `state`, `colorScheme`; `--mr-*` theme variables | `docs/canvases.md` |
| Computer | `/api/computers/*`, WebSocket, Matrix OpenID token | `docs/tools/worker-computer.md` |

## 6. Milestones

| Milestone | Content |
|---|---|
| M0 Foundations | Scaffold with pinned stack, lint and type check, license check, provenance scripts (port, verify, audit), Tuwunel test stack, Playwright harness, reference screenshots committed |
| M1 Port and compile | Copy Lane P files and their tests; implement every seam at least to its type signature so `tsc --noEmit` passes and the ported unit tests run; app boots to the login screen |
| M2 Core parity | Lane C shell: login (password and SSO), client start and sync, room list and sidebar (rooms, threads, recently opened), room header, Full timeline, message rendering, composer, members panel, settings frame; Compact view, thread view, tool calls, approvals working end to end; screenshots match the reference |
| M3 Full parity | Everything else MindRoom Chat users rely on: media, emoji and stickers, profiles, room settings, spaces, notifications, device verification and key backup, canvas, computer, voice, schedules, connections, bug reports |
| M4 Platforms and calls | Capacitor iOS and Android shells, push, LiveKit calls |

## 7. Testing

- Ported unit tests (Vitest) run as they do in MindRoom Chat once their seams exist.
- Ported Playwright tests run against the Tuwunel stack (`ghcr.io/mindroom-ai/mindroom-tuwunel`, Apache-2.0) where their selectors target ported components; Lane C writes its own end-to-end tests for shell behavior.
- Visual check per milestone: capture the same screens as `docs/design/reference/` and compare.
- `just check`: type check, lint, unit tests, license check, `verify-ported.sh`.

## 8. Licensing

- `LICENSE` Apache-2.0; `NOTICE` names Bas Nijholt as author of the ported files and lists third-party notices.
- `scripts/license-check.mjs` fails on GPL, AGPL, LGPL, SSPL, or unknown licenses in the installed tree. MPL-2.0 is allowed for unmodified dependency files (noVNC).

## 9. Risks

| Risk | Mitigation |
|---|---|
| A seam must reproduce a large upstream subsystem (timeline, editor) | Seams keep signatures, not internals; behavior from screenshots and ported call sites; one plan task per subsystem |
| A seam's signature copies upstream structure | Signatures are interfaces the ported code needs; each is recorded in `seams.tsv`; internals stay new |
| Ported files change upstream | Re-run `port-files.sh` and `verify-ported.sh` for a new commit |
| Training-data contamination in Lane C | Similarity audit before release |
