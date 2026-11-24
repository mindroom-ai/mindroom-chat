# Phone Interactive Finger-Following Swipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development — five well-bounded, sequential tasks sharing clean interfaces, executed by fresh `gemini4_neon@high` (`minimal: true`) subagents on one branch (`feat/phone-interactive-edge-swipe`), followed by full verification, screenshots, and full-diff reviews by `opus`, `astra`, and `sol`.

**Goal:** Replace discrete lift-threshold phone swipes with continuous 1:1 finger-following interactive transitions across all phone swipe surfaces (Thread ↔ Room, Sidebar drawer open/close, Members sheet close, Covering room side panels + Subagents detail, and Image viewer).

**Architecture:** One pure, DOM-free swipe tracker (`interactiveSwipeMath.ts`) plus a priority-ordered DOM gesture coordinator (`interactiveSwipe.ts`) driving direct rAF inline `translate` and `opacity` with WAAPI settle animations and zero React re-renders per `touchmove`. State mutations (navigation, panel close, focus, `inert`, read-receipt visibility) occur strictly after a committed release finishes settling; `phonePageSlide.ts` retains lightweight detached `copyOf` previews and provides an async-safe scoped handoff so committed swipes never double-animate.

**Tech Stack:** TypeScript, React 18, Jotai, vanilla-extract CSS, Web Animations API (WAAPI), Vitest (jsdom), Playwright E2E.

**Spec:** `docs/baspowers/specs/2026-11-22-phone-interactive-edge-swipe-design.md`

## Global Constraints

- Zero React/Jotai state updates per `touchmove`; write inline `translate` (never overwrite CSS `transform`) and `opacity` via rAF, clearing all inline styles and attributes in one idempotent `cleanup()`.
- Never flip global visibility atoms (`phoneNavDrawerOpenAtom`, `phoneSheetOpenAtom`, `conversationUnderThreadAtom`, `conversationBehindPanelAtom`), move focus, or trigger navigation/read receipts before a committed release.
- Respect `prefers-reduced-motion: reduce` (discrete lift-threshold fallback, no spatial animation) and RTL (`dir="rtl"` logical start/end edges).
- Keep `EDGE_START_MAX_X = 28` shared with `CompactCardSwipe`; maintain `edgeSwipeBackCountAtom` accuracy and existing hook signatures.
- Never `git stash`; never run `env`/`printenv`/`set`; run heavy tests/builds on a free remote runner (`remote-test.sh m5`) rather than overloading `pc`; add `Assisted-by: MindRoom DevAgent:<model id> <https://github.com/mindroom-ai/mindroom>` trailer to every commit.

## Review Focus

1. **Async `popstate` double-slide:** `leaveThread` may call `window.history.back()` / `history.go(-n)` asynchronously; `claimInteractivePhoneSlide` must stay armed until the new location arrives (or timeout), suppressing `slidePhonePage` without stranding the hold overlay. (Pinned in Task 2.)
2. **Cancelled drag side effects:** A cancelled drag on Thread, Drawer, Members sheet, Side panel, or Image viewer must leave atoms, focus, scroll, drafts, history length, and read-receipt state unchanged and remove every inline style / `data-swiping` attribute / preview node. (Pinned in Tasks 2–5.)
3. **Overlay / multi-touch / rotation mid-drag:** A dialog opening mid-drag (`hasOpenOverlay`), a 2nd finger (pinch in ImageViewer), window resize, or `visibilitychange` (hidden) must cleanly abort the drag and restore all elements. (Pinned in Tasks 1 & 5.)
4. **Priority blocking without fall-through:** When a higher layer owns or blocks a touch (e.g. open `PhoneNavDrawer`, zoomed `ImageViewer`, `SubagentsPanel` detail view, or open modal), lower layers must never receive or act on that touch. (Pinned in Tasks 1, 4 & 5.)
5. **Layout-less / synthetic single-tick tests (`dt === 0`, `extent === 0`):** Unit tests and WebKit synthetic dispatches deliver events with zero elapsed time and zero `getBoundingClientRect().width`; tracker must guard `dt <= 0` and fall back cleanly to discrete thresholds so existing unit & e2e tests keep passing. (Pinned in Task 1.)

---

### Task 1: Core Interactive Swipe Engine, Priority Registry & Hooks

**Files:**

