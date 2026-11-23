# Phone Interactive Finger-Following Swipes Design

## Goal

Replace snap/lift-threshold phone swipe gestures across MindRoom Chat with continuous, 1:1 finger-following interactive transitions that match native iOS feel (`UINavigationController` interactive pop and interactive drawers/sheets/overlays). Holding a finger mid-swipe holds the views at that exact position; dragging back or releasing early springs back without side effects; releasing past the commit threshold or with a fast flick finishes the slide smoothly and commits the action once.

## Scope

All phone swipe surfaces in MindRoom Chat:

1. **Thread → Room** (start-edge drag back from an open thread to its room).
2. **Room → Last exited thread** (end-edge drag forward back into `lastExitedThread`).
3. **Sidebar navigation drawer (`PhoneNavDrawer`)** (start-edge drag to open from closed; in-panel drag toward start edge to close from open).
4. **Members sheet (`PhoneMembersSheet`)** (in-panel drag toward end edge to close).
5. **Covering side panels in `Room`** (`SubagentsPanel` list, `PluginSidePanel` e.g. PR panel, `ComputerPanel`, `RoomCanvasPanel`, `CallSidePanel`, `LiveTranscriptPanel`), plus **`SubagentsPanel` inner detail → list / parent run**.
6. **Image viewer (`ImageOverlay` / `ImageViewer`)** (start-edge drag to close at fit zoom `zoom === 1 && !isZooming`, without interfering with horizontal image paging or pinch-to-zoom).

## Architectural Decisions

Consulted Fable and Astra on core architecture; decided:

- **One DOM-level gesture engine + strict priority registry:** Separate visual dragging from application state. A drag moves pixels directly via rAF inline `translate` and `opacity` (zero React/Jotai updates per `touchmove`). Navigation, closing panels, focus transfers, `inert` toggles, and read-receipt visibility happen ONLY after a committed release finishes its settle animation.
- **Retained `copyOf` snapshots for Thread ↔ Room, live layers where already mounted:**
  - `ConversationLayout` stays `collapsed={columnFills}` (unmounted while a thread fills the phone). Commit `4a1d2a2f3` relies on unmounting the room's composer, voice recording slot, `RoomHeaderSlot`, and `RoomTimeline` while a thread fills the screen.
  - Instead, `phonePageSlide.ts` retains one lightweight detached `copyOf(stage)` preview per direction (departing room when entering a thread; departing thread when exiting a thread — both button-triggered and swipe-triggered), keyed by `{ sessionId, roomId, threadId, viewportWidth, viewportHeight }`. On deep links, reloads, or after viewport resize/sign-out (no matching preview), the drag falls back cleanly to a themed surface backdrop (`color.Surface.Container`), never showing another conversation.
  - For Drawer, Members sheet, Covering side panels (`conversationRef` is already mounted behind `HIDDEN_CONVERSATION_STYLE`), `SubagentsPanel` detail, and `ImageOverlay` (portaled over the live page), the underlying layer is live.

## 1. Core Gesture Engine

### Pure Tracker (`src/app/navigation/interactiveSwipeMath.ts`)

A pure, DOM-free state machine for deterministic unit testing with explicit timestamps:

- **Constants:**
  - `EDGE_START_MAX_X = 28` px (exported and shared with `CompactCardSwipe`).
  - `SWIPE_LOCK_SLOP_PX = 10` px (horizontal axis lock threshold; matches `CompactCardSwipe`).
  - `SWIPE_COMMIT_RATIO = 0.35` (commit if `distance >= extent * 0.35`).
  - `SWIPE_FLICK_MIN_PX = 24` px and `SWIPE_FLICK_VELOCITY = 0.45` px/ms (commit on quick flick).
  - `SWIPE_REVERSAL_VELOCITY = -0.3` px/ms (cancel if decisively reversing while `distance < extent * 0.5`).
  - `SWIPE_VELOCITY_WINDOW_MS = 100` ms rolling sample window (`dt <= 0` yields `velocity = 0`).
  - Discrete fallbacks (reduced motion or `extent <= 0` in layout-less test environments): `EDGE_DISCRETE_MIN_PX = 72`, `PANEL_DISCRETE_MIN_PX = 56`, `MAX_VERTICAL_DRIFT = 64`.
