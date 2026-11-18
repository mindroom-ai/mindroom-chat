# Open a Second Thread Beside the Current One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans, one Opus 5.5 implementer for all five tasks: they share
one small interface (the context and the hook) and the whole branch gets two cross-model reviews.

**Goal:** A thread card menu's "Open beside" shows a second thread (B) in a core side panel next
to the open thread (A), on desktop and tablet only.

**Architecture:** B is a built-in side panel (`id: 'thread'`) in `room/Room.tsx` that renders
`ThreadView` under a `ThreadContextBanner` with a Close button. The room page remembers B per
room for the account in localStorage and offers it to `ThreadActionsMenu` through
`SecondThreadContext`. Layout needs no new rule: B narrows the conversation box, which
`useThreadLayout` already measures.

**Tech Stack:** React 18, jotai, TypeScript strict, Vitest + Testing Library, Playwright.

**Spec:** `docs/baspowers/specs/2026-11-18-open-thread-beside-design.md`

## Global Constraints

- All commands inside `nix develop` (`nix develop -c ...`).
- Layer rules: `navigation` is layer 4, `threads` 9, `room` 11. `threads` must not import `room`.
- No em dashes anywhere (code, docs, commits). No barrel files. Tests beside their subject.
- New UI strings go in `src/app/i18n/locales/additions/en.json` and all 16 other overlays in that
  folder, same keys (`localeAdditions.test.ts`). Reuse each language's existing word for "thread".
- New keys: `threadActions.openBeside` = "Open beside", `thread.close` = "Close thread",
  `thread.resizeSecond` = "Resize second thread", `thread.second` = "Second thread".
- localStorage keys, built in `src/app/preferences/accountStorageKeys.ts` and listed in
  `accountStorageKeys(userId)`: `secondThreadStorageKey(userId)` =
  `` `mindroom.secondThread:${userId}` `` (JSON `{ [roomId]: threadId }`) and
  `secondThreadWidthStorageKey(userId)` = `` `mindroom.secondThread.width:${userId}` ``.
- Panel: `defaultWidth` 480, `minContentWidth={CONVERSATION_MIN_WIDTH}`, `maxPanelWidth` 4096,
  `testId="second-thread-panel"`, no `onExpand`, listed after `members` in `panels`.
- No change for an untouched client: nothing shows until someone picks Open beside.
- Plugin SDK (`src/client-sdk/`) unchanged; `useShownThread` keeps meaning A.
- Commits: `git commit --trailer "Assisted-by: $MINDROOM_ASSISTED_BY"`; if unset,
  `Assisted-by: MindRoom DevAgent:anthropic/claude-opus-5.5 <https://github.com/mindroom-ai/mindroom>`.
  Add files by explicit path. Never `git stash`.

## Review Focus

