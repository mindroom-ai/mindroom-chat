# Cross-Room Thread Forks — Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task using `baspowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.

**Execution:** `baspowers:subagent-driven-development` — client PR implemented in parallel with backend PR against the shared `io.mindroom.fork` protocol spec, followed by Playwright e2e + screenshots and Opus + Astra dual review.

**Goal:** Let MindRoom Chat users fork any thread (or message inside a thread) into another joined room via **Fork to room…**, preview the parent conversation inside the target room's draft, and render sent cross-room forks seamlessly with proper room-scoped names, avatars, media, links, and dividers.

**Architecture:** Extend `ThreadForkRef` with optional `roomId`; make prefix loading and prefix row rendering per-hop / per-row room-aware; open cross-room drafts in the target room under dedicated `?forkRoom=&forkThread=&forkAt=` query params so `ThreadView` cleanly splits read scope (`sourceRoom`) from send scope (`targetRoom`); add `ForkToRoomDialog` beside existing fork menu items.

**Tech Stack:** TypeScript, React 19, `matrix-js-sdk`, Folds, vanilla-extract, i18next, Vitest, Playwright.

**Spec:** `docs/baspowers/specs/2026-11-23-cross-room-thread-forks-design.md`

## Global Constraints

- Wire format: `io.mindroom.fork: { room_id?: "!...", thread_id: "$...", event_id: "$..." }`. Omit `room_id` when `ref.roomId === undefined || ref.roomId === targetRoomId`. Reject entire ref if `room_id` is present and fails `isRoomId`.
- Never persist cross-room prefix events into the target room's IndexedDB cache.
- Never leak URL previews/favicons from an encrypted source room when rendered in a target room.
- Update all i18n locale files in `src/app/i18n/locales/additions/` so `just keys` passes.
- Soft size target: ~500–700 prod lines across `threads/fork/` and surgical edits in `room/`, `timeline/`, `messages/`, `composer/`, `native/`, `i18n/`; ~600–800 test lines (~1:1 ratio).

## Review Focus