- **Axis lock:**
  - Before lock: compute `dx = (x - startX) * axisSign` and `dy = Math.abs(y - startY)`.
  - If `dy > SWIPE_LOCK_SLOP_PX && dy >= Math.abs(dx)`: yield immediately to native vertical scroll (`status = 'yielded'`).
  - If `dx < -SWIPE_LOCK_SLOP_PX`: wrong horizontal direction, yield (`status = 'yielded'`).
  - If `dx >= SWIPE_LOCK_SLOP_PX && dx > dy`: lock (`status = 'locked'`), record `lockX = startX + SWIPE_LOCK_SLOP_PX * axisSign` so smooth drags start at `0px` with zero jump while single-move synthetic jumps preserve full drag offset.
- **Clamped offset:** Once locked, `offset = clamp(0, (x - lockX) * axisSign, extent)` and `progress = extent > 0 ? offset / extent : 0`.
- **Commit evaluation on release:**
  - If `extent <= 0` (no layout / discrete fallback): commit iff `rawDx >= discreteMinPx && maxDriftY <= MAX_VERTICAL_DRIFT`.
  - Otherwise:
    - If `velocity <= SWIPE_REVERSAL_VELOCITY && offset < extent * 0.5` → `false` (cancel).
    - Return `offset >= extent * SWIPE_COMMIT_RATIO || (offset >= SWIPE_FLICK_MIN_PX && velocity >= SWIPE_FLICK_VELOCITY)`.
- **Settle duration:** Remaining distance `remaining = commit ? extent - offset : offset`. Base speed `Math.max(Math.abs(velocity), extent / 240)` (px/ms), clamped to `[120, 260]` ms. Zero when `remaining <= 0`.

### Priority Registry & DOM Hook (`src/app/navigation/interactiveSwipe.ts`)

Replaces independent event races with one ordered registration stack and shared touch coordinator:

- **Priority tiers** (higher wins; within a tier, later mount wins):
  - `OVERLAY = 500` (`ImageOverlay` / `ImageViewer`)
  - `SHEET = 400` (`PhoneMembersSheet` close, open `PhoneNavDrawer` close)
  - `PANEL_INNER = 300` (`SubagentsPanel` detail → list)
  - `PANEL = 200` (covering side panels in `Room.tsx`)
  - `PAGE = 100` (Thread → Room start-edge; Room → Thread end-edge)
  - `DRAWER_OPEN = 50` (closed `PhoneNavDrawer` start-edge)
- **Logical edges & RTL:**
  - `'start'` edge is physical left in LTR and physical right in RTL (`dir === 'rtl'`); `'end'` is the opposite.
  - Edge zone checks `x <= EDGE_START_MAX_X` (physical left) or `x >= window.innerWidth - EDGE_START_MAX_X` (physical right).
- **Eligibility & blocking:**
  - On `touchstart` (single touch only), scan registered entries from highest to lowest priority.
  - For edge registrations: skip when `blockStandaloneWebApp && isIOSStandaloneWebApp()`, when `!within && (imageViewerOpen || phoneLayerOpen)`, when `within` is set and `!within.current?.contains(target)`, or when `hasOpenOverlay(within?.current)`.
  - If a higher-priority entry claims the touch (e.g. `IMAGE_VIEWER` with `within`, or open `PhoneNavDrawer` / `PhoneMembersSheet`), lower entries are never consulted for that touch.
  - For in-panel swipe-away (`zone: 'element'`, attached in capture phase on the panel element), touches inside the panel are owned by that panel's registration so horizontal swipes never bubble through to page/drawer handlers.
