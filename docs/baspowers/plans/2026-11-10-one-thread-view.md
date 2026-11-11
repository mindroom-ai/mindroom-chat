# One Thread View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans (native): five tightly coupled tasks over the same three files (`RoomView.tsx`, `ThreadView.tsx`, the new `ConversationLayout.tsx`), so one context holding all of them beats a handoff per task; a fresh whole-branch review follows.

**Goal:** Every thread on the room page renders through `ThreadView` in the thread column, and the room's messages and a thread share one layout component, so a thread over the whole page has one implementation.

**Architecture:** `ConversationLayout` draws a conversation (floating header, timeline, dock, floating footer) and measures its insets; the room area and `ThreadView` both use it. `RoomView` drops the messages' place: an open thread is always in the `ResizablePanel` column, which fills the page with the layout `full` or a narrow page, while the room's conversation collapses under it. A send that opened its thread parks under the thread's composer key.

**Tech Stack:** React 18, jotai, vanilla-extract, matrix-js-sdk, Vitest (jsdom), Playwright.

**Spec:** `docs/baspowers/specs/2026-11-10-one-thread-view-design.md`

## Global Constraints

- Lane C files pass `just strict` and the type-aware `just lint`; styles use logical sides.
- `src/app/threads/ThreadContextBanner.tsx`, its test, and `src/app/composer/__tests__/RoomInput.test.ts` are Lane P: edit only the lines the change needs, no Prettier over them.
- No em dashes in code comments, docs or commit messages; unsigned commits (`git -c commit.gpgsign=false commit`); add files by explicit path.
- The SDK `ThreadView` stays `{ room: Room; threadId: string }`.
- Every push passes the upstream-overlap pre-push hook; never `--no-verify`.

## Review Focus

1. A root sent from the room's composer in Compact with two files, layout `full`: the second file shows on the thread's composer with the pending indicator and goes out once (Task 3 test `parks a send that opened its thread for that thread's composer`).
2. Show beside from a filled column, then Show in full, while the thread's composer holds a reply and a staged file: both stay (Task 4 test `keeps the thread's composer as the column changes width`).
3. Show beside or Show in full moves no focus (Task 2 test `focuses the composer only as a thread opens or changes`).
4. Leaving a thread that filled the page shows the room's rows where they were (Task 4 test `unmounts the room's conversation while the column fills the page, and mounts it again beside`, plus the existing thread return place e2e specs).
5. A phone opens every thread filling the page, with the room header's Back in the column (Task 4 test `fills the page with every thread on a phone`).

---

### Task 1: `ConversationLayout`, the room area through it

**Files:**
- Create: `src/app/room/ConversationLayout.tsx`, `src/app/room/useLocalEchoRoot.ts`
- Modify: `src/app/room/RoomView.tsx` (room area, `useRoomOverlayInsets`, `useLocalEchoRoot`, notice, styles)
- Test: `src/app/room/ConversationLayout.test.tsx`

