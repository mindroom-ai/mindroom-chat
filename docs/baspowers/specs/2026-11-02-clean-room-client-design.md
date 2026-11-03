# MindRoom Client: Clean-Room Matrix Client on matrix-rust-sdk

Date: 2026-11-02
Status: approved for implementation (milestones M0 and M1)

## 1. Purpose

MindRoom Chat, the current client for MindRoom agents, is a fork of the upstream client named in `docs/provenance.md` and is licensed AGPL-3.0.
Organizations with a no-GPL policy cannot run it.
This project builds a new client under Apache-2.0 that offers the same MindRoom experience, written without access to the upstream client or MindRoom Chat source code.

What Bas said:

- Build a clean-room implementation based on the Matrix Rust SDK.
- Choose the technology (JavaScript, Rust, SolidJS, React, Svelte, or something else).
- Make a plan and start implementing now.

Assumptions:

- The first users are organizations that forbid GPL code (Apple is the motivating case). They need a web client and later Apple platforms.
- "Works identically" means the MindRoom workflows behave the same: chatting with agents in rooms and threads, streamed replies, tool-call markers, stop, approvals, and so on. Pixel-identical copies of the upstream client's interface are neither needed nor wanted.
- The license is Apache-2.0, the same as MindRoom core, because it carries a patent grant.

Success criteria:

- Every line in this repository is original or comes from a dependency with a permissive license (MIT, Apache-2.0, BSD, ISC, MPL-2.0 at file level).
- A provenance record (see section 3) and a similarity audit back the clean-room claim.
- At M1, a user can log in to a MindRoom homeserver, see the rooms, read and send messages in rooms and threads, and watch an agent reply stream in, end to end encrypted where the room is.

## 2. Scope and decomposition

The full MindRoom Chat feature set is too large for one spec. It splits into milestones, and each gets its own plan:

| Milestone | Content |
|---|---|
| M0 Foundations | Repository, clean-room rules, Nix toolchain, Rust core compiled to wasm, SolidJS shell, test harness, local Tuwunel test homeserver, license and similarity audit scripts |
| M1 Core chat | Password login with `.well-known` discovery, session restore, sync, room list, room timeline, thread timelines, sending text (Markdown), back pagination, edits applied in place (this is how MindRoom streams), `io.mindroom.stream_status`, tool-call markers shown as text, E2EE through the SDK defaults |
| M2 MindRoom UX | Tool-trace details, interactive questions, tool approval, thread summaries as titles, `!` command autocomplete, model picker, the 🛑 stop reaction, live reply frames (needs a Tuwunel sliding-sync extension) |
| M3 Account and security | SSO (OIDC), recovery key and cross-signing verification, devices, media upload and authenticated media download, notifications |
| M4 Platforms | Desktop and mobile shells (Tauri 2), push notifications |
| M5 Advanced | Canvases, Computers panel (noVNC, MPL-2.0), calls through LiveKit, Connections portal, settings |

This document designs the whole architecture and specifies M0 and M1 in detail.

## 3. Clean-room rules

These rules bind every person and agent that writes code in this repository.

Forbidden sources (never open, search, fetch, or paste from them):

- the upstream client named in `docs/provenance.md` (its repository, any fork or mirror), MindRoom Chat (`mindroom-ai/mindroom-chat`, the `mindroom-chat` submodule or any checkout of it), and the `folds` design system.
- Other copyleft Matrix clients and SDK users: Element Web, Element X (iOS, Android), Element Call, FluffyChat, Nheko, Fractal, NeoChat, SchildiChat.

Allowed sources:

- The Matrix specification and MSC documents.
- `matrix-rust-sdk` source, docs, and examples (Apache-2.0), and `ruma` (MIT).
- MindRoom backend documentation in `mindroom/docs/` and the MindRoom backend source (Apache-2.0, owned by Bas). These define the `io.mindroom.*` event formats.
- Documentation of the libraries we use (SolidJS, Vite, wasm-bindgen, Playwright, Tauri).
- The Robrix (MIT) and iamb (Apache-2.0) clients, for how they use `matrix-rust-sdk`. Do not copy their code without keeping their license notice.
- This spec and the implementation plans.

Process:

- The orchestrating session writes specs and plans from behavior and from the MindRoom backend documentation. It has seen repository metadata of MindRoom Chat (license, authorship statistics, dependency list, directory names, a test-stack Docker Compose file written by Bas), never its source files.
- Implementing agents receive only the spec, the plan, and this repository.
- Agent transcripts are kept (Claude Code stores them under `~/.claude/projects/`). `docs/provenance.md` records each implementation session: date, agent, model, task.
- Before each release, `scripts/similarity-audit.sh` compares `web/src` against the upstream client and MindRoom Chat with a clone detector. The orchestrator runs it, outside the implementers' context, and stores only the report. Any match longer than a trivial idiom gets rewritten from the spec.
- The language models used may have seen public Matrix clients in training. The audit is the control for that.

## 4. Approaches considered

1. **Rust core (matrix-rust-sdk compiled to wasm) with a SolidJS and TypeScript interface.** One codebase runs in the browser, in desktop and mobile shells later, and against one SDK. The SDK handles sync, E2EE, the room list, and timelines. The interface uses the web ecosystem: Markdown, HTML sanitizing, virtualization, noVNC.
2. **Native SwiftUI with `matrix-rust-components-swift`.** Best on Apple devices and furthest from the upstream client, but no web client, and MindRoom users need one.
3. **All-Rust interface (Dioxus or Leptos) calling the SDK directly.** One language and no bindings layer, but slow rebuilds for interface work (the SDK is a big compile), a thinner ecosystem for rich chat interfaces, and weaker agent fluency.

**Decision: approach 1.**

Interface framework, chosen within approach 1:

| Framework | For | Against |
|---|---|---|
| **SolidJS** (chosen) | Fine-grained reactivity: a streamed edit updates one text node, and the SDK's `VectorDiff` updates map one to one onto store operations. Small runtime. JSX with full TypeScript checking. Structurally unlike the upstream client (React), which keeps the clean room clean. | Smaller ecosystem; props must not be destructured (lint rule enforces it). |
| React | Largest ecosystem, most familiar to agents | Same framework as the upstream client, which invites reproducing patterns from training data; re-renders whole subtrees on each diff |
| Svelte 5 | Fine-grained, compact | Agents mix Svelte 4 and 5 syntax; `.svelte` files need their own checker |

## 5. Architecture

```
mindroom-client/
  crates/model/    Rust crate `mindroom-model`: serializable view models and pure mapping
                   functions; no SDK dependency, so its tests run natively in seconds
  crates/core/     Rust crate `mindroom-core`, built to wasm with wasm-bindgen
    src/lib.rs        wasm exports (thin)
    src/client.rs     login, restore, logout, sync service, session persistence
    src/rooms.rs      room list subscription
    src/timeline.rs   room and thread timelines, sending, pagination, retry
  web/             SolidJS + TypeScript + Vite
    src/core/         typed wrapper around the wasm module (the only file that imports it)
    src/state/        Solid stores fed by core subscriptions; diff application
    src/ui/           components: login, room list, timeline, message, composer, thread panel
    src/render/       message body rendering (sanitized HTML, MindRoom markers)
  e2e/             Playwright tests and the Tuwunel Docker Compose stack
  scripts/         license check, similarity audit
  flake.nix        dev shell: rustc, cargo, lld, wasm-bindgen-cli, binaryen (wasm-opt), just, cargo-deny, bun, chromium for tests
```

### 5.1 Rust core (`mindroom-core`)

The core owns all Matrix state. It exposes a small, coarse, asynchronous API to JavaScript, and every value that crosses the boundary is a plain serializable view model, never an SDK type.

Dependencies: `matrix-sdk` and `matrix-sdk-ui` 0.19.x with `default-features = false` and features `js`, `indexeddb`, `e2e-encryption`, `markdown`; `wasm-bindgen` pinned to the version of the Nix `wasm-bindgen-cli`; `serde`, `serde-wasm-bindgen`; `futures-util`.

Storage: `matrix-sdk-indexeddb` stores (state, crypto, event cache) named per account (`mindroom-<hash of user id>`), protected by a passphrase. M1 keeps the passphrase and the session tokens in `localStorage`, which matches other web clients' practice. M3 revisits this with the recovery key.

Exported API (TypeScript view of the wasm-bindgen exports):