- **Scene contract:**
  - Each surface supplies `begin(context): InteractiveSwipeScene | null`.
  - Returning `null` (automatically used when `prefers-reduced-motion: reduce` or when a surface cannot animate interactively) runs the discrete lift-threshold path (`onCommit()` on `touchend` past threshold).
  - A scene provides:
    - `extent: number` (travel distance in px, e.g. `window.innerWidth` or panel width).
    - `update(offsetPx: number, progress: number): void` — called at most once per animation frame during `touchmove`, and synchronously before release decision. Writes inline `translate` (never clobbering CSS `transform`) and `opacity`.
    - `settle(commit: boolean, durationMs: number, currentOffsetPx: number): Promise<void>` — animates from the displayed offset to `commit ? extent : 0` via WAAPI (`cubic-bezier(0.2, 0, 0, 1)`), resolving immediately when `element.animate` is unavailable or `durationMs === 0`.
    - `commit(): void` — invoked once after `settle(true)` resolves.
    - `cleanup(committed: boolean): void` — idempotently removes inline `translate`/`opacity`/`data-swiping`/preview nodes.
- **Safety & interruptions:**
  - Once locked horizontally, call `event.preventDefault()` on cancelable `touchmove` so iOS stops native scroll takeover, and arm a one-shot capture `click` suppressor cleared on the next macrotask after `touchend` so releasing over a link/card does not trigger a click.
  - Any 2nd touch (`touches.length !== 1`), `hasOpenOverlay(within?.current)` becoming true mid-drag, window `resize`, `visibilitychange` to `hidden`, or hook unmount immediately cancels the active gesture (and any in-flight settle animations) and calls `cleanup(false)` synchronously so pinch-zoom and newly opened overlays never fight a stale settle animation.
  - `touchcancel`: for `zone: 'edge'`, reset & `cleanup(false)` immediately (iOS Safari/WKWebView took over its native edge swipe). For `zone: 'element'` (in-panel swipe-away), decide from the last recorded sample so iOS WebKit's cancel-on-fast-flick inside scrollable lists still commits when past threshold (preserving `useSwipeAway.test.tsx`).
- **Backward compatibility:**
  - `useEdgeSwipe`, `useEdgeSwipeBack`, `useEdgeSwipeForward`, and `useSwipeAway` remain exported with their existing signatures (extended with optional interactive `begin` / `scene` options), and `edgeSwipeBackCountAtom` continues to track active back-swipe registrations.

## 2. Thread ↔ Room & `phonePageSlide.ts`

### Preview Snapshot Cache & Draft Redaction (`src/app/navigation/phonePageSlide.ts`)

- In `copyOf(stage)`:
  - Also clear text inside `[contenteditable="true"]` elements so typed Slate drafts are never retained in snapshots.
  - Strip inline `translate` and `data-swiping` on the cloned root/children so a snapshot captured right before/during a swipe starts at rest (`translate: none`).
- Add a small in-memory preview store (`phoneSwipePreview.ts` or in `phonePageSlide.ts`):
  - Two single-entry slots: `roomPreview` (departing room stage copy) and `threadPreview` (departing thread stage copy).
  - Each entry stores `{ copy: HTMLElement, scrolled: [Element, number, number][], key: { sessionId, roomId, threadId, width, height } }`.
  - When `slidePhonePage` slides forward into a thread (`from === 1 && to === 2`), capture/retain the departing room's copy as `roomPreview` (reusing the copy it already built, or cloning before removal — note: clone must not have `animation` or live mutation). Better: keep the detached `copy` node and its `scrolled` array cleanly after the slide ends (or capture a fresh `copyOf(stage)` on transition), discarding any previous entry.
  - When exiting a thread (via Back button or interactive back swipe), retain the departing thread's copy as `threadPreview` keyed to `{ sessionId, roomId, threadId: effectiveThreadId, width, height }`.
  - Clear both previews on session change/sign-out (register in `accountState.ts` reset or compare `sessionId`), a viewport `width` change, or room mismatch. A `height`-only change (a soft keyboard opening and closing) keeps the preview: it is shown only while both `width` and `height` match the viewport, and the clean themed backdrop shows meanwhile, so once the keyboard closes the retained preview shows again at its exact `scrollTop`.