**Interfaces:**
- Produces:
  - `useLocalEchoRoot(room: Room, threadId: string | undefined, onDeleted?: () => void): { pending: false } | { pending: true; event: MatrixEvent | undefined }` (moved from `RoomView.tsx` unchanged, `onDeleted` optional).
  - `ComposerNotice({ room, failedRoot, tombstone, canMessage }: { room: Room; failedRoot?: MatrixEvent; tombstone?: MatrixEvent; canMessage: boolean }): ReactElement | null`: the failed root's `FailedSendActions`, else `RoomTombstone`, else the no-permission line, with today's `NOTICE_STYLE`.
  - `ConversationLayout(props: ConversationLayoutProps)` with
    ```ts
    type ConversationLayoutProps = {
      room: Room;
      /** The thread it shows; none for the room's own messages. */
      threadId?: string;
      /** The box: positions the header, dock and footer, measures their insets, takes `useInert`. */
      areaRef: RefObject<HTMLDivElement>;
      /** The floating header's contents, given the header's element (for the plugins' slot). */
      header?: (headerRef: RefObject<HTMLDivElement>) => ReactNode;
      timeline: ReactNode;
      focusConversation: () => void;
      canCancelJobs: boolean;
      notice?: ReactNode;
      composer?: ReactNode;
      /** Takes no room in its row and shows only `children` (the room under a filling thread). */
      collapsed?: boolean;
      /** The element a plugin's cover hides: timeline, dock and footer. */
      conversationRef?: RefObject<HTMLDivElement>;
      /** Layers over the conversation, under the header: the plugin cover. */
      children?: ReactNode;
    };
    ```
    It renders today's room area markup: the box (`css.RoomArea`, `AREA_STYLE`, or `AREA_UNDER_THREAD_STYLE` while `collapsed`), the header element (`overlay.Header`, `css.HeaderInShortArea`, `overlay.HeaderInThread` with a `threadId`, `data-glass-flat`, `SurfaceProvider`), the `display: contents` conversation wrapper with `ThreadApprovalProvider` (`threadId` only when `isConfirmedMatrixEventId`) around the timeline and the dock (`BackgroundJobsBar` with `threadId ?? null`, `ThreadApprovalQueue` with a `threadId`), and the footer outside the provider (`overlay.Footer`, `data-room-footer="true"`: `RoomViewTyping`, `notice`, `composer`, `RoomViewFollowing`). `useRoomOverlayInsets` moves here unchanged, keyed by `threadId`.

- [ ] **Step 1: Write the failing tests** in `ConversationLayout.test.tsx` (mock `RoomViewTyping`, `RoomViewFollowing`, `BackgroundJobsBar`, `ThreadApprovalProvider`, `ThreadApprovalQueue` as named stubs that render their props):
  - `draws the header, timeline, dock and footer of the room`: header render function receives the header element's ref; `BackgroundJobsBar` gets `threadId: null`; no `ThreadApprovalQueue`; the footer carries `data-room-footer="true"` and holds typing, notice, composer, following in that order.
  - `adds the thread's approvals and passes a confirmed thread to its provider`: with `threadId: '$root'`, the queue renders and the provider gets `'$root'`; with `'~!room:txn'`, the provider gets `undefined`.
  - `shows only its children while collapsed`: `collapsed` renders the children and no header, timeline or footer; the box's style has `flex: 0 0 0` and `content-visibility: hidden`.
- [ ] **Step 2:** `nix develop -c npx vitest run src/app/room/ConversationLayout.test.tsx`: FAIL (module missing).
- [ ] **Step 3:** Implement `useLocalEchoRoot.ts`, `ConversationLayout.tsx` (with `ComposerNotice`), and render RoomView's room area through it: `threadId={effectiveThreadId}`, the room header and `RoomHeaderSlot` as `header` (the slot only while `!columnFills`, as now), the cover as `children`, `collapsed` false. The page keeps its behaviour in this task (the messages' place still exists).
- [ ] **Step 4:** Run the new test plus `src/app/room src/app/threads`: PASS.
- [ ] **Step 5:** Commit `Room view: the room area draws its conversation through ConversationLayout`.

### Task 2: `ThreadView` through `ConversationLayout`

**Files:**
- Modify: `src/app/room/ThreadView.tsx`, `src/app/room/RoomView.tsx` (column header and column jobs bar go)
- Test: `src/app/room/ThreadView.test.tsx`

**Interfaces:**
- Consumes: `ConversationLayout`, `ComposerNotice`, `useLocalEchoRoot` (Task 1).
- Produces: `ThreadView` prop `roomHeader?: (headerRef: RefObject<HTMLDivElement>) => ReactNode`, passed to `ConversationLayout`'s `header`. `autoFocus` is read when the thread opens or `threadId` changes; a change of `autoFocus` alone focuses nothing.

- [ ] **Step 1: Write the failing tests** in `ThreadView.test.tsx`:
  - `shows typing, read receipts and the thread's background jobs`: `RoomViewTyping`, `RoomViewFollowing`, `BackgroundJobsBar` stubs receive `threadId: '$root'`.
  - `offers Retry and Delete for its unsent root in place of nothing`: a failed local echo root (`isFailedLocalEchoEvent` true) renders `FailedSendActions` with that event.
  - `tells an upgraded room or a missing permission where the composer would be`: tombstone renders `RoomTombstone` and no composer; no `m.room.message` permission renders the no-permission text.
  - `shows the room header it is given in its floating header`: `roomHeader` is called with a ref whose element has `data-glass-flat`.
  - `focuses the composer only as a thread opens or changes`: rerendering with `autoFocus` going false to true on the same thread calls `ReactEditor.focus` no more times; a new `threadId` with `autoFocus` true calls it once.