```ts
class Core {
  static restore(): Promise<Core | null>;                  // session from localStorage
  static login(homeserverOrServerName: string, user: string, password: string): Promise<Core>;
  logout(): Promise<void>;
  session(): SessionInfo;                                  // userId, deviceId, homeserver
  startSync(onState: (state: SyncState) => void): Promise<void>;
  subscribeRooms(onDiff: (diffs: ListDiff<RoomSummary>[]) => void): Subscription;
  openTimeline(roomId: string, threadRoot: string | null,
               onDiff: (diffs: ListDiff<TimelineEntry>[]) => void): Promise<TimelineHandle>;
}
interface TimelineHandle {
  paginateBack(count: number): Promise<boolean>;           // true when the start is reached
  sendMarkdown(text: string): Promise<void>;               // into the thread when threadRoot is set
  retrySend(uniqueId: string): Promise<void>;              // retry a failed local echo
  close(): void;
}
interface Subscription { close(): void }
```

`ListDiff<T>` mirrors `eyeball_im::VectorDiff`: `append`, `clear`, `pushFront`, `pushBack`, `popFront`, `popBack`, `insert`, `set`, `remove`, `truncate`, `reset`. Each carries indexes and values as JSON.

`RoomSummary`: `id`, `name`, `avatarUrl` (`mxc://` or null), `isDirect`, `isEncrypted`, `unreadCount`, `highlightCount`, `lastActivity` (ms), `latestPreview` (sender and text or null).

`TimelineEntry` is either a virtual item (`dayDivider` with timestamp, `readMarker`, `timelineStart`) or an event:

- identity: `uniqueId` (stable across updates; used as the key), `eventId` or null, `transactionId` or null
- sender: `userId`, `displayName`, `avatarUrl`, `isOwn`
- `timestamp`, `sendState` (`sending`, `sent`, `failed` with error text)
- `content`: `kind` (`text`, `notice`, `emote`, `image`, `file`, `redacted`, `unableToDecrypt`, `state`, `other`), `body`, `formattedHtml` or null, `isEdited`
- `mindroom`: `streamStatus` (string or null, from `io.mindroom.stream_status` of the latest edit, falling back to the original event), `toolTrace` (raw JSON or null, from `io.mindroom.tool_trace`)
- `thread`: for a thread root in a room timeline, `replyCount` and the latest reply's sender and preview
- `reactions`: list of key, count, and whether the user reacted

The pure mapping logic (diff conversion, MindRoom field extraction, previews, error classification) lives in `mindroom-model`. It is unit-tested on the native target with JSON fixtures, so most core tests run without a browser. `mindroom-core` only adapts SDK types to those functions.

Sync: `matrix_sdk_ui::sync_service::SyncService` drives `RoomListService` (sliding sync, MSC4186, served by Tuwunel as `sync/v5`) and the encryption sync. `SyncState` is `idle`, `running`, `offline`, `error` with text, or `sessionExpired` (the server rejected the access token).

Timelines: `Room::timeline_builder()`. The room timeline uses `TimelineFocus::Live { hide_threaded_events: true }` and shows thread summaries on roots, which is how MindRoom conversations look. A thread timeline uses `TimelineFocus::Thread` with the root event ID. Both exist in 0.19.1.

Sending: `RoomMessageEventContent::text_markdown` through the timeline's send queue (local echo comes free). Thread replies set the thread relation through the timeline in thread focus.

### 5.2 Web interface

- `web/src/core/` loads the wasm module once, wraps the exports with types, and converts thrown `JsValue` errors into `CoreError { code, message }`.
- `web/src/state/` keeps one Solid store per subscription and applies `ListDiff` batches with `produce`, keyed by `uniqueId`, so a streamed edit changes one entry and Solid updates only that message's text node.
- Routes (`@solidjs/router`): `/login`; `/` (room list only); `/room/:roomId`; `/room/:roomId/thread/:eventId` (room timeline with the thread panel open).
- Layout: room list sidebar, room timeline in the middle, thread panel on the right (full screen on narrow viewports).
- Message rendering: `formattedHtml` sanitized with DOMPurify (Apache-2.0 or MPL-2.0) against an allowlist of the Matrix spec's HTML tags and attributes; otherwise `body` as plain text with line breaks. `mxc://` images are out of scope until M3. Links open in a new tab with `rel="noopener noreferrer"`.
- MindRoom markers: a message whose `streamStatus` is `pending` or `streaming` shows a progress indicator next to the sender. Tool markers (`🔧 \`name\` [N] ⏳`) already arrive in the text and render as is in M1. M2 adds the tool-trace view.
- Composer: textarea; Enter sends, Shift+Enter adds a newline; the core converts Markdown to HTML.
- Styling: own CSS with custom properties, light and dark through `prefers-color-scheme`, system font stack. No component kit in M1.
- Lint and format: ESLint with `eslint-plugin-solid`, TypeScript `strict`, Prettier.