### Scoped Async-Safe Handoff (`claimInteractivePhoneSlide`)

- Because `leaveThread` may call `window.history.back()` or `history.go(-n)` where `popstate` fires asynchronously, a simple boolean "skip next" flag is fragile.
- Export `claimInteractivePhoneSlide({ fromLocationKey, holdElement, timeoutMs = 1000 })` from `phonePageSlide.ts`:
  - Marks an active interactive handoff (`playing = true`, `active = ...`), keeping `holdElement` (the settled preview node, or a subtle stage hold) mounted so the screen does not flash white/thread while waiting for the router.
  - In `withPhonePageSlide`: when the next location change arrives with `state.location.key !== fromLocationKey`, run `listener(state, { ...opts, flushSync: true })` WITHOUT calling `slidePhonePage` (no second slide!), wait one `requestAnimationFrame` for the new view to paint, then remove `holdElement` and release the handoff.
  - Safety net: if no navigation arrives within `timeoutMs`, or the page hides / leaves phone layout, automatically clean up `holdElement` and release the handoff so the UI can never get stuck.

### Thread → Room Interactive Scene (`useRoomViewThreadState.ts` / `phonePageSlide.ts`)

- Registered via `useEdgeSwipeBack` (`priority: PAGE`, `edge: 'start'`).
- On horizontal lock:
  - Locate `[data-phone-stage]`. Set `data-swipe-stage="back"` (sets `overflow: clip; isolation: isolate`).
  - Top elements: `[data-phone-stage] > :not([data-phone-top-bar], [data-page-slide-copy], [data-swipe-preview])`. Add `data-swiping=""` and edge shadow (`box-shadow: 0 0 24px rgb(0 0 0 / 0.24); clip-path: inset(0 -48px)`).
  - Under element: mount matching `roomPreview` (restoring its `scrolled` positions) with `data-swipe-preview="under"` (`position: absolute; inset: 0; pointer-events: none; z-index: -1`), OR a neutral themed surface backdrop (`data-swipe-preview="backdrop"`) if no matching preview exists. Add a subtle dim veil (`opacity: 0.12 * (1 - progress)`).
  - `update(px, p)`: top translates `${px * dirSign}px 0`; under translates `${-0.3 * width * (1 - p) * dirSign}px 0`; dim veil opacity `0.12 * (1 - p)`.
  - On `settle(true)`: first capture departing thread snapshot for `threadPreview` (if not already captured, cloning the clean thread without translate), animate top to `${width * dirSign}px 0` and under to `0 0` + veil to `0`.
  - On `commit()`: call `claimInteractivePhoneSlide` handing over the settled `under` preview (moved on top at `z-index: 2` briefly while React swaps to the room so there is zero flash of the thread!), clean up top's inline translate, and invoke `handleExitThread()`.
  - On `settle(false)` / `cleanup(false)`: animate back to `0` and `-30%`, remove `under` preview (returning `roomPreview` node intact to the cache so a retry still has it!), clear all inline styles and `data-swipe-stage`.

### Room → Last Thread Interactive Scene (`useRoomViewThreadState.ts` / `phonePageSlide.ts`)

- Registered via `useEdgeSwipeForward` (`priority: PAGE`, `edge: 'end'`, enabled when `swipes && !threadId && lastExitedThread?.roomId === roomId`).
- On horizontal lock:
  - Set `data-swipe-stage="forward"` on `[data-phone-stage]`.
  - Under elements: live room (`[data-phone-stage] > :not([data-phone-top-bar], [data-page-slide-copy], [data-swipe-preview])`), translating `0 → -30vw * dirSign`.
  - Over element: matching `threadPreview` (or neutral surface sheet if missing) with `data-swipe-preview="over"` (`position: absolute; inset: 0; pointer-events: none; z-index: 2`, edge shadow), translating `+100vw * dirSign → 0` as `p: 0 → 1`.
  - On `settle(true)` + `commit()`: animate over to `0` and under to `-30vw * dirSign`, save departing room snapshot as `roomPreview`, hand the settled `over` preview to `claimInteractivePhoneSlide`, clean up live room translate, and call `handleSwipeForwardToThread()`.

