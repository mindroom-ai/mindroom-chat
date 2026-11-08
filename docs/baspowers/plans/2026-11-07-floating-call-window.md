# Floating Call Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development; seven tasks that hand interfaces to each other, and a shipped mistake breaks every call.

**Goal:** On desktop the call view becomes a floating window that can be moved, resized, minimized to a bar and docked back into the side column, with a hybrid stage (video tiles or a voice stage) inside.

**Architecture:** Pure geometry and a per-account settings store under `src/app/calls/window/`; a frame component that owns pointer and keyboard handling and tells the call view whether it is a bar; a host in `CallFeatures` that shows the frame with the existing lazy `CallPanel` while `callPanelRoomAtom` is set. `room/Room.tsx` keeps the side panel for phones and docked mode. `CallPanel` swaps its tile list for a `CallStage`.

**Tech Stack:** React 18, jotai 2.6, vanilla-extract 1.9 (container queries via `createContainer`), folds 2.7, vitest with jsdom, Playwright.

**Spec:** `docs/baspowers/specs/2026-11-07-floating-call-window-design.md`

## Global Constraints

- Lane C: `just typecheck`, `just strict`, `just lint`, `just test` pass; new files are Lane C.
- Styles use logical sides; the frame's `left` and `top` are physical (it is placed by coordinates) and take an `eslint-disable-next-line` with that reason.
- `PopOut` and `TooltipProvider` come from `src/app/ui/directional.tsx`, never from `folds`.
- No em dashes in docs, comments or commit messages. Comments explain why, in the codebase's full-sentence style.
- Commits unsigned (`git -c commit.gpgsign=false commit`), files added by explicit path, never `git add -A`. Never push.
- `just format <paths>` (Prettier 2.8.8) on every file you wrote.
- The pre-push upstream-overlap hook flags 3 consecutive lines that each exist upstream, generic vanilla-extract property lines included (`flexDirection: 'column',`, `alignItems: 'center',`): put a line of this file's own (a local constant, `flexFlow`, a comment) between generic ones.
- New strings go under `featureUi.calls.window` and `featureUi.calls.stage` in `src/app/i18n/locales/additions/en.json`; Task 6 adds them to every other language.
- Values from the spec: margin 8 px, edge stick 16 px, default 400 by 480 px at 16 px from the bottom and end edges, minimum 340 by 220 px, bar 56 px, bar threshold 120 px, keyboard step 16 px, speaker view under 100 px tiles, voice avatars 64 px (one other) or 48 px (more). Storage key `mindroom.callWindow:<user id>`.
- Never open `FORK_CHANGES.md`, the upstream client or the forbidden clients named in `AGENTS.md`.

## Review Focus

1. A press on a title bar button (Minimize, Close, Dock) clicks it and never starts a move. Test in Task 4.
2. The browser window shrinks below the call window (devtools opened, window snapped to half the screen): the call window stays fully visible and at least partly usable. Tests in Tasks 1 and 4.
3. Storage holds a rectangle from a bigger monitor, junk, or an old shape: the window opens inside the viewport at a sane size. Tests in Tasks 1 and 2.
4. The window was left as a bar when the last call ended: the next ring answer or header click opens it expanded, not as a bar the person may miss. Test in Task 5.
5. The room of the open call view is left or forgotten while the window shows: the window goes away instead of crashing. Test in Task 5.

---

### Task 1: Window geometry

**Files:**
- Create: `src/app/calls/window/callWindowGeometry.ts`
- Test: `src/app/calls/window/callWindowGeometry.test.ts`