- Create: `src/app/navigation/interactiveSwipeMath.ts`
- Create: `src/app/navigation/interactiveSwipeMath.test.ts`
- Create: `src/app/navigation/interactiveSwipe.ts`
- Create: `src/app/navigation/interactiveSwipe.css.ts`
- Create: `src/app/navigation/interactiveSwipe.test.tsx`
- Modify: `src/app/navigation/useEdgeSwipe.ts`
- Modify: `src/app/navigation/useEdgeSwipeBack.ts`
- Modify: `src/app/navigation/useEdgeSwipeForward.ts`
- Modify: `src/app/navigation/useSwipeAway.ts`
- Modify: `src/app/navigation/useSwipeAway.test.tsx` (verify existing cases + add interactive tracking cases)

**Interfaces:**

- Produces (`src/app/navigation/interactiveSwipeMath.ts`):
  - `EDGE_START_MAX_X = 28`, `SWIPE_LOCK_SLOP_PX = 10`, `SWIPE_COMMIT_RATIO = 0.35`, `SWIPE_FLICK_MIN_PX = 24`, `SWIPE_FLICK_VELOCITY = 0.45`, `SWIPE_REVERSAL_VELOCITY = -0.3`, `SWIPE_VELOCITY_WINDOW_MS = 100`, `EDGE_DISCRETE_MIN_PX = 72`, `PANEL_DISCRETE_MIN_PX = 56`, `MAX_VERTICAL_DRIFT = 64`
  - `export type SwipeTrackerState = 'pending' | 'locked' | 'yielded'`
  - `export interface SwipeTracker { readonly state: SwipeTrackerState; readonly offset: number; readonly progress: number; readonly velocity: number; move(x: number, y: number, timeMs: number, extent: number): SwipeTrackerState; shouldCommit(extent: number): boolean; settleDurationMs(commit: boolean, extent: number): number; }`
  - `export function createSwipeTracker(opts: { startX: number; startY: number; startTimeMs: number; axisSign: 1 | -1; discreteMinPx: number }): SwipeTracker`
- Produces (`src/app/navigation/interactiveSwipe.ts`):
  - `export const SWIPE_PRIORITY = { DRAWER_OPEN: 50, PAGE: 100, PANEL: 200, PANEL_INNER: 300, SHEET: 400, OVERLAY: 500 } as const`
  - `export type InteractiveSwipeScene = { extent: number; update(offsetPx: number, progress: number): void; settle(commit: boolean, durationMs: number, currentOffsetPx: number): Promise<void>; commit(): void; cleanup(committed: boolean): void }`
  - `export function animateSwipeElements(animations: ReadonlyArray<{ element: HTMLElement; keyframes: Keyframe[] }>, durationMs: number): Promise<void>`
  - `export function isReducedMotion(): boolean`
  - `export function resolveLogicalDirectionSign(element?: Element | null): 1 | -1` (returns `1` in LTR, `-1` in RTL)
  - `export function useInteractiveSwipe(opts: { zone: 'edge' | 'element'; edge: 'start' | 'end'; direction: 'inward' | 'toward-edge'; priority: number; enabled: boolean; elementRef?: RefObject<HTMLElement>; within?: RefObject<Element>; blockStandaloneWebApp?: boolean; cancelCommits?: boolean; onCommit: () => void; begin?: (ctx: { axisSign: 1 | -1; dirSign: 1 | -1 }) => InteractiveSwipeScene | null }): void`
- Produces (updated wrappers preserving existing signatures + optional `priority` and `begin`):
  - `useEdgeSwipe({ direction, enabled, onSwipe, blockStandaloneWebApp, within, priority, begin })`
  - `useEdgeSwipeBack(onBack, enabled, options?: { blockStandaloneWebApp?: boolean; priority?: number; begin?: ... })`
  - `useEdgeSwipeForward(onForward, enabled, options?: { priority?: number; begin?: ... })`
  - `useSwipeAway(ref, edge, onSwipe, options?: { enabled?: boolean; priority?: number; begin?: ... })`

- [ ] **Step 1: Write unit tests for `interactiveSwipeMath.ts` (`src/app/navigation/interactiveSwipeMath.test.ts`)**
      Cover: axis lock at 10 px with zero-jump origin, vertical scroll yield, wrong-direction yield, clamped offset/progress, rolling 100 ms velocity window, `dt === 0` safety, commit at >=35% extent, commit on fast flick (>=24 px & >=0.45 px/ms), cancel on reversal (<= -0.3 px/ms & <50%), settle duration clamping `[120, 260]` ms, discrete fallback when `extent === 0`.
