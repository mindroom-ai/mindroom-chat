# Architecture

MindRoom Chat is a single-page React app that talks to a Matrix homeserver through `matrix-js-sdk`, and to a MindRoom backend's HTTP API for the features that need one (agent computers, Connections, Local MindRoom pairing). This page covers how it starts, where the code lives and the rules for placing it, the two kinds of code in the repository, and how it reads the event formats MindRoom agents send.

## Stack

React 18.2, TypeScript 5.4 and Vite 5.4; vanilla-extract for styles (`*.css.ts`) and the folds component library; jotai for UI state, TanStack Query for server reads, React Router 6, Slate for the composer, i18next for translations; `matrix-js-sdk` 41.7 with its Rust crypto (`@matrix-org/matrix-sdk-crypto-wasm`); `livekit-client` for calls; Workbox for the service worker; Capacitor 8 for the iOS and Android shells. Versions are pinned in `package.json`, and `patches/` holds patch-package fixes to some of them (`matrix-js-sdk`, `folds`, `i18next` and others), applied by `npm ci`.

## How the app starts

1. `index.html` loads `runtime-config.js` (`src/boot/runtimeConfig.ts`: base path, service worker switch, sign-in recovery settings) and `authentication-recovery.js` (`src/boot/authenticationRecovery.ts`), then the module `src/index.tsx`.
2. `src/index.tsx` starts diagnostics, applies the stored theme, loads i18n, registers the service worker (`src/sw/sw.ts`, which serves the cached app shell, precaches only what a signed-in start needs (`scripts/precache-plan.mjs`), keeps the build's other files on first use (`src/sw/swRuntimeAssets.ts`) and the language catalogs with their overlays (`src/sw/swLanguageFiles.ts`), and fetches authenticated media) unless it is switched off, watches for parts that cannot load after a deployment (`src/app/config/appUpdate.ts`), and renders `App`, whose root error boundary (`AppErrorBoundary`) shows a failed screen with Reload.
3. `src/app/shell/App.tsx` sets up jotai, the theme and TanStack Query, loads `config.json` (`src/app/config/ClientConfigLoader.tsx`; see `docs/configuration.md`), and creates the router (`src/app/shell/Router.tsx`).
4. Sign-in pages live under `src/app/account/auth/`. Every signed-in route renders `ClientRoot` (`src/app/shell/ClientRoot.tsx`), which builds the active account's `MatrixClient` (`src/app/account/lifecycle/initMatrix.ts`: IndexedDB stores, Rust crypto, sync), shows the startup screen until the first sync, and then the shell with the icon rail.
5. Accounts are kept in a session registry (`src/app/matrix/session/sessions.ts`), each with its own stores, so several accounts can be signed in and switched.

## Layout

The code is grouped by feature: one folder per domain, which holds the screens, hooks, state and helpers of one concept. A file goes where someone looking for that concept would look first.

```
src/
  index.tsx, index.css   entry point (index.html loads it) and global CSS, with their tests
  boot/                  scripts built on their own and loaded before the app: runtimeConfig, authenticationRecovery,
                         serviceWorkerNavigation
  sw/                    the service worker (sw.ts) and its helpers: session, authenticated media, runtime assets,
                         language files, framing
  client-sdk/            the client SDK, what client plugins import (see client-plugins.md)
  types/                 ambient .d.ts files only
  test/                  Vitest setup, architecture.ts (import graph helpers for architecture tests), layering.test.ts,
                         mockPaths.test.ts (every relative vi.mock, vi.doMock and vi.importActual path names a file),
                         utils/ (shared test helpers)
  build/                 tests of build tooling and repository files (precache plan, icons, index.html, npm scripts)
  app/
    lib/                 helpers with no app knowledge (dom, keyboard, time, regex, storage, describeError, lazyPart);
                         hooks/ (generic React hooks, media/), state/ (jotai helpers)
    config/              config.json loader and provider, runtime config reader, app version, update check, service
                         worker registration
    i18n/                i18next setup, languages, English resources, overlay loader; locales/ (17 catalogs) and
                         locales/additions/ (overlay keys)
    theme/               theme bootstrap, useTheme, code token palette, page zoom, status bar colors
    preferences/         user settings (settings atom, useSetting), the settings catalog, account settings
    routes/              URL schema: paths, path helpers, search params, deep links, route restore, "is selected" hooks
    shortcuts/           shortcut registry, key labels, useShortcut, DOM helpers
    diagnostics/         flight recorder, deep trace, trace schema, timeline debug probes, SDK debug logging, export
    native/              Capacitor layer: platform checks, native sign-in, Cloudflare Access, file save, App Store scenes
    ui/                  the design system: dialogs, menus, tooltips, setting tiles, glass/, nav/, page/, panels/,
                         settings/ (settings page kit), sidebar/ (rail items), splash/, media/, particle-background/,
                         branding/, styles/
    matrix/              Matrix core: room and event helpers, media URLs, edits, permalinks, createRoom, cs-api;
                         client/ (client factory, sync policy, crypto store continuity, token refresh), session/
                         (stored sessions), hooks/, state/ (client-derived atoms), send/ (outgoing content),
                         protocol/ (MindRoom formats over Matrix), types/
    navigation/          moving the user around: room navigation, selected room and space, view mode, dialog atoms
    rich-text/           formatted text without message knowledge: sanitizing, math, links, tables, markdown/, code/
    avatars/             user and room avatars, authenticated avatar media, swatches
    event-store/         the client-side store of room and thread events: cache/ (IndexedDB cache, event repository,
                         probes), engine/ (sync engine, backfill, reconciler, prefetch), threads/ (thread model),
                         timeline/ (timeline model), sdk/ (the only adapters of matrix-js-sdk internals)
    models/              agent model picker, provider icons, model controller, agent device trust check
    ui-actions/          agent-driven UI actions (button, provider, controller)
    plugins/             client plugins the build lists: the registry, their config.json sections, message
                         renderers, side panels, pages (see client-plugins.md)
    server-admin/        the homeserver's local accounts, for its administrators: the list, an account's state and
                         rooms, lock, suspend and deactivate (Settings, Server accounts)
    computer/            the worker computer panel, screen, touchpad, clipboard, API, settings, agent servers
    emoji/               emoji data, recent emoji, skin tone; board/, custom/ packs, packs/ editor, server/, settings/
    editor/              the Slate editor of the composer and of message editing; autocomplete/
    approvals/           tool approval cards and controls, the approval provider, auto-approve/
    bug-reports/         in-app bug reports: payload, room, send, message menu item; error-reporting/
    calls/               MatrixRTC calls (panel, tiles, rings, state) and agent/ calls
    connections/         the agent service Connections portal and links
    background-jobs/     the agents' background jobs bar
    members/             member lists and drawer, power tags, user directory; invite/, profile/
    messages/            one message: Message, controls, extras, event readers, thread indicator; content/, html/,
                         agent-run/, reactions/, reply/, edit/, pins/, thread-summary/, canvas/, live/, viewers/
                         (image, PDF, text), url-preview/, layout/
    canvas/              agent canvases: panel, room canvas panel, index, state; page/ (the Canvases route)
    composer/            the room input: drafts, send session, extensions; commands/, upload/, voice/
    notifications/       unread title, chimes, read receipts and mark-read items; inbox/ (invites), notices/, push/ (iOS),
                         settings/
    schedules/           the scheduled tasks dialog and button
    search/              message search page, filters, results, highlighting
    subagents/           the Sub-agents side panel: a card per live sub-agent run, nested under the run that
                         started it
    rooms/               room management: cards, access control, leave prompt; create/, explore/ (route), join/,
                         settings/ (room settings pages), archive/
    threads/             thread features: overview/ (list, compact view, filters), open/ (session, bootstrap), tags/,
                         summary/, cross-room/ (index, signals), page/ (the Threads section's list), banner, actions menu
    account/             sign-in and the account: auth/, lifecycle/ (start, stop, wipe a session), switcher/,
                         settings/, devices/, encryption/, verification/, uia/, onboarding/
    activity/            the Activity bell: rows from thread signals and invites, inline answers, the popover, the
                         phone sheet and the Activity section's list
    spaces/              spaces: rail order, leave, add existing; lobby/, create/
    timeline/            the room and thread timeline: RoomTimeline, rows, scrolling, pagination, minimap, collapsing,
                         room intro, thread badge; typing/, jump-to-time/, message-rendering/
    command-palette/     the command palette
    local-mindroom/      pairing a Local MindRoom backend (Connect page, settings page, provisioning)
    room/                the open room screen: Room, RoomView, RoomViewHeader, header actions and menu, route, topic viewer,
                         tombstone
    settings/            the Settings dialog: frame, search, menu, deep link, rail buttons; pages/ (app-wide preferences)
    sidebar/             the left navigation: rail/, home/, direct/, space/, room-nav/, threads/ (recent threads)
    shell/               app composition: App, Router, client pages, ClientRoot, layout, startup features, welcome page,
                         sync status, error boundary, update notice; shortcuts/ (global handler, hints, help)
e2e/
  <domain>/              Playwright specs grouped by the same domain names; specs against the live homeserver that
                         take long end in .live.spec.ts
  fixtures/              pages that render one component (fixtures/live/: live seeding script and minimap fixture;
                         fixtures/sample-plugin/: a plugin directory of the agent stack)
  helpers/               shared helpers
  rtc/                   the MatrixRTC authorization service for the call specs
  env.ts, global-setup.ts, api.d.ts, docker-compose*.yaml   environment, setup, the Tuwunel test homeserver
```

Outside `src/` and `e2e/`:

| Path | What is there |
|---|---|
| `scripts/` | Vite plugins and build helpers, check scripts (`strict-check.mjs`, `license-check.mjs`), provenance tools, e2e tooling (`e2e-slot.sh`, `e2e-suite.sh`, `e2e-rtc.sh`, `agent-stack/`, `reference/seed.py`), release versions and tags (`calver.mjs`), iOS and App Store helpers |
| `public/` | Files served at the root as they are: icons, sounds, `manifest.json` |
| `ios/`, `android/` | The Capacitor native projects |
| `docs/` | This page, `configuration.md`, `development.md`, `deployment.md`, provenance records, design reference screenshots, the README screenshots (`screenshots/`), specs and plans |

Unit tests run in Vitest, in Node by default; DOM tests opt in with `// @vitest-environment jsdom`.

## Placement and naming

Where a file goes, first match wins:

1. **Domain.** A file goes to the domain of the screen or concept it serves. A file several domains use goes to the lowest domain all of them may import (see [Layers](#layers)), and its own imports must not climb above it. If a file would have to import a higher domain, move the shared part down; never move the import up.
2. **Component:** `<domain>/<Name>.tsx`, with its styles in `<Name>.css.ts` beside it. A sub-folder only for a sub-feature of three or more source files.
3. **Hook:** with its domain. A hook that only wraps React or the DOM goes in `lib/hooks/`, one that only reads Matrix data in `matrix/hooks/`.
4. **Atom:** with the domain that owns the state. Client-derived global state goes in `matrix/state/`, user preferences in `preferences/`, atoms that only open a dialog in `navigation/`.
5. **Pure helper:** domain logic in its domain, Matrix event logic in `matrix/`, `io.mindroom.*` content formats in `matrix/protocol/`, text formatting in `rich-text/`, helpers with no app knowledge in `lib/`.
6. **Tests:** `X.test.ts(x)` or `X.<aspect>.test.ts(x)` beside `X`; tests of several modules in `<domain>/__tests__/`; shared helpers in `src/test/`, one domain's helpers in its `__tests__/` or `test-utils/`; fixtures in `<domain>/__fixtures__/`.
7. **Settings pages:** a page about one domain's objects lives in that domain and is built from `ui/settings/`; pages for app-wide preferences live in `settings/pages/`.
8. **Route pages:** in the domain that owns the screen (`threads/page/`, `canvas/page/`, `rooms/explore/`, `activity/`, `account/auth/`, `room/RoomRoute.tsx`). `shell/Router.tsx` maps `routes/paths.ts` to the lazy modules of `shell/clientPages.tsx`; there is no `pages/` folder.
9. **e2e:** `e2e/<domain>/<name>.spec.ts`, and `<name>.live.spec.ts` for long specs against the live homeserver.

No barrel files: import a name from the module that declares it. The two `index.ts` files that stay, `event-store/engine/index.ts` and `event-store/cache/db/index.ts`, are the public surfaces of the sync engine and the cache database, which their architecture tests check. The client SDK (`src/client-sdk/`) is a third exception: its modules re-export the app for client plugins, and the app never imports the SDK.

Naming:

- Drop `Mindroom` and `MindRoom` where they only marked the code as ours rather than upstream (`room/Room.tsx`, `messages/Message.tsx`). Keep product and protocol names: Local MindRoom (`local-mindroom/`), the `MINDROOM_*` event constants, `isMindroomAgent*`, `io.mindroom.*`, storage keys, persisted IndexedDB names, the `window.__MINDROOM_*` globals that e2e specs read, and the i18n namespace `mindroomUi`.
- Name by content: `renderAgentMessageContent.tsx`, `agentCommandQuery.ts`, `prefetchSettings.ts`.
- A component file is named after its export (PascalCase), a hook `useX.ts`, everything else camelCase. A file and its main export are renamed together.
- No two modules in one folder whose names differ only in case: the iOS app is built on a case-insensitive file system.

## Layers

A domain imports only domains in a strictly lower layer. Runtime, type-only and dynamic imports all count; tests are exempt; inside a domain, sub-folders import each other freely.

| layer | domains |
|---|---|
| 0 | `lib`, `src/boot`, `src/types` |
| 1 | `config`, `i18n`, `preferences`, `routes`, `shortcuts`, `src/sw` |
| 2 | `diagnostics`, `native`, `ui` |
| 3 | `matrix`, `theme` |
| 4 | `avatars`, `models`, `navigation`, `plugins`, `rich-text`, `server-admin`, `ui-actions` |
| 5 | `computer`, `emoji`, `event-store` |
| 6 | `approvals`, `bug-reports`, `calls`, `connections`, `editor` |
| 7 | `background-jobs`, `members`, `messages` |
| 8 | `canvas`, `composer`, `notifications`, `schedules`, `search`, `subagents` |
| 9 | `rooms`, `threads` |
| 10 | `account`, `activity`, `spaces`, `timeline` |
| 11 | `command-palette`, `local-mindroom`, `room` |
| 12 | `settings` |
| 13 | `sidebar` |
| 14 | `shell` |
| 15 | `src/index.tsx`, `src/client-sdk` |

`just lint` enforces it: `.eslintrc.cjs` builds `import/no-restricted-paths` zones from the `LAYERS` list, and every violation names its domain and layer and points here. The resolver setting beside it lets the rule see extensionless TypeScript imports; without it the rule would skip them silently. `src/test/layering.test.ts` lints probe imports under made-up paths and fails when the zones go silent, when a folder of `src/app` has no layer, or when a zone names a folder that does not exist. A new domain needs a place in `LAYERS`.

Limits:

- Inline type imports (`typeof import('...')`) are not checked by the rule. The one cross-domain use, `shell/Router.tsx` to `room/Room`, points downward.
- File-level cycles are checked separately: `threads/__tests__/featureOwnership.architecture.test.ts` requires the runtime import graph of `src/app` to be acyclic, apart from one listed cycle, `emoji/emojiData.ts` and `emoji/emoji.ts` (a lazy `import()` and the handover of the emoji tables back). Remove the allowance when that handshake goes.

## Client plugins

A build can add code from outside this repository: `MINDROOM_CLIENT_PLUGINS` names plugin directories, each with its own installed `node_modules` and a `package.json` that declares the plugin ([`configuration.md`](configuration.md#build-time-variables)).
A plugin imports the app only through the client SDK (`src/client-sdk/`, `@mindroom/client-sdk/<subpath>`), and its entry's default export, a `ClientPlugin`, lists what it adds to the app (`src/app/plugins/`).
[`client-plugins.md`](client-plugins.md) describes the plugin API.

## Two lanes of code

Every file belongs to one of two lanes. [`docs/provenance.md`](provenance.md) records how each came to be, and [`AGENTS.md`](../AGENTS.md) holds the rules for editing them.

- **Lane P (ported).** Files written by Bas Nijholt for the earlier MindRoom client and licensed under Apache-2.0 for this project. They are listed at the paths they were imported at in `docs/provenance/portable.tsv` (code), `portable-wave2.tsv` (other text files: native shells, locales, scripts) and `portable-wave3.tsv` (binary assets); `dropped.tsv` lists the ones deleted during the rewrite.
- **Lane C (clean).** Everything else, written new for this repository: the app shell, client setup and sync, room list, timeline, composer editor, settings, sign-in pages, and the seams. Lane C must pass `just strict` and the type-aware ESLint rules of `just lint`.
- **Seams.** Modules that Lane P files import but that were not ported, with an implementation of their own. `docs/provenance/seams.tsv` lists each one's import-time path and the names Lane P imported from it, and `seams-dropped.tsv` the ones deleted or merged during the rewrite. A seam may move, be renamed or be merged like other Lane C code; the Lane P imports of it are re-pointed with it. When a Lane P test and a seam disagree, the seam changes.

`docs/provenance/moves.tsv` (old path, new path, batch) maps the files moved during the rewrite to their paths then, and `scripts/provenance-paths.cjs` folds it for the tools that sort files by lane (`strict-check.mjs`, the ESLint config, `similarity-audit.sh`, `check_holes.py`). These records are no longer kept up to date, so a Lane P file moved after the rewrite is Lane C to these tools: `just strict` and `just lint` hold it to Lane C's rules. To see which lane the tools give a file:

```bash
node scripts/provenance-paths.cjs lane src/app/matrix/protocol/toolTrace.ts src/app/config/useClientConfig.ts
node scripts/provenance-paths.cjs lane-p        # every Lane P file, at its path after the rewrite
```

`just check` enforces the split: `check-holes` proves each Lane P file differed from its import only in its blanked lines at the commit that filled them, `verify-ported` recomputes the import from a source checkout.

## MindRoom event formats

The MindRoom backend defines the formats its agents send, and the client reads them unchanged. The parsing and rendering are mostly Lane P code. The Lane C side supplies Matrix data and hands events over: the room view seams (`src/app/room/Room.tsx`, `src/app/timeline/RoomTimeline.tsx`), the message row seam (`src/app/timeline/message-rendering/useTimelineMessageFeature.tsx`), and `src/app/messages/content/RenderMessageContent.tsx`, which passes each message to `renderAgentMessageContent.tsx` first, unless a client plugin's renderer takes it ([Client plugins](client-plugins.md#message-renderers)). Section 5 of `docs/baspowers/specs/2026-11-02-clean-room-client-design.md` gives the backend source for each format.

| Format | Shape | Read in (under `src/app/`) |
|---|---|---|
| Stream status | `io.mindroom.stream_status` (`pending`, `streaming`, `approval_pending`, `completed`, `cancelled`, `interrupted`, `error`) at the top of the reply's edits and in their `m.new_content` | `matrix/protocol/aiRun.ts`, `event-store/threads/useThreadStreamingState.ts`; a card streams only for a reply seen through /sync since its room's last gap or confirmed by the server (`matrix/client/streamingReplies.ts`; a thread list read confirms the replies it lists, and a room's checks wait for it, except while the read waits to ask for a failed page again: `event-store/threads/threadListRetry.ts`) |
| Live reply frames | `io.mindroom.live` ephemeral events that carry a reply while it streams, where the homeserver relays them | `messages/live/` |
| Sub-agent runs | `io.mindroom.subagents` ephemeral events from the agent account answering the turn that delegated, in its room, where the homeserver relays them: `{v, run, sid, seq, meta, snapshot \| delta}`, a live reply frame's documents (the run's transcript) for the delegation `run`, with `meta` `{agent, caller, root, parent, thread_id, source, status, started_at, ended_at}` (seconds), plus `task` and an ended run's `result` on snapshots; a snapshot at least every 10 s while the run works, none while it is paused (`messages/live/__fixtures__/subagent-frames-v1.json`) | `matrix/protocol/subagentFrame.ts`, `messages/live/subagentRunStore.ts`; shown by `subagents/`, opened from the room header and the jobs bar |
| Tool trace | `io.mindroom.tool_trace`: `{version, events: [{type, tool_name, args_preview?, result_preview?, truncated?}], content_truncated?}` | `matrix/protocol/toolTrace.ts`, rendered by `messages/html/HtmlBlocks.tsx` |
| Run metadata | `io.mindroom.ai_run`: `{version, run_id, session_id, status, model, usage?}` | `matrix/protocol/aiRun.ts`, `event-store/threads/threadConversationCost.ts`; shown by `messages/MessageControls.tsx` |
| Thread title | an `m.notice` in the thread with `io.mindroom.thread_summary: {version, summary, generated_at, model, pinned}` | `matrix/protocol/threadSummary.ts`, `event-store/threads/threadSummaryTimeline.ts` |
| Conversation notice | an `m.notice` outside a thread with `io.mindroom.conversation: true` in its content and in the `m.new_content` of its edits, such as a card or a report that starts a conversation; the thread lists show it before anyone replies when a MindRoom agent on the active account's homeserver sent it, while any other notice but a call's row lists only once its thread has replies, and until then leaves a room with a MindRoom agent read | `matrix/protocol/conversationNotice.ts`, used by `event-store/threads/compactThreadRootData.ts` and `matrix/mainTimelineRead.ts` |
| Thread tags | room state `com.mindroom.thread.tags`, state key `["<root event ID>","<tag>"]`, content `{set_by, set_at, note?, data?}`; the tag `resolved` marks a resolved thread and the tag `snoozed` (`data: {until}`, an ISO time) a snoozed one while `until` is in the future, both lifecycle state rather than tag pills; `set_by` counts when the sender is that person or a MindRoom agent on the active account's homeserver, and a tag from anyone else names its sender | `event-store/threads/threadTags.ts`, `event-store/threads/threadSnooze.ts`, `threads/tags/useMutateThreadTags.ts`, `threads/tags/useRoomThreadTags.ts` |
| Snooze ended | the backend's thread message when a snooze's `until` passes: body `⏰ Snooze ended` or `⏰ Snooze ended: <note>`, with `io.mindroom.thread_snooze: {event: "ended", until}`; from a MindRoom agent on the active account's homeserver it renders as a marker row in an open thread and as a marker body elsewhere | `matrix/protocol/threadSnooze.ts`, `messages/SnoozeEndedMarker.tsx`, `timeline/message-rendering/useTimelineMessageFeature.tsx` |
| Tool approval | event `io.mindroom.tool_approval` (`tool_name`, `arguments`, `status`, `approval_id`, `expires_at`, ...), answered with `io.mindroom.tool_approval_response` | `matrix/protocol/toolApproval.ts`, `approvals/approvalActions.ts`, `approvals/ToolApprovalCard.tsx` |
| Canvas page API | pages get `window.mindroom.submit`, `saveState`, `state` and `colorScheme`, and the `--mr-*` theme variables, in a sandboxed `srcdoc` frame with its own content security policy | `messages/canvas/canvasDocument.ts` |
| Computer | `/api/computers/*` on the MindRoom backend, a WebSocket for the screen, authorized with a Matrix OpenID token | `computer/api.ts` |
| MindRoom server | room state `io.mindroom.server`, keyed by each agent's user ID: `{api_origin, computer, role}`; `role` is what the agent does, shown under its name in the member lists and on its card, and runtimes that predate it leave it out | `computer/agentServer.ts`, `computer/useAgentServers.ts`, `computer/useRoomMindroomServer.ts`, `members/useAgentRoles.ts` |
| Client sessions | `POST /api/client-sessions` with a Matrix OpenID token bound to the server's origin for `{session_token, expires_at}`, sent as bearer to call transcripts and plugin routes and offered by websockets as `mindroom-session.<token>`; `DELETE /api/client-sessions` at sign-out | `computer/clientSessions.ts` |
| Call transcription | `/api/call-transcripts/v1/*` on the room's MindRoom server (the one its agents published while the homeserver binds OpenID tokens to it and the deployment trusts it, else the deployment's; never this device's choice of server for computers) with a client session from a Matrix OpenID token; the router's call row, a notice with `io.mindroom.call: {call_id}` that it edits when the call ends (`ended_at`, `duration_seconds`) and again once the transcript message is posted (`transcript_event_id`); the transcript message in the row's thread, the notes as its body with `io.mindroom.call_transcript` and `io.mindroom.call_notes: {call_id}` | `calls/transcription/` (`api.ts`, `CallRow.tsx`), `matrix/protocol/callRow.ts`, `messages/content/CallTranscriptCard.tsx` |
| UI actions | `io.mindroom.ui_action` in an agent's message: show the computer or a canvas, open a panel or a Settings section | `matrix/protocol/chatUiProtocol.ts` |

A room's MindRoom server, the one call transcripts and plugin routes use (`computer/useRoomMindroomServer.ts`), is the deployment's `mindroom.computers.apiUrl` unless the room's agents publish an origin the deployment trusts: `apiUrl` itself, or one on `mindroom.computers.trustedApiUrls` (`trustedServerOrigins` in `computer/agentServer.ts`). Published state alone vouches for nothing: the client reads `io.mindroom.server` from any account on the viewer's homeserver whose name starts with `mindroom_`, under that account's own user ID, and rooms made in the client let every member write it, so an account of another deployment, or one a person registers, could otherwise name its own server and receive the requests meant for the room's. The servers offered outside a room (`useAgentServerUrls`) follow the same list. Without either key, as in a client for any deployment, every published origin counts, since nothing else names that deployment's server, and the console says so once; the sign-in token is still bound to the origin it is requested for. Each agent's own computer server stays the one it published, a claim only about itself.

Agents are recognized by their Matrix user ID (`mindroom_` localpart prefix, `matrix/protocol/agentIdentity.ts`). Other MindRoom data the client reads: `io.mindroom.settings` account data (`preferences/accountSettings.ts`), the router's `io.mindroom.auto_approve` room state (`approvals/auto-approve/`), and each agent's `io.mindroom.background_jobs` room state (`background-jobs/`).

The client's own account data: `io.mindroom.spaces` holds the rail's folders and saved space order (`src/app/spaces/sidebarSpaces.ts`), and `io.mindroom.room_order` the rooms a person dragged into their own order, per Rooms section: `{"lists": {"home": [<room ID>, ...], <space ID>: [...]}}`, where `home` is Home's section and a space's room ID is that space's (`src/app/sidebar/room-nav/roomOrder.ts`). A section without a list shows its rooms A to Z; rooms the list does not name follow the ones it does, A to Z, and Sort Rooms A to Z in the section's options menu deletes its list. `io.mindroom.client.settings` holds the app settings that follow the account, under their names in the device's `settings` entry: `{"version": 1, "isMarkdown": false, "hour24Clock": true, ...}` (`src/app/preferences/roamingSettings.ts`; the binding, with the edits not sent yet, is `src/app/matrix/hooks/useBindRoamingSettings.ts`).

Sub-rooms follow the backend's rule for rooms listed under a room: a chat room lists a room with `m.space.child` (non-empty `via`), and the listed room names it back as its canonical `m.space.parent`; MindRoom's agents in the chat room join such a room and leave it when it is taken off the list. The parent map (`matrix/state/roomToParents.ts`) records a joined room, other than a Space, as a sub-room only while both links hold, and a listed room the user has not joined on the listing alone, as it records the Spaces' children, so a sub-room counts as part of the Spaces above its room. Home and a Space show each sub-room under its room, and the rooms the chat room lists that the user has not joined, which open their preview to join (`sidebar/room-nav/SubRoomRows.tsx`). The room menu's New Sub-room (`rooms/create/CreateSubRoomDialog.tsx`) makes a `restricted` room that only the chat room's members may join, and Remove from takes a sub-room off its chat room's list (an empty `m.space.child`) and leaves the sub-room's own link, which the agents read to leave it. A room upgrade (`rooms/settings/general/moveSpaceLinks.ts`) lists the old room's children in the new room and moves the link of each sub-room the account may change to the new room, and such a `restricted` sub-room that admitted the old room's members admits the new room's too; the room settings name the sub-rooms that did not come along.

Two tests pin formats to what the backend actually sends: `src/app/messages/backendApprovalContract.test.ts` reads approval events captured from the backend (`src/app/messages/__fixtures__/backendApprovalContract.json`), and `src/app/messages/__fixtures__/backendToolMarkerBodies.json` holds the backend's own HTML for tool markers, written by `scripts/capture-backend-tool-marker-bodies.py`. The backend's `docs/streaming.md`, `docs/canvases.md` and `docs/tools/worker-computer.md` describe the formats in prose.