1. B equal to A after a navigation (the person opens B's card): B must close, not show twice. Test
   in Task 3.
2. A remembered B in a room on a phone-sized viewport: no panel, no menu entry. Test in Task 3.
3. Escape inside B while A fills the page: marks B read, not A. Test in Task 2.
4. Malformed or foreign JSON in `mindroom.secondThread:<user>` (array, number, non-string value):
   ignored, no crash. Test in Task 1.
5. Opening another panel (members) while B shows: B closes and is forgotten, so a reload does not
   bring it back. Test in Task 3.

---

### Task 1: Per-room memory of the second thread

**Files:**
- Modify: `src/app/preferences/accountStorageKeys.ts`
- Create: `src/app/room/useSecondThread.ts`
- Test: `src/app/room/useSecondThread.test.ts`

**Interfaces:**
- Produces: `useSecondThread(roomId: string, userId: string, mainThreadId: string | undefined):
  { threadId: string | undefined; open: (threadId: string) => void; close: () => void }`.
  `threadId` is B for `roomId`, read from storage on the first render with that room; `open`
  stores and shows it; `close` forgets it for that room. When `mainThreadId === threadId`, the hook
  closes B (effect) and returns `threadId: undefined` in that render already.
- Produces: `secondThreadStorageKey`, `secondThreadWidthStorageKey` (both listed in
  `accountStorageKeys`).

- [ ] **Step 1: Write the failing tests** (`renderHook`, real `localStorage`, cleared per test)
  - `remembers B per room across a new hook instance`: open `'$b'` in `'!r1'`, unmount, render
    again for `'!r1'` gives `'$b'`; for `'!r2'` gives `undefined`.
  - `close forgets B in its room only`: open in `!r1` and `!r2`, close in `!r1`; storage JSON is
    `{"!r2":"$b2"}`.
  - `ignores malformed storage`: for each of `'[1]'`, `'3'`, `'{"!r1":5}'`, `'not json'` stored
    under the key, `threadId` is `undefined` and `open('$b')` then stores `{"!r1":"$b"}`.
  - `closes B when it becomes the main thread`: open `'$b'`, rerender with `mainThreadId '$b'`;
    `threadId` is `undefined` and storage lacks `!r1`.
  - In `accountStorageKeys` test (existing file if any, else in this test):
    `accountStorageKeys('@u:x')` contains both new keys.
- [ ] **Step 2: Run** `nix develop -c just test src/app/room/useSecondThread.test.ts`; expect FAIL
  (module missing).
- [ ] **Step 3: Implement.** Use `getSafeLocalStorage`/`getStorageItemSafe`/`setStorageItemSafe`
  from `src/app/lib/safeLocalStorage`. Keep the room's value in `useState`, looked up again when
  `roomId` changes (the `lookedUpIn` pattern of `room/usePluginPanel.ts`).
- [ ] **Step 4: Run** the test; expect PASS.
- [ ] **Step 5: Commit** "Second thread: remember it per room for the account".

### Task 2: Banner Close, shared typing keys, Escape in a second view

**Files:**
- Modify: `src/app/threads/ThreadContextBanner.tsx` (prop `onClose?: () => void`)
- Create: `src/app/room/typeToCompose.ts` (move `OWNS_TYPING_SELECTOR`, `focusOwnsTyping`,
  `isPasteKey`, `isTypingKey` out of `RoomView.tsx` unchanged, exported; `RoomView.tsx` imports
  them)
- Modify: `src/app/room/useRoomEscapeReadReceipts.ts`
- Test: `src/app/threads/ThreadContextBanner.test.ts` (or a new `.close.test.tsx` beside it),
  `src/app/room/useRoomEscapeReadReceipts.test.ts`

**Interfaces:**
- Produces: `ThreadContextBanner` `onClose?: () => void`. Given, the banner's leading button is an
  `IconButton` with `Icons.Cross`, `aria-label` `t('thread.close')`, no shortcut, calling
  `onClose`; Back (`onExitThread`) is not rendered then, also not the phone back button.
- Produces: `noteThreadViewKey(evt: ReactKeyboardEvent, threadId: string): void` in
  `useRoomEscapeReadReceipts.ts`. A WeakMap from native event to thread id. In the window handler,
  after the existing `escape` check and before the column logic: a noted event marks that thread
  read (`markThreadAsRead(mx, roomId, noted, hideActivity)`) and returns. `noteThreadColumnKey`
  and the rest are unchanged.
- Produces: exports of `typeToCompose.ts` named as above.

- [ ] **Step 1: Write failing tests**
  - Banner: `with onClose it offers Close thread in place of Back`: render with `onClose` spy;
    `getByRole('button', { name: 'Close thread' })` click calls it once; no button named Back.
  - Escape: `Escape noted in a second thread view marks that thread read`: route `threadId '$a'`,
    messages beside not shown (A fills); fire a keydown noted with `'$b'`; `markThreadAsRead`
    called with `'$b'`, never with `'$a'`, and `markMainTimelineAsRead` not called.
- [ ] **Step 2: Run** both files; expect FAIL.
- [ ] **Step 3: Implement** the three changes. `RoomView.typeToCompose.test.tsx` must still pass
  unchanged.
- [ ] **Step 4: Run** `nix develop -c just test src/app/threads/ThreadContextBanner
  src/app/room/useRoomEscapeReadReceipts src/app/room/RoomView`; expect PASS.
- [ ] **Step 5: Commit** "Thread banner Close; Escape in a second thread view marks it read".

### Task 3: The second thread side panel in the room page

**Files:**
- Create: `src/app/navigation/secondThread.ts`
- Create: `src/app/room/SecondThreadPanel.tsx`
- Modify: `src/app/room/Room.tsx`
- Test: `src/app/room/Room.secondThread.test.tsx` (copy the mocks of
  `Room.panelBesideThread.test.tsx` / `Room.sidePanels.test.tsx`)

**Interfaces:**
- Produces (`navigation/secondThread.ts`): `type SecondThreadControl = { offers: (rootId: string)
  => boolean; open: (rootId: string) => void }` and
  `SecondThreadContext = createContext<SecondThreadControl | undefined>(undefined)`.
- Produces (`SecondThreadPanel.tsx`): `SecondThreadPanel({ room, threadId, onClose, widthKey })`.
  Renders `ResizablePanel` (constants in Global Constraints, `resizeLabel t('thread.resizeSecond')`,
  `collapseLabel t('thread.close')`, `onCollapse={onClose}`) > a column `div` with
  `onKeyDown` > `ThreadView room threadId header={<ThreadContextBanner room threadId
  onExitThread={onClose} onClose={onClose} />} autoFocus focusRef onThreadLoadError={onClose}`.
  `onKeyDown`: call `noteThreadViewKey(evt, threadId)`; then if not `defaultPrevented`, the key is
  `isTypingKey` or `isPasteKey`, and the focus is on no editable element and not inside
  `focusOwnsTyping()`, call `focusRef.current?.()`. Key `threadId` on `ThreadView` so a new B mounts
  fresh.
- Consumes: Task 1 hook, Task 2 banner prop and helpers.
- Room.tsx: `const second = useSecondThread(roomId, ownUserId, threadId)` (the page's thread);
  panel entry `{ id: 'thread', open: !mobile && !!second.threadId, close: second.close,
  label: t('thread.second'), render: () => <SecondThreadPanel ... /> }` after `members`. Context
  value (memoized), `undefined` when `mobile`: `offers = (id) => isConfirmedMatrixEventId(id) &&
  id !== threadId && id !== second.threadId`; `open = (id) => request('thread', () =>
  second.open(id))`. Provide `SecondThreadContext` around the returned tree. Focus on close: when
  B closes and the focus was inside B's panel (check `document.activeElement` against the panel's
  element before closing, or that it ended on `body`), focus the first
  `[data-testid="thread-column"] [contenteditable="true"]` inside `conversationRef`, else
  `[data-room-footer="true"] [contenteditable="true"]` (selectors RoomView already uses).

- [ ] **Step 1: Write failing tests** (`Room.secondThread.test.tsx`)
  - `Open beside shows the thread in a second column`: render Room for `!r`, route thread `'$a'`;
    from a test consumer of `SecondThreadContext` call `open('$b')`; a `ThreadView` (mock that
    renders `data-thread-view={threadId}`) for `'$b'` is inside `getByTestId('second-thread-panel')`
    and the route thread's view is unchanged.
  - `offers neither the open thread nor the second one`: `offers('$a')` and `offers('$b')` false,
    `offers('$c')` true.
  - `opening the members list closes and forgets B` (Review Focus 5): open `'$b'`, toggle members
    via the header handler the existing tests use; panel gone; storage lacks `!r`.
  - `B that becomes the page's thread closes` (Review Focus 1): rerender with route thread `'$b'`;
    no `second-thread-panel`.
  - `a letter typed in B's column goes to B's composer`: the `ThreadView` mock sets
    `focusRef.current` to a spy; keydown `KeyA` on a non-editable element inside the panel calls
    the spy once; the same key with `defaultPrevented`, or with focus in a `role="menu"`, does not.
  - `phone: no context and no panel` (Review Focus 2): `ScreenSize.Mobile`, storage pre-seeded with
    `{"!r":"$b"}`; consumer sees `undefined`; no `second-thread-panel`.
- [ ] **Step 2: Run** the file; expect FAIL.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** `nix develop -c just test src/app/room/`; expect PASS (all room tests: the
  sibling `Room.*.test.tsx` files may need a mock of `./SecondThreadPanel` if they mock heavy
  children; add it where a suite fails at import).
- [ ] **Step 5: Commit** "Room: a second thread side panel".

### Task 4: "Open beside" in the thread menu

**Files:**
- Modify: `src/app/threads/ThreadActionsMenu.tsx`
- Modify: `src/app/i18n/locales/additions/*.json` (17 files; the four keys of Global Constraints)
- Test: `src/app/threads/ThreadActionsMenu.items.test.tsx`

**Interfaces:**
- Consumes: `SecondThreadContext` (Task 3).
- Entry: `action: 'openBeside'`, `label t('threadActions.openBeside')`, an existing icon that is
  not used by another entry of this menu (for example `Icons.Sidebar` or the panel icons in
  `ui/panels/panelIcons`; not `ShrinkIcon`/`ExpandIcon`), pushed right after `open`, only when
  `useContext(SecondThreadContext)?.offers(rootId)`. `onSelect`: `open(rootId)` then `onClose()`.

- [ ] **Step 1: Write failing tests** in `ThreadActionsMenu.items.test.tsx`
  - `offers Open beside right after Open when the room page does`: wrap in a provider whose
    `offers` returns true; menu item names in order start `['Open', 'Open beside', ...]`.
  - `selecting Open beside opens the thread and closes the menu`: `open` called with the rootId,
    `onClose` called once.
  - `no Open beside without the room page or for a thread it shows`: no provider, and a provider
    whose `offers` returns false: no item named Open beside.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement**; write the locale overlays with a small Python script keeping each
  file's indent.
- [ ] **Step 4: Run** `nix develop -c just test src/app/threads/ThreadActionsMenu
  src/app/i18n`; expect PASS.
- [ ] **Step 5: Commit** "Thread menu: Open beside".

### Task 5: End to end, docs, gates

**Files:**
- Create: `e2e/threads/open-thread-beside.spec.ts` (model on `e2e/threads/agent-thread-column.spec.ts`
  and `e2e/threads/compact-thread-cards.spec.ts`; invented placeholder text only, such as
  "Example thread alpha" and "Example thread beta")
- Modify: `docs/architecture.md` (one line where the thread column / side panels are described;
  edit by hand, no prettier on docs)

- [ ] **Step 1: Write the spec**
  - 1920x1080: room with two threads (alpha, beta). Open alpha, choose Show beside if the banner
    offers it. Open beta's card menu, choose Open beside. Expect `thread-column` and
    `second-thread-panel` visible together and the Compact list visible (three columns).
  - Type "hello beta" in the second panel's composer, Enter: the message shows in the second panel's
    timeline and not in alpha's.
  - Reload: `second-thread-panel` still shows beta.
  - 1280x800: messages hidden, alpha and beta both visible.
  - Close (button "Close thread" in the panel): panel gone, focus in alpha's composer.
  - 390x844 phone context: beta's card menu has no "Open beside".
- [ ] **Step 2: Run** on a private slot (unusual number below 50, check `ss -ltnp` first):
  `nix develop -c bash -c 'scripts/e2e-slot.sh <n> npx playwright test e2e/threads/open-thread-beside.spec.ts --reporter=line'`;
  expect PASS. Bring the slot down after.
- [ ] **Step 3: Gates**, outputs to log files, then grep them:
  `just typecheck`, `just strict`, `NODE_OPTIONS=--max-old-space-size=6144 just lint`, `just test`,
  `just script-tests`, `just license-check`. Check pc load first
  (`cat /proc/loadavg`; above 24, run only focused tests and say so).
- [ ] **Step 4: Commit** "Open beside: end-to-end spec and docs".