## 3. Sidebar Navigation Drawer (`PhoneNavDrawer.tsx` & `.css.ts`)

- **CSS additions (`PhoneNavDrawer.css.ts`):**
  - `&[data-swiping]`: `transition: none !important; visibility: visible !important;` on both `Panel` and `Scrim`.
- **Opening (start-edge drag, `priority: DRAWER_OPEN`, enabled when `!open && !backSwipeOn`):**
  - On horizontal lock: set local `peeking = true` (`filled = open || sliding || peeking`, flushed synchronously via `flushSync` or measured after commit so `nav` and `phoneNavSlotAtom` are mounted before measuring width!).
  - Measure `panelWidth = panel.getBoundingClientRect().width` (correctly handles rail-only pages like Threads/Canvases as well as full drawers).
  - Add `data-swiping=""` on `panel` and `scrim`.
  - Note: closed `Panel` has CSS `transform: translateX(-100%)` (LTR) / `translateX(100%)` (RTL). Using CSS `translate` composes additively with `transform`, so `translate: ${offsetPx * dirSign}px 0` moves the closed panel smoothly from `-width` (`offsetPx = 0`) to `0` (`offsetPx = width`)! And `scrim.style.opacity = String(progress)`.
  - `phoneNavDrawerOpenAtom`, `inert`, `aria-expanded`, focus, and Escape remain UNCHANGED during drag.
  - On `settle(true)` + `commit()`: WAAPI animates `panel` to `${panelWidth * dirSign}px 0` and `scrim` to `opacity: 1`; on commit call `movePhoneNavDrawer(true, setOpenNow)` inside `flushSync` while clearing inline `translate`/`opacity` and `data-swiping` in the same frame so the panel's CSS `[data-open]` (`transform: none`) takes over seamlessly with zero jump. Clear `peeking`.
  - On `settle(false)`: WAAPI animates back to `0px 0` (`-100%`) and `opacity: 0`, then clears inline styles, `data-swiping`, and sets `peeking = false`.
- **Closing (in-panel drag toward start edge, `priority: SHEET`, enabled when `open`):**
  - `panel` is open (`transform: none`). `update(px, p)` sets `panel.style.translate = ${-px * dirSign}px 0` and `scrim.style.opacity = String(1 - p)`.
  - On `settle(true)` + `commit()`: WAAPI animates `panel` to `${-panelWidth * dirSign}px 0` and `scrim` to `0`; keep `data-swiping` across the `flushSync(() => setOpen(false))` call so no second CSS transition runs, set `sliding = false` immediately (skipping the 320ms wait), then clear `data-swiping` and inline styles on next frame.

## 4. Members Sheet (`PhoneMembersSheet.tsx` & `.css.ts`)

- **CSS additions (`PhoneMembersSheet.css.ts`):**
  - `&[data-swiping]`: `transition: none !important;` on `Panel` and `Scrim`.
- **Closing (in-panel drag toward end edge, `priority: SHEET`, enabled when `out`):**
  - `update(px, p)` sets `panel.style.translate = ${px * dirSign}px 0` and `scrim.style.opacity = String(1 - p)`.
  - Keep `phoneSheetOpenAtom`, `inert`, and dialog focus intact during drag.
  - On `settle(true)` + `commit()`: WAAPI animates panel to `${panelWidth * dirSign}px 0` and scrim to `0`. Set `swipedDismissRef.current = true` and call `dismiss()`. When `leaving` turns `true` while `swipedDismissRef.current` is set, call `done?.()` immediately instead of waiting `PHONE_SLIDE_OUT_MS` (320ms) or playing a second CSS slide.
  - On `settle(false)`: WAAPI springs panel back to `0` and scrim to `1`, then clears inline styles and `data-swiping`.