- [ ] **Step 2: Implement `src/app/navigation/interactiveSwipeMath.ts`**
      Pure TypeScript, zero DOM access.
- [ ] **Step 3: Write `src/app/navigation/interactiveSwipe.css.ts`, `src/app/navigation/interactiveSwipe.ts`, and update `useEdgeSwipe.ts`, `useEdgeSwipeBack.ts`, `useEdgeSwipeForward.ts`, `useSwipeAway.ts`**
  - Implement global priority registry with single window capture/bubble touch arbitration + element capture for `zone: 'element'`.
  - Use rAF coalescing for `scene.update()` (flushing latest point synchronously on `touchend`), `event.preventDefault()` once locked when cancelable, one-shot capture click suppression after a locked drag, WAAPI `animateSwipeElements` helper (`cubic-bezier(0.2, 0, 0, 1)`), mid-drag abort on `hasOpenOverlay`, 2nd touch, `resize`, `visibilitychange`, unmount, and `touchcancel` (instant reset for `edge`, last-sample commit check for `element` when `cancelCommits` is true).
  - Keep `edgeSwipeBackCountAtom` in `useEdgeSwipeBack.ts` unchanged in semantics.
- [ ] **Step 4: Write `src/app/navigation/interactiveSwipe.test.tsx` and run all navigation unit tests**
      Test priority arbitration (overlay > sheet > panel-inner > panel > page > drawer-open), blocked higher layer never falls through, RTL logical edges, `prefers-reduced-motion` discrete fallback, mid-drag `hasOpenOverlay` cancel, 2nd finger cancel, click suppression after drag, and existing `useEdgeSwipe.test.tsx`, `useEdgeSwipeBack.test.tsx`, `useEdgeSwipeForward.test.ts`, `useSwipeAway.test.tsx`.
- [ ] **Step 5: Commit Task 1**

---

### Task 2: `phonePageSlide` Preview Cache, Async-Safe Handoff & Thread ↔ Room Interactive Scenes

**Files:**

- Modify: `src/app/navigation/phonePageSlide.ts`
- Modify: `src/app/navigation/phonePageSlide.css.ts`
- Modify: `src/app/navigation/phonePageSlide.test.ts`
- Modify: `src/app/shell/accountState.ts` (clear retained previews on account switch/reset)
- Modify: `src/app/room/useRoomViewThreadState.ts`
- Modify: `src/app/room/useRoomViewThreadState.test.tsx`

**Interfaces:**

- Consumes: `useEdgeSwipeBack`, `useEdgeSwipeForward`, `SWIPE_PRIORITY`, `animateSwipeElements`, `InteractiveSwipeScene` from Task 1.
- Produces (`src/app/navigation/phonePageSlide.ts`):
  - `export type PhoneSwipePreviewKey = { sessionId: string; roomId: string; threadId?: string }`
  - `export function capturePhoneSwipePreview(kind: 'room' | 'thread', key: PhoneSwipePreviewKey): void`
  - `export function clearPhoneSwipePreviews(): void`
  - `export function createThreadBackSwipeScene(opts: { key: PhoneSwipePreviewKey; fromLocationKey: string; onCommit: () => void }): InteractiveSwipeScene | null`
  - `export function createThreadForwardSwipeScene(opts: { key: PhoneSwipePreviewKey; fromLocationKey: string; onCommit: () => void }): InteractiveSwipeScene | null`
  - `export function claimInteractivePhoneSlide(opts: { fromLocationKey: string; holdElement?: HTMLElement; timeoutMs?: number }): () => void`

