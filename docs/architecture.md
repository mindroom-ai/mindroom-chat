# Architecture

MindRoom Client is a single-page React app that talks to a Matrix homeserver through `matrix-js-sdk`, and to a MindRoom backend's HTTP API for the features that need one (agent computers, Connections, Local MindRoom pairing). This page covers how it starts, where the code lives, the two kinds of code in the repository, and how it reads the event formats MindRoom agents send.

## Stack

React 18.2, TypeScript 5.4 and Vite 5.4; vanilla-extract for styles (`*.css.ts`) and the folds component library; jotai for UI state, TanStack Query for server reads, React Router 6, Slate for the composer, i18next for translations; `matrix-js-sdk` 41.7 with its Rust crypto (`@matrix-org/matrix-sdk-crypto-wasm`); `livekit-client` for calls; Workbox for the service worker; Capacitor 8 for the iOS and Android shells. Versions are pinned in `package.json`, and `patches/` holds patch-package fixes to some of them (`matrix-js-sdk`, `folds`, `i18next` and others), applied by `npm ci`.

## How the app starts

1. `index.html` loads `runtime-config.js` (`src/runtimeConfig.ts`: base path, service worker switch, sign-in recovery settings) and `authentication-recovery.js` (`src/authenticationRecovery.ts`), then the module `src/index.tsx`.
2. `src/index.tsx` starts diagnostics, applies the stored theme, loads i18n, registers the service worker (`src/sw.ts`, which serves the cached app shell, precaches only what a signed-in start needs (`scripts/precache-plan.mjs`), keeps the build's other files on first use (`src/swRuntimeAssets.ts`) and the language catalogs with their overlays (`src/swLanguageFiles.ts`), and fetches authenticated media) unless it is switched off, watches for parts that cannot load after a deployment (`src/appUpdate.ts`), and renders `App`, whose root error boundary (`AppErrorBoundary`) shows a failed screen with Reload.
3. `src/app/pages/App.tsx` sets up jotai, the theme and TanStack Query, loads `config.json` (`src/app/components/ClientConfigLoader.tsx`; see `docs/configuration.md`), and creates the router (`src/app/pages/Router.tsx`).
4. Sign-in pages live under `src/app/pages/auth/`. Every signed-in route renders `ClientRoot` (`src/app/pages/client/ClientRoot.tsx`), which builds the active account's `MatrixClient` (`src/client/initMatrix.ts`: IndexedDB stores, Rust crypto, sync), shows the startup screen until the first sync, and then the shell with the icon rail.
5. Accounts are kept in a session registry (`src/app/state/sessions.ts`), each with its own stores, so several accounts can be signed in and switched.

## Folders

| Path | What is there |
|---|---|
| `src/index.tsx`, `src/runtimeConfig.ts`, `src/authenticationRecovery.ts`, `src/sw*.ts`, `src/appVersion.ts`, `src/appUpdate.ts` | Entry point, deployment bootstrap, service worker, check for new deployments, the reload into a new one |
| `src/client/` | Creating, starting and signing out the Matrix client; access token refresh |
| `src/app/pages/` | Router, sign-in pages (`auth/`), and the signed-in pages (`client/`: home, direct messages, threads, explore, inbox, spaces, canvases, connections) |
| `src/app/features/` | Larger screens: the room (header, timeline, composer, members), room navigation, settings, room and space settings, creating rooms and spaces, calls |
| `src/app/components/` | Shared UI: the Slate editor, message rendering, media viewers, emoji board, liquid glass surfaces (`glass/`), dialogs, avatars |
| `src/app/mindroom/` | MindRoom features: agent messages (streaming, tool calls, approvals, thread titles), threads and the Compact view, live reply frames, canvases, computers, voice, schedules, background jobs, Connections, Local MindRoom, command palette, notifications, native app glue, diagnostics |
| `src/app/hooks/`, `src/app/state/` | React hooks and jotai atoms (sessions, settings, room and room list state) |
| `src/app/utils/`, `src/app/plugins/` | Helpers: Matrix event and room helpers, HTML sanitizing, Markdown, emoji data, math, code highlighting, `matrix.to` links |
| `src/app/styles/`, `src/app/theme/` | Shared vanilla-extract styles and the light and dark theme bootstrap |
| `src/app/locales/` | Translation catalogs for 17 languages; `additions/` holds overlay keys per language |
| `e2e/` | Playwright specs: the top level and `live/` (most need a homeserver), `lane-c/` (specs written for this repository), `fixtures/` (pages that render one component), `helpers/`, `rtc/` (MatrixRTC authorization service for the call specs), and `docker-compose.yaml` (the Tuwunel test homeserver) |
| `scripts/` | Vite plugins and build helpers, check scripts (`strict-check.mjs`, `license-check.mjs`), provenance tools, e2e tooling (`e2e-slot.sh`, `e2e-suite.sh`, `e2e-rtc.sh`, `agent-stack/`, `reference/seed.py`), iOS and App Store helpers |
| `public/` | Files served at the root as they are: icons, sounds, `manifest.json` |
| `ios/`, `android/` | The Capacitor native projects |
| `docs/` | This page, `configuration.md`, provenance records, design reference screenshots, specs and plans |

Unit tests sit next to the code they test (`*.test.ts`, `*.test.tsx`, `__tests__/`) and run in Vitest, in Node by default; DOM tests opt in with `// @vitest-environment jsdom`.

## Two lanes of code

Every file belongs to one of two lanes. [`docs/provenance.md`](provenance.md) records how each came to be, and [`AGENTS.md`](../AGENTS.md) holds the rules for editing them.

- **Lane P (ported).** Files written by Bas Nijholt for the earlier MindRoom client, copied at their original paths and licensed under Apache-2.0 for this project. They are listed in `docs/provenance/portable.tsv` (code), `portable-wave2.tsv` (other text files: native shells, locales, scripts) and `portable-wave3.tsv` (binary assets); `dropped.tsv` lists the ones deleted since with a dropped feature. Most of `src/app/mindroom/` is Lane P. Lane P files change only in the ways `AGENTS.md` allows (fill blanked lines, re-point an import, adapt to a Lane C interface, delete dropped features), never run through a formatter.
- **Lane C (clean).** Everything else, written new for this repository: the app shell, client setup and sync, room list, timeline, composer editor, settings, sign-in pages, and the seams. Lane C must pass `just strict` and the type-aware ESLint rules of `just lint`.
- **Seams.** Modules that Lane P files import but that were not ported. `docs/provenance/seams.tsv` lists each one's path and the names Lane P imports from it. A seam keeps that path and those exports, with an implementation of its own; when a Lane P test and a seam disagree, the seam changes.

To see which lane a file is in:

```bash
cut -f1 docs/provenance/portable*.tsv | grep -qxF src/app/mindroom/messages/toolTrace.ts && echo "Lane P" || echo "Lane C"
cut -f1 docs/provenance/seams.tsv | grep -qxF src/app/hooks/useClientConfig.ts && echo "seam"
```

`just check` enforces the split: `check-holes` proves each Lane P file differed from its import only in its blanked lines at the commit that filled them, `verify-ported` recomputes the import from a source checkout, and the overlap check described in `docs/provenance.md` runs over new code.

## MindRoom event formats

The MindRoom backend defines the formats its agents send, and the client reads them unchanged. The parsing and rendering are Lane P code under `src/app/mindroom/`. The Lane C side supplies Matrix data and hands events over: the room view seams (`src/app/mindroom/threads/MindroomRoom.tsx`, `MindroomRoomTimeline.tsx`), the message row seam (`src/app/mindroom/threads/message-rendering/useTimelineMessageFeature.tsx`), and `src/app/components/RenderMessageContent.tsx`, which passes each message to `renderMindroomMessageContent` first. Section 5 of `docs/baspowers/specs/2026-11-02-clean-room-client-design.md` gives the backend source for each format.

| Format | Shape | Read in (under `src/app/mindroom/`) |
|---|---|---|
| Stream status | `io.mindroom.stream_status` (`pending`, `streaming`, `approval_pending`, `completed`, `cancelled`, `interrupted`, `error`) at the top of the reply's edits and in their `m.new_content` | `messages/aiRun.ts`, `threads/useThreadStreamingState.ts` |
| Live reply frames | `io.mindroom.live` ephemeral events that carry a reply while it streams, where the homeserver relays them | `live/` |
| Tool trace | `io.mindroom.tool_trace`: `{version, events: [{type, tool_name, args_preview?, result_preview?, truncated?}], content_truncated?}` | `messages/toolTrace.ts`, rendered by `messages/MindroomHtmlBlocks.tsx` |
| Run metadata | `io.mindroom.ai_run`: `{version, run_id, session_id, status, model, usage?}` | `messages/aiRun.ts`, `threads/threadConversationCost.ts`; shown by `messages/MindroomMessageControls.tsx` |
| Thread title | an `m.notice` in the thread with `io.mindroom.thread_summary: {version, summary, generated_at, model, pinned}` | `messages/threadSummary.ts`, `threads/threadSummaryTimeline.ts` |
| Thread tags | room state `com.mindroom.thread.tags`, state key `["<root event ID>","<tag>"]`, content `{set_by, set_at, note?, data?}`; the tag `resolved` marks a resolved thread | `threads/threadTags.ts`, `threads/useMutateThreadTags.ts`, `threads/useRoomThreadTags.ts` |
| Tool approval | event `io.mindroom.tool_approval` (`tool_name`, `arguments`, `status`, `approval_id`, `expires_at`, ...), answered with `io.mindroom.tool_approval_response` | `messages/toolApproval.ts`, `messages/approvalActions.ts`, `messages/MindroomToolApprovalCard.tsx` |
| Canvas page API | pages get `window.mindroom.submit`, `saveState`, `state` and `colorScheme`, and the `--mr-*` theme variables, in a sandboxed `srcdoc` frame with its own content security policy | `canvas/canvasDocument.ts` |
| Computer | `/api/computers/*` on the MindRoom backend, a WebSocket for the screen, authorized with a Matrix OpenID token | `computer/api.ts` |
| MindRoom server | room state `io.mindroom.server`, keyed by each agent's user ID: `{api_origin, computer}` | `server/mindroomServer.ts`, `server/useMindroomServers.ts` |
| UI actions | `io.mindroom.ui_action` in an agent's message: show the computer or a canvas, open a panel or a Settings section | `ui-actions/chatUiProtocol.ts` |

Agents are recognized by their Matrix user ID (`mindroom_` localpart prefix, `matrix/agentIdentity.ts`). Other MindRoom data the client reads: `io.mindroom.settings` account data (`settings/mindroomAccountSettings.ts`), the router's `io.mindroom.auto_approve` room state (`auto-approve/`), and each agent's `io.mindroom.background_jobs` room state (`background-jobs/`).

Two tests pin formats to what the backend actually sends: `messages/backendApprovalContract.test.ts` reads approval events captured from the backend (`messages/__fixtures__/backendApprovalContract.json`), and `messages/__fixtures__/backendToolMarkerBodies.json` holds the backend's own HTML for tool markers, written by `scripts/capture-backend-tool-marker-bodies.py`. The backend's `docs/streaming.md`, `docs/canvases.md` and `docs/tools/worker-computer.md` describe the formats in prose.