### 5.3 Data flow

1. On start, the app calls `Core.restore()`; with no session it shows `/login`.
2. Login resolves the homeserver (`.well-known`, done by the SDK's `server_name_or_homeserver_url`), logs in, stores the session, and starts sync.
3. `subscribeRooms` streams the room list; the sidebar renders from the store.
4. Opening a room calls `openTimeline(roomId, null)`. Opening a thread also calls `openTimeline(roomId, rootId)`. Each handle is closed when its view unmounts.
5. Agent streaming arrives as `m.replace` edits; the SDK folds them into the original timeline item, the core emits a `set` diff, and the store updates that entry.

### 5.4 Error handling

- Every core call rejects with `CoreError { code, message }`. Codes: `network`, `auth` (wrong password, expired session), `rateLimited` (with retry seconds), `notFound`, `internal`.
- A session that the server rejects (`M_UNKNOWN_TOKEN`) clears the stored session and returns to `/login` with a message.
- Sync errors show a banner; the sync service restarts with backoff.
- A failed send keeps the message in the timeline with a retry action.
- A panic in Rust is caught by `console_error_panic_hook` and reported as `internal`.

## 6. Testing

- **Rust unit tests** (`cargo test`, native target): view-model mapping from JSON fixtures, including edits with `io.mindroom.stream_status` and `io.mindroom.tool_trace`.
- **Wasm build check**: `cargo build -p mindroom-core --target wasm32-unknown-unknown --release`, then `wasm-bindgen --target web` and `wasm-opt -Oz` (the Nix versions, so the CLI matches the pinned crate).
- **TypeScript unit tests** (Vitest): diff application, HTML sanitizing (script tags, `javascript:` links, event handler attributes all removed), route guards.
- **End-to-end tests** (Playwright with the system Chromium) against a disposable Tuwunel from `ghcr.io/mindroom-ai/mindroom-tuwunel` (Apache-2.0) in Docker Compose with open registration. Accounts are registered through the client-server API in test setup. M1 cases: login and restore after reload; room list shows a room another account created; sending a message appears for both accounts; a thread reply shows in the thread panel and as a summary in the room; an edit sent by another account (simulating a streamed agent reply with `io.mindroom.stream_status: streaming`, then `completed`) updates the message in place; the same flows in an encrypted room.
- Tuwunel limits password logins per account, so tests reuse stored sessions and use one account per browser context.

## 7. Licensing

- `LICENSE`: Apache-2.0; `NOTICE` names the project and lists bundled third-party notices.
- `scripts/license-check.sh` fails on any GPL, AGPL, LGPL, SSPL, or unknown license in `web` dependencies (`license-checker`-style scan of `node_modules`) and in Rust dependencies (`cargo deny check licenses` with an allowlist).
- MPL-2.0 is allowed only for unmodified dependency files.

## 8. Risks

| Risk | Mitigation |
|---|---|
| `matrix-sdk-ui` on wasm hits a runtime gap (IndexedDB event cache, timers) | M0 ends with a smoke test that logs in and syncs in a real browser against Tuwunel; fall back to the SDK's in-memory stores for M1 if a store fails |
| Large wasm bundle (SDK plus crypto) | `opt-level = "z"`, LTO, `wasm-opt`; measure in M0; load it with a splash screen |
| Thread summaries on roots incomplete in SDK 0.19 (both focus types exist) | Verified during M1; fallback counts replies from the thread timeline |
| Live frames need custom ephemeral events over sliding sync | Deferred to M2; streaming works through edits without them |
| Training-data contamination | Similarity audit before each release |

## 9. Decisions not needing input now

- Repository name `mindroom-client`, local only until Bas decides where it lives on GitHub.
- Bun as package manager and script runner; Vite for the dev server and builds.
- Main-thread wasm in M1; the API is asynchronous and message-shaped, so moving the core into a Web Worker later is mechanical.