- [ ] **Step 1: Extend `copyOf` and add retained preview cache + `claimInteractivePhoneSlide` in `src/app/navigation/phonePageSlide.ts` & `phonePageSlide.css.ts`**
  - In `copyOf`: also clear text inside `[contenteditable="true"]` (Slate drafts) and strip inline `translate`/`data-swiping`.
  - Retain `roomPreview` automatically when `slidePhonePage` slides forward (`from === 1 && to === 2`) and via `capturePhoneSwipePreview`; retain `threadPreview` when exiting a thread (`from === 2 && to === 1`) and via `capturePhoneSwipePreview`. Key by `{ sessionId, roomId, threadId, width, height }`; invalidate on mismatch, resize, or `clearPhoneSwipePreviews()`.
  - Implement `claimInteractivePhoneSlide` integrated with `withPhonePageSlide`: suppresses `slidePhonePage` for the one navigation leaving `fromLocationKey` (surviving async `history.back()`/`history.go(-n)` `popstate`), holds `holdElement` over the stage through `flushSync` + 1 rAF paint, and auto-releases on `timeoutMs` (1000 ms), `visibilitychange` (hidden), or stage disconnect.
  - Add `[data-swipe-stage]` / `[data-swipe-preview]` / `[data-swipe-dim]` CSS rules in `phonePageSlide.css.ts` (top bar stays fixed, shadow on top page, `-30vw` parallax on under page, neutral themed surface backdrop fallback when no preview matches).
- [ ] **Step 2: Implement `createThreadBackSwipeScene` and `createThreadForwardSwipeScene` and wire into `src/app/room/useRoomViewThreadState.ts`**
  - Pass `begin` scenes to `useEdgeSwipeBack` (Thread → Room) and `useEdgeSwipeForward` (Room → Last Thread), keeping `useRoomViewThreadState.ts` clean and concise.
  - On back commit: capture clean thread snapshot into `threadPreview` before navigating, hand settled room preview/backdrop to `claimInteractivePhoneSlide`, call `handleExitThread()`.
  - On forward commit: capture clean room snapshot into `roomPreview`, hand settled thread preview/backdrop to `claimInteractivePhoneSlide`, call `handleSwipeForwardToThread()`.
  - On cancel: return retained preview intact to cache, restore all inline styles, zero navigation/atom/focus side effects.
  - Register `clearPhoneSwipePreviews` in `src/app/shell/accountState.ts` reset path.
- [ ] **Step 3: Write unit tests in `phonePageSlide.test.ts` and `useRoomViewThreadState.test.tsx`**
      Cover: `[contenteditable]` draft redaction in `copyOf`, retained room/thread preview hit + resize/session/room miss fallback to backdrop, async `popstate` handoff with zero double-slide, timeout auto-cleanup, cancelled drag leaves route & `lastExitedThreadAtom` untouched.
- [ ] **Step 4: Run targeted vitest tests and commit Task 2**

---

### Task 3: Interactive `PhoneNavDrawer` (Open & Close) and `PhoneMembersSheet` (Close)

**Files:**

- Modify: `src/app/sidebar/PhoneNavDrawer.tsx`
- Modify: `src/app/sidebar/PhoneNavDrawer.css.ts`
- Modify: `src/app/sidebar/PhoneNavDrawer.test.tsx`
- Modify: `src/app/members/PhoneMembersSheet.tsx`
- Modify: `src/app/members/PhoneMembersSheet.css.ts`
- Modify: `src/app/members/PhoneMembersSheet.test.tsx` (create if absent, or extend existing test)

**Interfaces:**

- Consumes: `useEdgeSwipe`, `useSwipeAway`, `SWIPE_PRIORITY`, `animateSwipeElements` from Task 1.
- Produces: Interactive open/close scenes inside `PhoneNavDrawer` and interactive close scene inside `PhoneMembersSheet` (no new public exports needed).