**Interfaces:**
- Produces:
  - `type WindowRect = { x: number; y: number; width: number; height: number }` (viewport pixels, `x` from the left edge)
  - `type ViewportSize = { width: number; height: number }`
  - `type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'`
  - constants `WINDOW_MARGIN = 8`, `EDGE_STICK = 16`, `MIN_WIDTH = 340`, `MIN_HEIGHT = 220`, `BAR_HEIGHT = 56`, `BAR_THRESHOLD = 120`, `KEY_STEP = 16`, `DEFAULT_WIDTH = 400`, `DEFAULT_HEIGHT = 480`, `DEFAULT_OFFSET = 16`
  - `defaultRect(viewport: ViewportSize, rtl: boolean): WindowRect`
  - `isBar(rect: WindowRect): boolean` (height <= `BAR_HEIGHT`)
  - `moveRect(start: WindowRect, dx: number, dy: number, viewport: ViewportSize): WindowRect`
  - `resizeRect(start: WindowRect, edge: ResizeEdge, dx: number, dy: number, viewport: ViewportSize): WindowRect`
  - `snapToCorner(rect: WindowRect, viewport: ViewportSize): WindowRect`
  - `clampToViewport(rect: WindowRect, viewport: ViewportSize): WindowRect`
  - `fitToViewport(rect: WindowRect, previous: ViewportSize, next: ViewportSize): WindowRect`
  - `keyStep(rect: WindowRect, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', resize: boolean, viewport: ViewportSize): WindowRect`

- [ ] **Step 1: Write the failing tests** (viewport 1440 by 900 unless named)

```ts
it('places the default window 16 px from the bottom and end edges', () => {
  expect(defaultRect({ width: 1440, height: 900 }, false)).toEqual({ x: 1024, y: 404, width: 400, height: 480 });
  expect(defaultRect({ width: 1440, height: 900 }, true)).toEqual({ x: 16, y: 404, width: 400, height: 480 });
});
it('keeps a moved window 8 px inside and sticks it to an edge within 16 px', () => {
  const start = { x: 500, y: 300, width: 400, height: 480 };
  expect(moveRect(start, -2000, 0, VP).x).toBe(8);
  expect(moveRect(start, -480, 0, VP).x).toBe(8); // 20 px from the edge: sticks
  expect(moveRect(start, -470, 0, VP).x).toBe(30); // 22 px from the margin line: free
  expect(moveRect(start, 0, 5000, VP).y).toBe(900 - 480 - 8);
});
it.each(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const)('resizes from %s and keeps the opposite edge', (edge) => { /* opposite edges unchanged */ });
it('never resizes below 340 px wide', () => { expect(resizeRect(R, 'w', 500, 0, VP).width).toBe(340); });
it('turns into the 56 px bar under 120 px tall and grows back past it', () => {
  expect(resizeRect(R, 's', 0, -400, VP).height).toBe(56);   // 80 px tall: bar
  expect(resizeRect(R, 's', 0, -300, VP).height).toBe(220);  // 180 px: minimum expanded height
  expect(resizeRect({ ...R, height: 56 }, 's', 0, 200, VP).height).toBe(256);
});
it('drops a bar into the nearest corner', () => { /* bar centred left-top goes to (8, 8); right-bottom to (W-w-8, H-56-8) */ });
it('fits a stored rectangle from a bigger screen inside the viewport', () => {
  expect(clampToViewport({ x: 2400, y: 1300, width: 3000, height: 2000 }, VP)).toEqual({ x: 8, y: 8, width: 1424, height: 884 });
});
it('keeps the distance to the nearer edges when the viewport changes', () => {
  // 16 px from right and bottom before; 16 px from right and bottom after.
  expect(fitToViewport({ x: 1024, y: 404, width: 400, height: 480 }, VP, { width: 1000, height: 700 })).toEqual({ x: 584, y: 204, width: 400, height: 480 });
});
it('shrinks to the viewport less the margins when the viewport is smaller than the window', () => { /* 300 by 200 viewport: width 284, height 184, x 8, y 8 */ });
it('moves 16 px per arrow and resizes with Shift, inside the viewport', () => { /* keyStep cases */ });
```

- [ ] **Step 2:** Run `npx vitest run src/app/calls/window/callWindowGeometry.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement the module. Resizing: apply the deltas to the dragged edges; clamp width to `[min(MIN_WIDTH, viewport.width - 2*WINDOW_MARGIN), space to the margin on the dragged side]`; for height, a raw height under `BAR_THRESHOLD` becomes `BAR_HEIGHT`, between `BAR_THRESHOLD` and `MIN_HEIGHT` becomes `MIN_HEIGHT`; the edge opposite the dragged one stays put. `clampToViewport` caps the size to the viewport less both margins (but not under `BAR_HEIGHT` tall), then clamps the position. `fitToViewport` anchors each axis to the edge the window's centre was nearer to in `previous`, then clamps.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(calls): rectangle math for a floating call window`.