- [ ] **Step 2:** Run `ThreadView.test.tsx`: the new tests FAIL.
- [ ] **Step 3:** Render `ThreadView` through `ConversationLayout` (its `viewRef` as `areaRef`; `VIEW_STYLE`'s zero insets go); compute `canCancelJobs` from its own permissions with `io.mindroom.background_job_cancel`; read `autoFocus` through `useLatestRef`. In `RoomView`, the filled column passes `roomHeader` (`RoomViewHeader` with `threadId={columnThreadId}` and `RoomHeaderSlot`) and drops `COLUMN_HEADER_STYLE`, `columnHeaderRef` and the column's `BackgroundJobsBar`. Update the `ThreadView` doc comment.
- [ ] **Step 4:** Run `src/app/room src/app/threads src/client-sdk`: PASS (update `RoomView.threadColumn.test.tsx` assertions that looked for the column's own header element).
- [ ] **Step 5:** Commit `Thread view: typing, read receipts, jobs and notices through ConversationLayout`.

### Task 3: A send that opens its thread goes with it

**Files:**
- Modify: `src/app/composer/useRoomInputSendSessionController.ts`
- Test: `src/app/composer/useRoomInputSendSessionController.test.ts`

**Interfaces:**
- Produces: `SessionComposer.reportSent(context, eventId): boolean`, true when the composer's `onRoomMessageSent` returned true. `SendSession.openedThreadId?: string`, set to the reported event ID when `reportSent` returns true. The unmount `park` key is `voiceComposerKey({ roomId: session.roomId, threadId: session.openedThreadId, threadView: true })` when `openedThreadId` is set, else today's key.

- [ ] **Step 1: Write the failing test** in the `after its composer unmounts` block:
  - `parks a send that opened its thread for that thread's composer`: a room composer (`threadView` false, `onRoomMessageSent` returning true) sends two files; after the root is reported with `~!room:txn1`, the composer unmounts; a composer mounted in a thread view (`ConversationViewContext` provider) for `threadId: '~!room:txn1'` gets `joinedSendPending` true and the second file on its board; when the upload finishes, `sendMessage` is called once for it with an `m.thread` relation to the root.
  - `parks a send that opened no thread under its room, as before`: same without `onRoomMessageSent` returning true; a room composer mounted again takes it over, and a thread view composer does not.
- [ ] **Step 2:** Run the test file: the first test FAILS (the thread composer takes nothing over).
- [ ] **Step 3:** Implement the interfaces above (`reportSent` returns the handler's result as `=== true`; both `notifyRoomMessageSent` sites set `session.openedThreadId`).
- [ ] **Step 4:** Run `src/app/composer`: PASS.
- [ ] **Step 5:** Commit `Composer: a send that opens its thread parks for that thread's composer`.

### Task 4: Every thread in the column

**Files:**
- Modify: `src/app/room/RoomView.tsx`, `src/app/room/threadLayout.ts`, `src/app/threads/ThreadContextBanner.tsx`, `src/app/threads/ThreadActionsMenu.tsx`, `src/app/composer/useRoomInputVoice.tsx`, `src/app/composer/roomInputDrafts.ts`, `src/app/i18n/locales/additions/*.json` (`thread.showBesideBlocked` out of all 17)
- Delete: `src/app/composer/useRoomInputVoice.recorderRoom.test.tsx`
- Test: `src/app/room/RoomView.threadColumn.test.tsx`, `src/app/room/RoomView.typeToCompose.test.tsx`, `src/app/threads/ThreadContextBanner.test.ts`, `src/app/threads/ThreadActionsMenu*.test.tsx`, `src/app/threads/RoomViewApprovalLifecycle.test.tsx`, `src/app/room/Room.*.test.tsx`, `src/app/composer/__tests__/RoomInput.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `RoomView`: `columnThreadId = openThreadId`; `columnFills = !!openThreadId && (layout === 'full' || !roomy)`; the room's `ConversationLayout` gets no `threadId` and `collapsed={columnFills}`; banner `onShowBeside={columnFills && roomy ? showBeside : undefined}`, `onShowFull={openThreadId && !columnFills ? showFull : undefined}`; `ThreadView autoFocus={!columnFills}`. `ThreadContextBannerProps` lose `showBesideBlocked` and `onRestore`; `ThreadActionsMenu` loses `showBesideBlocked`. `useThreadLayout` returns `{ roomy, layout, setLayout }`; `storedThreadLayout` stays the atom's private initializer. `voiceRecorderRoomAtom` goes.

- [ ] **Step 1: Rewrite the placement tests** in `RoomView.threadColumn.test.tsx` (drop the tests of a thread keeping the messages' place and of Show beside waiting):
  - `opens every thread in the column, filling the page with the layout full`: default layout, a thread route: `thread-column` exists with `fullWidth`, the room's `RoomTimeline` mock gets no `threadId`, exactly one `RoomInput` mock renders, with the thread's `threadId`.
  - `opens a thread beside the messages with the layout beside`: two `RoomInput`s, the room's without `threadId`.
  - `fills the page with every thread on a phone`: `ScreenSize.Mobile` with layout `beside`: the column fills; the banner gets no `onShowBeside`.
  - `unmounts the room's conversation while the column fills the page, and mounts it again beside`: Show beside remounts the room's `RoomTimeline` mock; the cover stays mounted throughout (one mount).
  - `keeps the thread's composer as the column changes width`: the `ThreadView` mount count stays 1 across Show beside and Show in full.
  - `offers Show beside from a filled column at any time`: with a page reply draft, staged file and recording atoms set, `onShowBeside` is defined.
- [ ] **Step 2:** Run the file: FAIL.
- [ ] **Step 3:** Implement the interfaces above; remove `place`, `samePlace`, `inColumn`, `effectiveThreadId`, `pageReply`, `pageFiles`, `pageRecording`, `measured`; update the `RoomView` doc comment, the banner (`toBeside` becomes `onShowBeside`, no `blocked`), the menu entry, the locale files, and drop `voiceRecorderRoomAtom` with its setter effect and sign-out reset.
- [ ] **Step 4:** Update the other listed tests to the new tree (the banner test's blocked cases go; type-to-compose with a filled column; approval lifecycle through the column); run `just typecheck`, `just strict`, `just lint`, and the full `just test`: PASS.
- [ ] **Step 5:** Commit `Room view: every thread opens in the thread column`.

### Task 5: Docs, e2e and screenshots

**Files:**
- Modify: `docs/architecture.md`, `src/client-sdk/room.ts` (ThreadView comment), `e2e/threads/agent-thread-column.spec.ts`

- [ ] **Step 1:** Update `docs/architecture.md` (`navigateRoomThread`: "in the thread column, beside the messages while the person chose it and the page has room, else filling the page"; the header slot paragraph; the `ThreadView` paragraph) and the SDK comment (a failed voice send comes back in a view of that thread).
- [ ] **Step 2:** In `agent-thread-column.spec.ts`, replace the waiting check with: Show beside with a staged file in the thread's composer keeps the file; assert one `[data-editable-name="RoomInput"]` while the column fills.
- [ ] **Step 3:** Run `scripts/e2e-slot.sh <n> --snapshot --preview` with `MINDROOM_CLIENT_PLUGINS=$PWD/src/app/plugins/__fixtures__/example-plugin` for `e2e/threads e2e/composer e2e/approvals e2e/plugins/room-header-slot.spec.ts`, then `just e2e-suite` on the smoke specs: PASS; fix what the new tree breaks.
- [ ] **Step 4:** Throwaway screenshot spec: a thread in full, beside, and on a phone (390 x 844), before (main) and after (branch head); delete the spec.
- [ ] **Step 5:** Commit `Threads: docs and e2e for one thread view`; push; open the PR with the screenshots.