- [ ] **Step 1: Add `[data-swiping]` transition-override styles to `PhoneNavDrawer.css.ts` and `PhoneMembersSheet.css.ts`**
      Ensure `&[data-swiping]` sets `transition: 'none'` (and `visibility: 'visible'` on `PhoneNavDrawer`'s `Panel`/`Scrim` while peeking).
- [ ] **Step 2: Wire interactive open & close scenes in `PhoneNavDrawer.tsx`**
  - Add local `peeking` state (`const filled = open || sliding || peeking`).
  - Open scene (`useEdgeSwipe` at `SWIPE_PRIORITY.DRAWER_OPEN`, enabled when `!open && !backSwipeOn`): on `begin`, `flushSync(() => setPeeking(true))`, measure `panel.getBoundingClientRect().width` (handles rail-only drawers accurately), mark `data-swiping` on panel & scrim, `update(px, p)` sets `panel.style.translate = ${px * dirSign}px 0` and `scrim.style.opacity = String(p)`. On commit: WAAPI settle to `panelWidth` / opacity `1`, call `flushSync(() => { setPeeking(false); movePhoneNavDrawer(true, setOpenNow); })` and clear inline styles + `data-swiping` in same frame. On cancel: WAAPI settle back to `0` / opacity `0`, clear inline styles + `data-swiping`, `setPeeking(false)` — `phoneNavDrawerOpenAtom` never flipped.
  - Close scene (`useSwipeAway` at `SWIPE_PRIORITY.SHEET`, enabled when `open`): `update(px, p)` sets `panel.style.translate = ${-px * dirSign}px 0` and `scrim.style.opacity = String(1 - p)`. On commit: WAAPI settle to `-panelWidth` / opacity `0`, suppress redundant CSS close transition and `sliding` 320 ms timer, call `setOpen(false)`, then clear inline styles + `data-swiping`.
- [ ] **Step 3: Wire interactive close scene in `PhoneMembersSheet.tsx`**
  - Pass interactive `begin` scene to `useSwipeAway(panelRef, 'end', dismiss, { enabled: out, priority: SWIPE_PRIORITY.SHEET, begin })`.
  - `update(px, p)` translates `panelRef` by `${px * dirSign}px 0` and sets scrim opacity to `String(1 - p)`.
  - On commit: WAAPI settle to `${panelWidth * dirSign}px 0` and opacity `0`, set `swipedDismissRef.current = true`, call `dismiss()`. In the `leaving` effect, if `swipedDismissRef.current`, call `done?.()` immediately instead of waiting `PHONE_SLIDE_OUT_MS`.
- [ ] **Step 4: Add unit tests for `PhoneNavDrawer` and `PhoneMembersSheet` and run vitest**
      Test: drawer peek mounts list & rail without flipping `phoneNavDrawerOpenAtom` or moving focus; cancel unmounts peek cleanly; commit opens without jump; rail-only narrower width works; close swipe dismisses cleanly without double slide; members sheet drag tracks & cancels without flipping `phoneSheetOpenAtom` and commits without 320 ms delay.
- [ ] **Step 5: Commit Task 3**

---

### Task 4: Covering Room Side Panels (`Room.tsx`) & `SubagentsPanel` Inner Detail Interactive Swipes

**Files:**

- Modify: `src/app/room/Room.tsx`
- Create: `src/app/room/RoomSidePanelSwipe.css.ts` (or add styles to existing Room CSS)
- Modify: `src/app/subagents/SubagentsPanel.tsx`
- Modify: `src/app/subagents/SubagentsPanel.test.tsx`
- Modify: `src/app/room/__tests__/Room.test.ts` (or add focused `Room.sidePanelSwipe.test.tsx`)

**Interfaces:**

- Consumes: `useEdgeSwipeBack`, `SWIPE_PRIORITY`, `animateSwipeElements` from Task 1.
- Produces: Unified phone side-panel host wrapper + iframe start-edge touch catcher in `Room.tsx`, and inner detail → list/parent interactive swipe in `SubagentsPanel.tsx`.

- [ ] **Step 1: Add phone side-panel host wrapper, iframe edge catcher, and unified covering-panel interactive swipe in `Room.tsx`**
  - When `mobile && behindPanel`, render `{sidePanel}` inside `<div ref={sidePanelHostRef} className={css.PhoneSidePanelHost}>` (`position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; z-index: 1;`) and, for iframe-bearing panels (`canvas`, `computer`), render `<div data-swipe-edge-catcher="" className={css.EdgeCatcher} />` (transparent 28 px start-edge strip).
  - Replace the plugin-only `useEdgeSwipeBack` with one Room-level `useEdgeSwipeBack` at `SWIPE_PRIORITY.PANEL` enabled when `mobile && behindPanel && !!shown`:
    - Close action: `shown.id === 'transcript' ? transcript.close : shown.close`.
    - Under-layer: for `shown.id === 'transcript'` when closing restores a call panel (i.e. `!callFloats && inCall`), mount a neutral themed surface backdrop; for all other covering panels (`subagents`, plugin panels, `computer`, `canvas`, `call`), add `data-swipe-under-panel=""` to `conversationRef` (CSS reveals it full-width underneath with `position: absolute; inset: 0; content-visibility: visible; pointer-events: none; z-index: 0` while `behindPanel` and `inert` remain unchanged!) and translate it `-30vw * dirSign → 0` while `sidePanelHostRef` translates `0 → +100vw * dirSign` with edge shadow.
    - On commit: WAAPI settle off-screen, clear styles, call the panel close handler.
- [ ] **Step 2: Wire inner detail → list/parent interactive swipe in `SubagentsPanel.tsx`**
  - Change `SubagentsPanel`'s `useEdgeSwipeBack` to handle inner detail navigation ONLY (`enabled: mobile && !!open`, `priority: SWIPE_PRIORITY.PANEL_INNER`, outranking Room's `PANEL` swipe; when `!open`, Room's `PANEL` swipe closes the panel!). Note: update `SubagentsPanel.test.tsx` if it tests standalone `<SubagentsPanel>` without `<Room>` — wait: keep a fallback `useEdgeSwipeBack(onClose, mobile && !open && !hasRoomPanelSwipe)` or check how `SubagentsPanel.test.tsx` mounts it! Let's check `SubagentsPanel.test.tsx` and ensure standalone tests & Room integration both work cleanly with zero double registration.
  - While `peekingBack` is true during an inner detail drag, render the list view (or parent `SubagentRunView` for nested runs) inert underneath (`position: absolute; inset: 0; z-index: 0`) translating `-30% → 0`, while the active detail view slides `0 → +100%` with edge shadow. On commit, call `back()` preserving `returnTo` card focus.
- [ ] **Step 3: Add unit tests for `Room` covering-panel interactive swipe and `SubagentsPanel` detail/list priority + cancel safety, run vitest**
- [ ] **Step 4: Commit Task 4**

---

### Task 5: Image Viewer (`ImageOverlay` / `ImageViewer`) Interactive Close, Full Verification & E2E / Screenshots

**Files:**

- Modify: `src/app/messages/content/ImageOverlay.tsx`
- Modify: `src/app/messages/viewers/ImageViewer.tsx`
- Modify: `src/app/messages/viewers/ImageViewer.test.tsx` (or `ImageOverlay.test.tsx`)
- Modify/Extend E2E specs: `e2e/sidebar/phone-room-edge-swipe.spec.ts`, `e2e/sidebar/phone-nav-drawer.spec.ts`, `e2e/sidebar/phone-page-slide.spec.ts`, `e2e/members/phone-members-sheet.spec.ts`

**Interfaces:**

- Consumes: `useEdgeSwipe`, `SWIPE_PRIORITY`, `EDGE_START_MAX_X`, `animateSwipeElements` from Task 1.

- [ ] **Step 1: Wire interactive edge-close in `ImageOverlay.tsx` and `ImageViewer.tsx`**
  - In `ImageOverlay.tsx`: mark `<OverlayBackdrop data-image-viewer-backdrop="" />` inside `<Overlay>` and pass `edgeSwipeArea={phone ? screenRef : undefined}` to `ImageViewer`.
  - In `ImageViewer.tsx`:
    - Update `useSwipe` paging edge-exclusion to check logical start edge (`documentIsRightToLeft() ? event.clientX >= window.innerWidth - EDGE_START_MAX_X : event.clientX <= EDGE_START_MAX_X`).
    - Pass `priority: SWIPE_PRIORITY.OVERLAY` and interactive `begin` scene to `useEdgeSwipe` (enabled only when `edgeCloses` i.e. `!!edgeSwipeArea && zoom === 1 && !isZooming`).
    - Scene translates `edgeSwipeArea.current` (`Modal`) from `0` to `+width * dirSign` with edge shadow while fading the sibling `[data-image-viewer-backdrop]` opacity `1 → 0`.
    - 2nd finger cancels swipe immediately and restores modal/backdrop so pinch zoom proceeds uninterrupted.
    - On commit: WAAPI settle off-screen + backdrop `0`, then call `requestClose()`.
- [ ] **Step 2: Write unit tests for `ImageOverlay` / `ImageViewer` interactive swipe**
      Cover: modal translates & backdrop fades during drag, cancel restores both & leaves history entry intact, commit calls `requestClose`, disabled when `zoom > 1`, 2nd touch cancels drag, non-edge swipe still pages images.
- [ ] **Step 3: Extend E2E tests and run full verification on `m5` (or `m2` for e2e if needed)**
  - Extend phone e2e specs to verify mid-drag intermediate translation, cancel-on-short-drag (no navigation/close), and full interactive commit with zero double-slide.
  - Capture mid-drag and after screenshots (placeholder data only, zero personal data) for PR body.
  - Run `tsc`, `lint`, `vite build`, full affected vitest suites, and phone e2e specs via `remote-test.sh`.
- [ ] **Step 4: Commit Task 5**