### Task 2: Per-account window settings

**Files:**
- Create: `src/app/calls/window/callWindowState.ts`
- Modify: `src/app/account/lifecycle/sessionCleanup.ts` (call the clear beside `clearRecentlyOpenedPanelHeightStore(userId)`), `src/app/account/lifecycle/sessionCleanup.test.ts`
- Test: `src/app/calls/window/callWindowState.test.ts`

**Interfaces:**
- Consumes: `WindowRect`, `isBar` from Task 1.
- Produces:
  - `type CallWindowMode = 'floating' | 'docked'`
  - `type CallWindowSettings = { mode: CallWindowMode; rect?: WindowRect; expandedHeight?: number }`
  - `callWindowStorageKey(userId: string): string` returns `mindroom.callWindow:${userId}`
  - `normalizeCallWindowSettings(value: unknown): CallWindowSettings` (anything malformed gives `{ mode: 'floating' }`; a rect with a non-finite or non-positive field is dropped)
  - `getCallWindowSettingsAtom(userId: string): WritableAtom<CallWindowSettings, [CallWindowSettings], void>` (one atom per account through `createUserScopedAtomRegistry`, modelled on `src/app/preferences/recentlyOpenedPanelHeight.ts`; reads with `getLocalStorageItem`, writes with `setLocalStorageItem`)
  - `useCallWindowSettings(): readonly [CallWindowSettings, (next: CallWindowSettings) => void]` for the signed-in account (`useMatrixClient().getSafeUserId()`)
  - `minimizedSettings(settings: CallWindowSettings, rect: WindowRect): CallWindowSettings` (rect becomes `BAR_HEIGHT` tall at the same bottom edge, `expandedHeight` keeps the old height)
  - `expandedSettings(settings: CallWindowSettings, rect: WindowRect, viewport: ViewportSize): CallWindowSettings` (height back to `expandedHeight ?? DEFAULT_HEIGHT`, growing upward from the bar's bottom, then `clampToViewport`)
  - `clearCallWindowStore(userId: string): void`

- [ ] **Step 1: Write the failing tests:** `normalizeCallWindowSettings` with `null`, `'x'`, `{ mode: 'side' }`, `{ mode: 'docked' }`, a rect with `NaN`; the atom reads what storage holds and writes JSON under `mindroom.callWindow:@a:x`; minimize then expand gives the old height back and keeps the bottom edge; `clearCallWindowStore` removes the key; `sessionCleanup` calls `clearCallWindowStore` with the user id.
- [ ] **Step 2:** Run `npx vitest run src/app/calls/window/callWindowState.test.ts src/app/account/lifecycle/sessionCleanup.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(calls): remember the call window's mode, place and size per account`.

### Task 3: The stage (video tiles or voice)

**Files:**
- Create: `src/app/calls/stageLayout.ts`, `src/app/calls/CallStage.tsx`, `src/app/calls/CallStage.css.ts`
- Modify: `src/app/calls/CallPanel.tsx` (the `<ul className={css.Tiles}>` block becomes `<CallStage …/>`; camera and screen share buttons no longer depend on `!agentCall`), `src/app/calls/CallPanel.css.ts` (drop `Tiles` if unused), `src/app/i18n/locales/additions/en.json`
- Test: `src/app/calls/stageLayout.test.ts`, `src/app/calls/CallStage.test.tsx`, existing `src/app/calls/*.test.tsx` that assert agent controls

**Interfaces:**
- Consumes: `CallParticipant` from `RoomCall.ts`; `CallTile`, `ScreenTile`, `CallMemberAvatar` from `CallTile.tsx`.
- Produces:
  - `SPEAKER_VIEW_MIN_TILE = 100`
  - `fitTiles(count: number, width: number, height: number, gap: number): { columns: number; tileWidth: number; tileHeight: number; size: number }`
  - `hasVideo(participants: CallParticipant[]): boolean` (any `video` or `screen`)
  - `pickFocus(participants: CallParticipant[], previous: string | undefined): string | undefined` returns a tile key: `${key}:screen` of the first participant sharing a screen; else the first speaking remote's key; else `previous` while that key is still present; else the first remote's key; else the first key
  - `CallStage(props: { room: Room; participants: CallParticipant[]; awaited?: CallParticipant; speakerView: boolean; microphone: boolean })`; `speakerView` is the person's pick, the stage adds the screen and size reasons itself. Root carries `data-call-stage="video" | "voice"` and `data-speaker-view` when speaker view shows.

`fitTiles` body (the choice the tests pin):

```ts
let best = { columns: 1, cw: 0, ch: 0, size: 0 };
for (let columns = 1; columns <= count; columns += 1) {
  const rows = Math.ceil(count / columns);
  const cw = (width - gap * (columns - 1)) / columns;
  const ch = (height - gap * (rows - 1)) / rows;
  const size = Math.min(cw, (ch * 4) / 3);
  if (size > best.size) best = { columns, cw, ch, size };
}
const tileWidth = Math.min(best.cw, (best.ch * 16) / 9);
return { columns: best.columns, tileWidth, tileHeight: Math.min(best.ch, tileWidth), size: best.size };
```

- [ ] **Step 1: Write the failing tests.** `stageLayout.test.ts`: four tiles in 384 by 189 give 2 columns, tile about 162.7 by 91.5 (`toBeCloseTo`); one tile in 600 by 200 is 355 wide at most (16:9 cap); four tiles in 300 by 120 have `size < SPEAKER_VIEW_MIN_TILE`; `pickFocus` with a screen, with a speaking remote, keeping `previous`, falling back to the first remote. `CallStage.test.tsx` (jsdom, mock `ResizeObserver` to report the size the case needs): no video shows `data-call-stage="voice"` with one 64 px avatar and no name for one other participant, names for two others; the status reads "Mind is speaking" while Mind speaks, "You are muted" with the microphone off, else "Listening"; a camera on shows `data-call-stage="video"` with a tile per participant (`data-call-tile`); a screen share shows speaker view with the screen in focus and the own camera inset (`data-call-inset`); `speakerView` true shows speaker view; the awaited agent shows on the voice stage, waiting.
- [ ] **Step 2:** Run `npx vitest run src/app/calls/stageLayout.test.ts src/app/calls/CallStage.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. The stage measures itself with `ResizeObserver` (8 px padding, 6 px gap), keeps the last focus key in a ref for `pickFocus`, renders `CallTile` and `ScreenTile` unchanged (their `data-call-tile`, `data-call-screen` attributes stay: e2e reads them), a faces row of `CallMemberAvatar` size `200` in speaker view, the inset as a small `CallTile` of the local participant. Voice stage bars animate with a keyframe only while someone speaks, and stop under `prefers-reduced-motion`. Shorter stages drop the status line, then the names, then the bars: `createContainer` plus `'@container'` queries as in `room/RoomView.css.ts`. Strings: `featureUi.calls.stage.speaking` ("{{name}} is speaking"), `listening` ("Listening"), `muted` ("You are muted").
- [ ] **Step 4:** Run the two tests and `npx vitest run src/app/calls`. Expected: PASS (update assertions that expected agent calls without camera or screen share).
- [ ] **Step 5:** Commit `feat(calls): video tiles or a voice stage, with speaker view and the own camera inset`.

### Task 4: The floating frame

**Files:**
- Create: `src/app/calls/window/FloatingCallWindow.tsx`, `src/app/calls/window/FloatingCallWindow.css.ts`, `src/app/calls/window/callWindowFrame.ts`
- Test: `src/app/calls/window/FloatingCallWindow.test.tsx`

**Interfaces:**
- Consumes: Task 1 geometry; Task 2 `useCallWindowSettings`, `minimizedSettings`, `expandedSettings`.
- Produces:
  - `type CallWindowFrame = { bar: boolean; minimize: () => void; expand: () => void }`
  - `CallWindowFrameContext` and `useCallWindowFrame(): CallWindowFrame | undefined` in `callWindowFrame.ts` (undefined outside the floating frame: docked panel, phones)
  - `FloatingCallWindow(props: { label: string; children: ReactNode })`: a `section` with `aria-label={label}`, `data-testid="call-window"`, `data-bar` while a bar. The drag handle is any descendant with `data-call-window-handle` (the call view's title bar); presses on a `button`, `a`, `input` or `[role="menuitem"]` inside it do not move the window.

- [ ] **Step 1: Write the failing tests** (jsdom; stub `PointerEvent` as a `MouseEvent` subclass with `pointerId`, and `setPointerCapture`, `releasePointerCapture`, `hasPointerCapture` on `HTMLElement.prototype`; viewport 1440 by 900 via `window.innerWidth`/`innerHeight`):
  - with no stored settings the section sits at `left: 1024px; top: 404px`, 400 by 480;
  - a drag of the handle by (-300, -200) moves it to (724, 204) and stores that rect on pointer up;
  - a press on a button inside the handle followed by a move does not move the window, and the button's click handler runs;
  - dragging the `se` handle by (-60, -40) gives 340 by 440; dragging `s` up past the threshold sets `data-bar`;
  - `minimize()` from the context makes a 56 px bar at the same bottom edge; `expand()` restores 480;
  - a bar released after a drag lands in the nearest corner;
  - with the handle focused, ArrowLeft moves 16 px left and Shift+ArrowUp makes it 16 px shorter;
  - a `resize` event to 1000 by 700 keeps the window 16 px from the right and bottom edges;
  - `pointercancel` mid-drag stores the rect where it stands.
- [ ] **Step 2:** Run `npx vitest run src/app/calls/window/FloatingCallWindow.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. Hold the live rect in state during a drag and write settings on pointer up or cancel (not per move). Read the stored rect through `clampToViewport` on mount, falling back to `defaultRect(viewport, document.dir === 'rtl')`. The handle element gets `tabIndex={0}` and `aria-label={t('featureUi.calls.window.move')}` ("Move call window") through the frame (set them from the frame's effect on the first `[data-call-window-handle]`, or let the call view spread `frame.handleProps`; pick one and test it). Eight `aria-hidden` handle spans with resize cursors sit just outside the box. `position: fixed`, `zIndex: 999` (one under the ring host in `IncomingCalls.css.ts`, which is 1000; check that folds' modal overlays and the settings dialog draw above 999, and lower the value under theirs if not), the frame's box shows the call view filling it with the panel's surface, radius and shadow. Physical `left` and `top` with the disable comment from Global Constraints.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(calls): a floating frame that moves, resizes, minimizes and fits the viewport`.

### Task 5: Host, docking and the call view's title bar

**Files:**
- Create: `src/app/calls/CallPanelPart.tsx` (move `CallPanelUnavailable` and the lazy `CallPanel` part out of `src/app/room/Room.tsx`), `src/app/calls/window/CallWindowHost.tsx`
- Modify: `src/app/calls/CallFeatures.tsx` (render `<CallWindowHost />`), `src/app/room/Room.tsx` (import the part; the call panel entry is `open: callOpen && (mobile || mode === 'docked')`), `src/app/calls/CallPanel.tsx` and `.css.ts` (title bar: handle attribute, buttons, bar content), `src/app/calls/ActiveCallTab.tsx`, `src/app/i18n/locales/additions/en.json`
- Test: `src/app/calls/window/CallWindowHost.test.tsx`, `src/app/room/Room.sidePanels.test.tsx`, `src/app/room/Room.callPanelUnavailable.test.tsx`, `src/app/calls/CallPanel.window.test.tsx`, `src/app/calls/ActiveCallTab.test.tsx` (new or existing)

**Interfaces:**
- Consumes: `CallStage`, `hasVideo` (Task 3); `FloatingCallWindow`, `useCallWindowFrame` (Task 4); `useCallWindowSettings`, `expandedSettings` (Task 2); `callPanelRoomAtom`, `useActiveCall`, `callHomeRoomId` (`callStore.ts`); `useRoomNavigate` (`navigation`); `usePowerLevels`, `PowerLevelsContextProvider` (`matrix/hooks/usePowerLevels`).
- Produces: `CallPanelPart` (the lazy part, same props as `CallPanel`) and `CallPanelUnavailable` exported from `CallPanelPart.tsx`; `CallWindowHost()`.

Behavior to build (spec "Where the call view shows" and "Inside the call view"):

- Host: renders only when the screen is not `ScreenSize.Mobile`, the mode is `floating`, `callPanelRoomAtom` is set and `mx.getRoom` finds it; wraps `<Suspense fallback={null}><CallPanelPart room onClose/></Suspense>` in `PowerLevelsContextProvider value={usePowerLevels(room)}` inside `FloatingCallWindow` labelled with the room name. When `callPanelRoomAtom` changes to a room (from none or another room) and the stored rect is a bar, it expands it.
- Title bar (`PanelShell` header gets `data-call-window-handle`): speaker or grid toggle (video stage only; `featureUi.calls.window.speakerView` "Speaker view" / `gridView` "Grid view"), open conversation (agent calls with `origin`; `openConversation` "Go to the conversation"; `navigateRoomThread` or `navigateRoom`), dock or float on desktop (`dock` "Dock to the side": mode `docked` then navigate to `callHomeRoomId` and the origin thread; `float` "Float": mode `floating`), minimize when `useCallWindowFrame()` is set (`minimize` "Minimize"), close as today. A title bar narrower than its buttons drops the speaker switch first (container query on the header).
- Bar (`frame.bar`): up to three avatars of the remote participants (`CallMemberAvatar` size `200`, the speaking one ringed), title and status, microphone and leave while joined, Expand (`expand` "Expand"). Prescreen bar: title and Expand only.
- `ActiveCallTab`: in floating mode on desktop it sets `callPanelRoomAtom` to the home room and expands a bar, without navigating; otherwise as today.

- [ ] **Step 1: Write the failing tests.** Host: shows `call-window` on desktop in floating mode with the panel room set; nothing on phones, nothing when docked, nothing when the room is unknown; stays when the router location changes (`<MemoryRouter>` per memory note `data-router-jsdom-abortsignal`); a stored bar opens expanded when the panel room is set. Room side panels: the call panel opens on phones and in docked mode, not in floating mode on desktop. Chunk failure: the window shows "This couldn't load" with End and Close. CallPanel: the speaker toggle shows only with video and flips `data-speaker-view`; dock writes `docked` and navigates; float writes `floating`; minimize shows only inside the frame; the bar shows mic and leave while joined. ActiveCallTab: floating mode does not navigate and expands a bar.
- [ ] **Step 2:** Run the new and changed test files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/app/calls src/app/room`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(calls): the call view floats on desktop and docks into the side column on request`.

### Task 6: Translations

**Files:**
- Modify: `src/app/i18n/locales/additions/{ar,bn,de,es,fr,hi,id,it,ja,ko,nl,pt,ru,tr,zh,zh-TW}.json`

- [ ] **Step 1:** Run `npx vitest run src/app/i18n/localeAdditions.test.ts`. Expected: FAIL, the overlays lack the new `featureUi.calls.window.*` and `featureUi.calls.stage.*` keys.
- [ ] **Step 2:** Add natural translations of every new English key to each file, keeping `{{name}}` placeholders.
- [ ] **Step 3:** Run `npx vitest run src/app/i18n`. Expected: PASS.
- [ ] **Step 4:** Commit `i18n(calls): the call window's strings in every app language`.

### Task 7: End-to-end

**Files:**
- Create: `e2e/calls/call-window.spec.ts`
- Modify: `e2e/calls/calls.spec.ts` (the chunk-failure test finds the fallback under `getByTestId('call-window')`), any other spec that reads `resizable-call-panel` on desktop (`git grep -n "resizable-call-panel" e2e`)

- [ ] **Step 1: Write the spec** with the helpers `e2e/calls/calls.spec.ts` uses (register, room, sign in): the header call button opens `call-window` with the prescreen (`call-panel` inside); dragging the title bar by (-200, -150) moves the box by that much; dragging the bottom-right handle makes it bigger; Minimize sets `data-bar`, Expand clears it; Dock shows `resizable-call-panel` and hides the window, Float brings it back; opening another room keeps the window; a reload keeps its box (within 1 px).
- [ ] **Step 2:** Run `just hs-up`, then `scripts/e2e-slot.sh 41 --rtc just e2e e2e/calls/call-window.spec.ts` (the call buttons need the call service). Expected: PASS. Then `scripts/e2e-slot.sh 41 --rtc just e2e e2e/calls/calls.spec.ts`. Expected: PASS.
- [ ] **Step 3:** Run `just typecheck && just strict && just lint && just test`. Expected: all pass.
- [ ] **Step 4:** Commit `test(e2e): the floating call window moves, resizes, minimizes, docks and stays put`.