## 5. Covering Side Panels (`Room.tsx` + `SubagentsPanel.tsx`)

### Room-Level Covering Panels (`Room.tsx`)

- On phones while `behindPanel` is true, wrap `{sidePanel}` in a dedicated phone host container `<div ref={sidePanelHostRef} className={...}>` (`position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; z-index: 1;`) so even `passthrough={mobile}` panels (`display: contents`) have a single concrete box to translate cleanly!
- Touches that start inside a cross-origin or embedded Canvas iframe, or on the noVNC touchpad of `computer`, stay owned by the embedded surface, as on `main`: no start-edge touch catcher strip is laid over them, since an overlay strip there would steal input from the embedded surface (taps, drags and vertical scrolls along its left edge). A swipe that starts on the panel's own header or footer chrome still closes it interactively.
- Register one Room-level start-edge interactive swipe (`priority: PANEL`, enabled when `mobile && behindPanel && !!shown`):
  - Replaces the plugin-only `useEdgeSwipeBack` in `Room.tsx` and the panel-closing half of `SubagentsPanel`'s `useEdgeSwipeBack`, extending interactive swipe-back uniformly to ALL covering panels (`subagents`, plugin panels e.g. PR panel, `computer`, `canvas`, `call`, `transcript`).
  - Note on `transcript`: closing via header/swipe uses `transcript.close` (which may restore a docked call panel rather than the room conversation). When `shown.id === 'transcript'` and `callInSidePanel` (or transcript restores call), show a neutral themed surface backdrop behind the sliding panel instead of falsely revealing `conversationRef`.
  - For all other covering panels (`subagents`, plugin panels, `computer`, `canvas`, `call`), reveal the already-mounted `conversationRef` underneath during the drag by toggling `data-swipe-under-panel=""` on `conversationRef` (CSS overrides `HIDDEN_CONVERSATION_STYLE`: `position: absolute; inset: 0; flex: none; width: 100%; height: 100%; content-visibility: visible; z-index: 0; pointer-events: none`) while keeping `behindPanel` true and `conversationRef` inert!
  - `update(px, p)`: `sidePanelHostRef` translates `${px * dirSign}px 0` with edge shadow; `conversationRef` translates `${-0.3 * width * (1 - p) * dirSign}px 0`.
  - On `settle(true)` + `commit()`: WAAPI finishes panel to `${width * dirSign}px 0` and under layer to `0`; call the panel's close action (`shown.id === 'transcript' ? transcript.close() : shown.close()`) with a `swipedPanelClose` flag that lets `ResizablePanel` skip its width-collapse animation on phones, then clean up styles.

### `SubagentsPanel` Inner Detail → List / Parent Run (`SubagentsPanel.tsx`)