1. Multi-hop chain `A -> B -> C` where `B -> A` omits `room_id`: hop 2 must resolve in `A` (relative to `B`'s parent room), not `C`.
2. Clock skew across homeservers: child messages with timestamps earlier than parent prefix messages must still render *after* the prefix and divider.
3. Invalid/partial `?forkRoom=&forkThread=&forkAt=` URLs (or unjoined `forkRoom`) must never open a broken draft or send a message into the wrong room/thread, and `nativeUniversalLinks.ts` must preserve valid tuples.
4. Prefix row interactions in a sent cross-room fork: Copy Link uses `sourceRoom.roomId`, Open in original thread navigates to `sourceRoom.roomId`, Fork from here carries `roomId: sourceRoom.roomId`, sender click uses `sourceRoom.roomId`, and inaccessible `parentRoom` renders static `"Forked from another room"` without bogus cache fetches.
5. Target room filtering & warning: exclude spaces, source room, tombstoned/unwritable rooms, `room`-thread-mode rooms, and unencrypted targets when source is encrypted; warn when no MindRoom agent in target room is joined to source room.

---

### Task 1: Protocol, `ThreadForkRef`, cross-room prefix loader, and segment ordering

**Files:**
- Modify: `src/app/event-store/threads/threadFork.ts`
- Modify: `src/app/composer/useRoomInputSendSessionController.ts` (pass `roomId` to `threadForkContent` so same-room omits `room_id`)
- Modify: `src/app/threads/fork/loadThreadForkPrefix.ts`
- Modify: `src/app/threads/fork/useThreadForkPrefix.ts`
- Modify: `src/app/threads/fork/useThreadForks.ts` (ignore cross-room fork roots pointing to another room)
- Modify: `src/app/timeline/useThreadRenderState.ts` (preserve segment order: prefix before own)
- Test: `src/app/event-store/threads/threadFork.test.ts`, `src/app/threads/fork/loadThreadForkPrefix.test.ts`, `src/app/threads/fork/useThreadForkPrefix.test.tsx`, `src/app/threads/fork/useThreadForks.test.ts`, `src/app/timeline/useThreadRenderState.test.ts`

- [ ] **Step 1:** Write failing unit tests for `room_id` parsing/serialization/rejection/edit-preservation, cross-room `A -> B -> C` chain with omitted-room hop, `useThreadForkPrefix` reading from `hopRoom` & watching edits/redactions/membership loss across rooms, `useThreadForks` ignoring cross-room forks of other rooms, and `useThreadRenderState` keeping prefix ahead of earlier-timestamped child events.
- [ ] **Step 2:** Implement Task 1 changes.
- [ ] **Step 3:** Run Vitest on touched test files and verify PASS. Commit.

### Task 2: Per-row `eventRoom` rendering in sent cross-room forks, divider, and Compact card

**Files:**
- Modify: `src/app/timeline/forkPrefixTimelineSet.ts`
- Modify: `src/app/timeline/RoomTimeline.tsx`
- Modify: `src/app/timeline/message-rendering/useTimelineMessageFeature.tsx`
- Modify: `src/app/threads/fork/ThreadForkDivider.tsx`
- Modify: `src/app/threads/overview/CompactThreadCard.tsx`
- Modify: `docs/architecture.md` (update Thread fork row)
- Test: `src/app/timeline/__tests__/RoomTimeline.forkPrefix.test.ts`, `src/app/timeline/message-rendering/TimelineMessageFeature.test.tsx`, `src/app/threads/fork/ThreadForkDivider.test.tsx`, `src/app/threads/overview/CompactThreadCard.test.tsx`

- [ ] **Step 1:** Write failing tests for per-row `eventRoom` (display name, permalink, Open in original thread, Reply quote, Fork from here preserving `roomId`, encrypted source URL preview guard), `ThreadForkDivider` cross-room label/navigation & inaccessible-room fallback (including when prefix is empty), and `CompactThreadCard` cross-room / inaccessible label.
- [ ] **Step 2:** Implement Task 2 changes.
- [ ] **Step 3:** Run Vitest on touched test files and verify PASS. Commit.

### Task 3: Cross-room draft route, `ThreadView` split read/send scopes, `ForkToRoomDialog`, menu entry points, and i18n

**Files:**
- Create: `src/app/threads/fork/ForkToRoomDialog.tsx` (+ CSS if needed)
- Create: `src/app/threads/fork/ForkToRoomDialog.test.tsx`
- Modify: `src/app/threads/fork/useStartThreadFork.ts`
- Modify: `src/app/threads/ThreadActionsMenu.tsx`
- Modify: `src/app/messages/Message.tsx` (add `onForkToRoomClick` / `"Fork to room…"` right after `"Fork from here"`)
- Modify: `src/app/timeline/message-rendering/useTimelineMessageFeature.tsx` (wire `onForkToRoomClick` + dialog)
- Modify: `src/app/room/Room.tsx`
- Modify: `src/app/room/RoomView.tsx`
- Modify: `src/app/room/ThreadView.tsx`
- Modify: `src/app/native/nativeUniversalLinks.ts`
- Modify: `src/app/i18n/locales/additions/*.json` (all locale files)
- Test: `src/app/threads/fork/useStartThreadFork.test.ts`, `src/app/threads/ThreadActionsMenu.items.test.tsx`, `src/app/messages/__tests__/Message.test.ts`, `src/app/room/__tests__/Room.test.ts`, `src/app/room/ThreadView.test.tsx`, `src/app/native/nativeUniversalLinks.test.ts`

- [ ] **Step 1:** Write failing unit tests for `ForkToRoomDialog` (filtering spaces, source room, tombstoned, unwritable, `room`-mode, unencrypted-from-encrypted; recent-first sort; keyboard navigation; agent-not-in-source warning), `useStartThreadFork` cross-room URL, `Room` / `nativeUniversalLinks` query param validation, `ThreadView` split read/send scopes & draft header warning, and `"Fork to room…"` menu items.
- [ ] **Step 2:** Implement Task 3 changes and all i18n locale additions.
- [ ] **Step 3:** Run Vitest on touched tests, `npx tsc --noEmit`, `npx vite build`, `just keys`, and `NODE_OPTIONS=--max-old-space-size=6144 just lint`. Commit.

### Task 4: End-to-end Playwright spec + PR screenshots

**Files:**
- Create: `e2e/threads/cross-room-thread-fork.spec.ts`

- [ ] **Step 1:** Write `e2e/threads/cross-room-thread-fork.spec.ts` (modeled on `e2e/threads/thread-fork.spec.ts`) using invented placeholder rooms (`Project Alpha` -> `Project Beta`, invented messages). Test:
  - Opening `"Fork to room…"` from thread menu (and from a middle message), searching/picking `Project Beta`,
  - Seeing the cross-room draft in `Project Beta` with `Project Alpha`'s messages up to the fork point, `"Forking … into Project Beta"` divider, and composer focused,
  - Sending the first message, verifying server event in `Project Beta` has top-level `io.mindroom.fork: { room_id: alphaRoomId, thread_id: rootId, event_id: secondId }`,
  - Verifying the new thread in `Project Beta` renders `Project Alpha`'s prefix messages, `"Forked from … in Project Alpha"` divider, and its own message in order (excluding `Project Alpha`'s later reply),
  - Clicking the divider navigates back to `Project Alpha` at the fork point,
  - Capturing clean screenshots when `CROSS_ROOM_FORK_SHOTS` env var is set (picker open, cross-room draft, sent cross-room fork, Compact card in `Project Beta`).
- [ ] **Step 2:** Run the e2e spec against a free slot (check `ss -ltn | grep :43` first!) and verify PASS. Commit.