- When `mobile && !!open`, register an inner start-edge interactive swipe (`priority: PANEL_INNER`, outranking Room's `PANEL`).
- When `open` is truthy on phones, render the list view (or parent `SubagentRunView` for a nested run) in an inert under-layer ONLY while `peekingBack` is true (triggered on horizontal lock, matching the drawer peek pattern) positioned `position: absolute; inset: 0; z-index: 0`, with the active `SubagentRunView` on top (`position: relative; z-index: 1; background: var(--bg-surface)`).
- `update(px, p)`: active `SubagentRunView` container translates `${px * dirSign}px 0` with edge shadow; under layer translates `${-0.3 * width * (1 - p) * dirSign}px 0`.
- On `settle(true)` + `commit()`: finish slide-out, clean up `peekingBack` and styles, and call `back()` (preserving card focus restoration via `returnTo`).
- When `open` is falsy (on the subagents list), `PANEL_INNER` is disabled, so Room's `PANEL` swipe smoothly closes the `SubagentsPanel` revealing the conversation!

## 6. Image Viewer (`ImageOverlay.tsx` & `ImageViewer.tsx`)

- In `ImageOverlay.tsx`:
  - Render `<OverlayBackdrop data-image-viewer-backdrop="" />` inside `Overlay` and pass `edgeSwipeArea={phone ? screenRef : undefined}` to `ImageViewer`; resolve the sibling `[data-image-viewer-backdrop]` element inside the overlay root (or via ref if forwarded) so the interactive swipe fades the backdrop cleanly without altering `folds` internals.
- In `ImageViewer.tsx`:
  - Update `useSwipe` (horizontal image paging) to ignore touches starting within `EDGE_START_MAX_X` of the **logical start edge** (`documentIsRightToLeft() ? x >= innerWidth - EDGE_START_MAX_X : x <= EDGE_START_MAX_X`).
  - Register `useEdgeSwipe` at `priority: OVERLAY` with `within: edgeSwipeArea` and `enabled: edgeCloses` (`!!edgeSwipeArea && zoom === 1 && !isZooming`).
  - `update(px, p)`: `screenRef` (`Modal`) translates `${px * dirSign}px 0` with edge shadow; backdrop `opacity = String(1 - p)`.
  - Multi-touch (2nd finger for pinch) cancels the swipe cleanly and restores `translate` & backdrop `opacity`, letting `useZoom` take over immediately.
  - On `settle(true)` + `commit()`: WAAPI animates `Modal` to `${width * dirSign}px 0` and backdrop to `opacity: 0`, then calls `requestClose()` (existing `useViewerHistoryEntry` consumes the history entry cleanly with no `phonePageSlide`).

## 7. Testing & Verification Strategy

1. **Pure tracker unit tests (`interactiveSwipeMath.test.ts`):** axis lock, vertical scroll yield, wrong-direction yield, lock origin zero-jump, rolling velocity window, `dt === 0` guard, distance commit, flick commit, reversal cancel, settle duration clamping, discrete fallback.
2. **Registry & DOM hook unit tests (`interactiveSwipe.test.tsx`, `useEdgeSwipeBack.test.tsx`, `useEdgeSwipeForward.test.ts`, `useEdgeSwipe.test.tsx`, `useSwipeAway.test.tsx`):** priority arbitration (overlay > sheet > panel-inner > panel > page > drawer-open), blocked high layer never leaks to lower layer, RTL mirroring, `prefers-reduced-motion` discrete fallback, mid-drag `hasOpenOverlay` cancellation, multi-touch cancel, `touchcancel` edge-vs-panel behavior, click suppression after drag.
3. **Surface unit tests:**
   - `phonePageSlide.test.ts`: retained room & thread previews, `[contenteditable]` draft redaction, viewport resize & session invalidation, scoped async `claimInteractivePhoneSlide` handoff (surviving async `popstate`, timeout fallback, zero double-slide).
   - `PhoneNavDrawer.test.tsx`: interactive peek open (atom stays false until commit; cancel unmounts peek & leaves atom/focus/receipts untouched; rail-only width measurement), interactive close without double-slide.
   - `PhoneMembersSheet.test.tsx`: interactive drag close, cancel leaves `phoneSheetOpenAtom` true, commit finishes immediately without 320ms delay.
   - `Room.test.ts` / `SubagentsPanel.test.tsx`: Room-level covering panel interactive swipe reveals `conversationRef` underneath, `SubagentsPanel` detail outranks panel close, cancel leaves `behindPanel` true.
   - `ImageViewer` / `ImageOverlay` tests: modal translates & backdrop fades at fit zoom, disabled when zoomed, pinch cancels drag, paging still works outside edge band.
4. **Build, lint, typecheck, and E2E tests (run on free remote machine via `remote-test.sh`):**
   - `just typecheck`, `just lint`, `npx vite build`
   - Existing + extended phone e2e specs: `phone-room-edge-swipe.spec.ts`, `phone-nav-drawer.spec.ts`, `phone-page-slide.spec.ts`, `phone-members-sheet.spec.ts` — including mid-drag intermediate translation assertions, cancel-on-short-drag assertions, and before/after PR screenshots with placeholder data.
