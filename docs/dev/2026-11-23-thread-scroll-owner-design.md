# Thread Timeline Scroll Owner — Design & Migration Plan

**Status:** Draft design (planning only; based on `main` @ `d4c629d13`, post-#777)
**Scope:** Single `scrollTop` owner for the **thread timeline** (room timeline out of scope for this PR; clean seam for follow-up).

---

## 1. Inventory of Scroll Writers & Sources of Truth on `main`

### Scroll writers (28 call sites + 1 `marginTop` writer across 11 files in `src/app/timeline/` & `src/app/threads/`, plus 3 UI/native helpers, virtual-core, and the browser)

| # | Site (`file:line`) | Fires when | Believes (bottom / anchor / height) | Conflicts with |
|---|---|---|---|---|
| 1 | `timeline/timelineScrollLedgerController.ts:197` (`applyLedgerSettle`) | 150 ms quiescence timer or boundary guard | `scrollTop + px`, `inner.style.marginTop === -px`, `virtualizer.scrollMargin = 0` | WebKit wheel/scrub (discard+replay), `useListEndClamp`, virtual-core adjustments |
| 2 | `timeline/timelineScrollLedgerController.ts:719` (`holdThreadBannerResize`) | `ThreadTimelineHeader` rAF resize callback | `scrollTop + deltaPx` when `threadLedgerAnchorRef` set & `scrollTop > 0` | `useThreadOpeningPin`, `useListEndClamp`, virtual-core |
| 3 | `timeline/timelineScrollLedgerController.ts:1027,1029` (`onStatusBarScrollTop`) | iOS status-bar tap custom event | `top = 0`, clears ledger/margin/anchor | Any pending pin or smooth jump rAF |
| 4 | `timeline/timelineScrollLedgerController.ts:1065` (`commitLedgerMargin`) | Every `useInsertionEffect` + `useLayoutEffect` | Sets `inner.style.marginTop = -ledgerPxAtRender` (shifts painted rows & reach) | `useListEndClamp`, WebKit container-query pre-style layout |
| 5 | `timeline/clampedScrollCorrection.ts:59` (`useClampedCorrectionFinish`) | `useLayoutEffect` (up to 3 commits after clamped write) | `pending.target` if `scrollTop ≈ pending.clampedAt` & range grew | Any pin/jump/clamp landing near `clampedAt` |
| 6 | `timeline/roomFocusScrollController.ts:454,507` (`useThreadOpeningPin`) | 2 `useLayoutEffect`s on every commit while open-pinned | `scrollToBottom` (`scrollHeight - clientHeight`), `pinnedPositionRef` + `measurementCorrectionPx` | `useListEndClamp`, `heldListHeight`, `useLatestRowPin` |
| 7 | `timeline/roomFocusScrollController.ts:605` (`finishSmoothBottomPin`) | rAF loop (≤60 frames) after smooth bottom pin | `scrollHeight - clientHeight - scrollTop <= 1` | User scrolls/jumps, `useFooterBottomPin`, `useFollowContentGrowth` |
| 8 | `timeline/roomFocusScrollController.ts:643` (`useBottomPinRequests`) | Every commit when `scrollToBottomRef.count` advances | `scrollToLatestEnd` (`scrollHeight - clientHeight` or `0`) | `useThreadOpeningPin`, `useLatestRowPin`, `useListEndClamp` |
| 9 | `timeline/roomTimelineScroll.ts:79,80` (`scrollToLatestEnd`) | Helper called by #8 | `top: 0` (`latestAtTop`) or `dom.ts:138` `scrollToBottom` | Same as #8 |
| 10 | `timeline/roomTimelineScroll.ts:404,419,420` (`useLatestRowPin`) | Every commit while `latestRowRequestRef` holds | `scrollTo({top:0})`, `virtualizer.scrollToIndex(last)` (room), `scrollToBottom` (thread); `heldList` check | `useThreadOpeningPin`, `useListEndClamp`, `useFollowContentGrowth` |
| 11 | `timeline/roomTimelineScroll.ts:665,694,713` (`useTimelineRowJumps`) | Jump to event (`followFarRow` rAF ≤45f, `scrollToItem`, `scrollThreadEventIntoView`) | `virtualizer.scrollToIndex` (also arms virtual-core 5 s `reconcileScroll`) | `useThreadOpeningPin`, virtual-core `reconcileScroll`, ledger margin |
| 12 | `timeline/useVirtualPaginator.ts:187,195` (`scrollToElement`) | `useThreadJumpTarget`, `useEditedRowInView`, `useRoomFocusJump`, `followFarRow` (+ next-frame rAF) | `scrollBy(rect.top - targetTop)` using `scrollPadding` | Ledger margin, `useThreadOpeningPin`, `useListEndClamp` |
| 13 | `timeline/useVirtualPaginator.ts:537` (window shift) | Room window `range` `useLayoutEffect` (room only) | `scrollBy(anchorEl.top - anchor.top)` | Room ledger fold |
| 14 | `timeline/useFooterBottomPin.ts:46` | ResizeObserver on `footerProbeRef` + `scroll` | Local `readerAtBottom` (`isScrollNearBottom`); `scroll.scrollTop += covered` | `useFollowContentGrowth`, `useListEndClamp`, `useThreadOpeningPin` |
| 15 | `timeline/useFollowContentGrowth.ts:67` | ResizeObserver on `contentRef` during live reply frames | Local `pinned` + `seenScrollHeight` + `pendingListShrinkPx()`; `scrollTo(end)` | `useListEndClamp`, `useFooterBottomPin`, `useLatestRowPin` |
| 16 | `timeline/useListEndClamp.ts:104` | Last ResizeObserver on `contentRef` + `footerProbeRef` | `end = scrollHeight - clientHeight - listShrinkNotRendered(inner, rows, rowFoldPx)` | Every bottom pin (#6, #8, #10, #14, #15) & #4 (`marginTop` misread as shrink) |
| 17 | `timeline/useTimelineBulkExpansionAnchor.ts:85,93` | `expandAll` layout effect + 30-frame rAF loop | Local `BOTTOM_THRESHOLD_PX = 24` or mid-viewport `[data-message-id]` `rect.top` | Virtual-core corrections, `useListEndClamp`, `useLatestRowPin` |
| 18 | `threads/overview/useCompactScrollFallback.ts:126` & `ThreadFilterDropdown.tsx:95-96` | Non-timeline views (Compact fallback without `overflow-anchor`; dropdown key nav) | Separate scrollers (out of thread timeline scope) | None with thread scroller |
| 19 | `ui/InsetScrollbar.tsx:84,147`; `native/statusBarTapScroll.ts:71`; `lib/dom.ts:138` | Custom thumb drag/keys; status-bar fallback; shared `scrollToBottom` wrapper | Direct `scroll.scrollTop = ...` / `scrollTo` | Thumb drag races pins & ledger boundary guard |
| 20 | **`@tanstack/virtual-core` 3.17.3** (`applyScrollAdjustment`, `scrollToOffset`, `reconcileScroll`, `_iosDeferredAdjustment`) | Row `resizeItem`/RO (when `shouldAdjustScrollPositionOnItemSizeChange` in `threadRenderUtils.ts:205` returns `true`, mutating private `scrollAdjustments`); `scrollToIndex` | Cached `scrollOffset` (stale until scroll event!), `measurementsCache` (lazy Proxy), 5 s `scrollState` reconciliation | Races ledger baseline, clamps at end (`clampedScrollCorrection`), kills iOS momentum or replays banked lurch |
| 21 | **Browser itself** | Native `scrollHeight` shrink clamp; Chromium `overflow-anchor: auto` (not disabled on thread scroller); WebKit container-query pre-style layout; WebKit scrolling-thread discard/replay; iOS momentum & rubber-band | Browser's layout tree & async scrolling thread | Discards/replays JS `scrollTop` writes during wheel/scrub; clamps before React commits paired margin/height |

### Duplicate sources of truth on `main`
- **List height (4):** `virtualizer.getTotalSize()`, `heldListHeight(rendered, ledgerPx)` (`RoomTimeline.tsx:1375`), `scrollElement.scrollHeight`, and `scrollHeight - listShrinkNotRendered(inner, measurementsCache, rowFoldPx)` (`useListEndClamp.ts:44`).
- **Reader's anchor (6):** `threadLedgerAnchorRef` (top row below sticky header), `useTimelineBulkExpansionAnchor` `anchorRef` (viewport-center `[data-message-id]`), `pinnedPositionRef` (`useThreadOpeningPin`), `threadTargets` (jump target), `roomLedgerAnchorRef` / `useVirtualPaginator` `anchorRef` (room).
- **"At bottom" (9):** `atBottom`/`atBottomRef` (IntersectionObserver on `atBottomAnchorRef` + 120 px threshold), `isScrollNearBottom` (120 px), `<= 1 px` checks (`useThreadOpeningPin`, `useThreadOpeningReveal`, `finishSmoothBottomPin`), `useFooterBottomPin` local `readerAtBottom`, `useFollowContentGrowth` local `pinned` + `seenScrollHeight`, `useLatestRowRequest` `requestRef` (`LEFT_LATEST_ROW_PX = 32`), `useTimelineBulkExpansionAnchor` (`24 px`), `scrollToBottomRef.count`, `threadBackPaginationController.suppressed`.

---

## 2. Invariants (Thread Timeline)

1. **Anchor stability:** When the reader is not pinned to bottom and not actively jumping, the anchor row's viewport `top` changes by `≤ 1 px` across prepends, hidden/folded row price changes, above-viewport row measurements, banner/leading resizes, and bulk expand/collapse — unless the user scrolled.
2. **Bottom-pin fidelity:** While pinned to bottom (`open`, `jump`, own send, or resting at live end as a reply streams / footer grows / viewport resizes), the newest visible row's bottom stays flush with the bottom inset (`scrollHeight - clientHeight - scrollTop ≤ 1 px`, zero blank band above the composer) until a user gesture relinquishes the pin. Expanding a collapsible block while merely resting near the bottom unfolds in place without yanking to bottom.
3. **One-paint opening:** A thread opening at its newest reply keeps rows hidden until the first commit where the last non-relation tile is mounted and the scroller rests at the true bottom (`≤ 1 px`) — no blank frame, no flash at row 0 (bounded by the existing 1,500 ms safety fallback or user takeover).
4. **Zero overlap, zero seams:** Newly mounted or resized rows commit updated tile `top` positions before paint so adjacent rows never overlap or open gaps (`thread-fast-scroll-overlap`).
5. **Native gesture & momentum preservation:** While a touch is active, iOS momentum or rubber-band overscroll is in progress, or a wheel/compositor scroll session is live, the app performs **zero** `scrollTop` writes. Momentum is never interrupted and WebKit's scrolling thread never receives a mid-session write to discard or replay.

---

## 3. Design: Single Owner (`useThreadScrollOwner`)

### Architecture & Responsibility Boundary
A single module pair owns the thread timeline's scroll position and coordinate space:
- **`src/app/timeline/threadScrollOwner.ts`** — pure state machine, anchor-delta calculation, coordinate mapping (`originShiftPx`), and rebase/pin rules (100% unit-testable without DOM).
- **`src/app/timeline/useThreadScrollOwner.ts`** — the **only** code allowed to write `scrollElement.scrollTop` / `scrollTo` on a thread timeline (enforced by an architecture test!).

Every other controller reports **facts** or **intents** only:
- **Facts:** `threadEvents` / `threadRowPricing` changes (render), row measurement deltas (virtualizer `measureElement`), `reportHeaderResize(deltaPx)` (`ThreadTimelineHeader`), `reportLeadingHeight(px)` (`ThreadLoadingLines`), live reply frame counter (`liveReplies`), `expandAll` toggle, viewport & footer inset resizes.
- **Intents:** `jumpToBottom({ smooth, userTap })`, `jumpToEvent(eventId, opts)`, `jumpToTop()` (status-bar tap), `scrollByUser(top)` (`InsetScrollbar` drag/keys), `beginBackPagination(req)` (replaces `useThreadPrependViewport` + `threadBackPaginationController`).

### Minimal State (Single Source of Truth)
```ts
type ThreadScrollMode =
  | { kind: 'bottom'; reason: 'open' | 'follow' | 'jump'; hardPin: boolean; smooth: boolean }
  | { kind: 'anchor'; eventId: string; viewportOffset: number } // px below scroller readerTop (scrollPaddingTop)
  | { kind: 'jump'; eventId: string; align: 'start' | 'center' | 'end'; stopInView: boolean; attempts: number };

type ScrollSession = {
  activeTouches: number;      // window capture touchstart/end/cancel (reset on visibilitychange/pagehide)
  sessionLive: boolean;       // true on scroll or wheel (incl. wheel-up at scrollTop===0); false on scrollend or 1500ms stale TTL
  lastInputAt: number;        // last wheel or scroll timestamp
  sampledScrollTop: number;
  rubberBanding: boolean;     // scrollTop < -1 || scrollTop > maxScrollTop + 1
};

type OwnerState = {
  viewKey: string;            // `${roomId}|${threadId}`
  mode: ThreadScrollMode;
  originShiftPx: number;      // JS-only coordinate shift (NO CSS marginTop, NO virtualizer.scrollMargin)
  leadingHeightPx: number;    // ThreadLoadingLines height inside virtual coordinate space
  atBottom: boolean;          // single derived truth for JumpToLatest, read receipts, follow logic
  revealed: boolean;          // replaces useThreadOpeningReveal
};
```

### Hooks & One-Rule-Per-Frame Reconciliation
1. **CSS:** Set `overflowAnchor: 'none'` on the thread scroller so Chromium never shifts `scrollTop` behind the owner's back (matching WebKit).
2. **`useInsertionEffect` (before child refs):** On `viewKey` change, reset `OwnerState` (`mode = open bottom` or `jump` if `eventId` route, `originShiftPx = 0`, `revealed = !opensAtLatest`). Commit `originShiftPx` snapshot for this render.
3. **Pure render coordinate calculation (no `marginTop`, no `scrollMargin`):**
   - If `mode.kind === 'anchor'` and `threadEvents`/`threadRowPricing` changed, compute `prependDelta = newStart(anchorId) - prevStart(anchorId)` against the previous committed size cache (falling back to nearest surviving row above if `anchorId` disappeared).
   - **Virtualizer as pure layout engine:**
     - `shouldAdjustScrollPositionOnItemSizeChange: () => false` — virtual-core **never** writes `scrollTop`, mutates private `scrollAdjustments`, or banks `_iosDeferredAdjustment`.
     - Never call `virtualizer.scrollToIndex` / `scrollToOffset` on threads — virtual-core's 5 s `reconcileScroll` is completely dead.
     - `scrollMargin` is permanently `0`; `observeElementOffset` feeds virtual-core the virtual coordinate `scrollTop + originShiftPx - leadingHeightPx`, so virtual-core's visible range and `measurementsCache` stay coherent without ever calling `setOptions`.
   - **Tile & list geometry:**
     - `ThreadLoadingLines` renders inside `virtualInner` at `top = -originShiftPx` (removing it from outside `virtualInner` eliminates the WebKit container-query `minHeight` hack in `timelineScrollLedgerController.ts:617-624`).
     - Tile `i` renders at `top = leadingHeightPx + item.start - originShiftPx`.
     - `virtualInner.style.height = Math.max(0, leadingHeightPx + virtualizer.getTotalSize() - originShiftPx)` — always the exact rendered reach (no negative margin, no `rowFoldPx`, no `listShrinkNotRendered`).
4. **Row measurements (one pre-paint microtask):**
   - Wrap `measureElement`: compare `nextSize` vs `prevSize` (`itemSizeCache` or `estimateSize`). Record `{ index, delta }` in a per-pass queue and schedule **one** `queueMicrotask(() => flushSync(reconcileMeasurements))`.
   - Inside a ResizeObserver pass, keep mounted row keys fixed during that microtask so new overscan mounts happen after the RO turn (preventing RO depth-loop errors).
   - Remove shallower `ResizeObserver(contentRef)` listeners on threads (`useFollowContentGrowth` and `useListEndClamp` are deleted; `InsetScrollbar` and `TimelineMinimap` receive an `onExtentChange` callback from the owner instead of observing `contentRef`). Because no shallower RO observes `contentRef`, `virtualInner.style.height` updates synchronously on the same frame — eliminating `heldListHeight`, `useListEndClamp`, `pastEndCorrection`, and `useClampedCorrectionFinish`.
5. **One `ResizeObserver` inside the owner** on `scrollElement` + `footerProbeRef`:
   - `covered = ΔfooterInset - ΔclientHeight`: if `mode.kind === 'bottom'` and `covered > 0`, advance `scrollTop += covered`.
   - `widthChanged`: if `mode.kind === 'bottom'`, set `hardPin = true` and re-measure mounted rows.
6. **One persistent event bundle** on `scrollElement` (`scroll`, `scrollend`, `wheel` capture, `touchstart`, `pointerdown`, `keydown`, `STATUS_BAR_SCROLL_TOP_EVENT`) + window-capture touch tracker:
   - Any user gesture drops `open` hardPin / cancels `jump` / drops `follow` hardPin; transitions to `anchor` when scrolled away from bottom (`> TIMELINE_BOTTOM_THRESHOLD_PX`), or `{ kind: 'bottom', reason: 'follow', hardPin: false }` when scrolled back to bottom at live end.
   - `scroll` updates `anchor = { eventId, viewportOffset }` from the highest visible row at `readerTop`, updates `atBottom`, and updates `rubberBanding`.
7. **Single `useLayoutEffect` rule (one decision per commit):**
   - **`mode.kind === 'bottom'`:** if `hardPin` or live-reply/footer growth occurred, set `originShiftPx = 0` and write `scrollTop = Math.max(0, scrollHeight - clientHeight)` once (smooth only on explicit jump, with single rAF finish check). If `!revealed` and last non-relation tile is mounted and within `≤ 1 px` of end, set `revealed = true`.
   - **`mode.kind === 'jump'`:** set `originShiftPx = 0`; if target DOM row exists, align to `align` (respecting `scrollPaddingTop/Bottom`) and transition to `anchor`; else jump `scrollTop` to `measurementsCache[index].start` and retry next rAF (≤30 attempts).
   - **`mode.kind === 'anchor'`:** given total above-anchor delta `Δ = prependDelta + aboveRowResizeDelta + headerDelta + leadingDelta`:
     - If `!isScrollLive()` && `!isIOSWebKit` && `originShiftPx === 0` && `scrollTop + Δ >= 0`: write `scrollTop += Δ` once at commit (zero deferred shift at rest!).
     - Otherwise: absorb into `originShiftPx += Δ` (**zero `scrollTop` write!**) and arm the single rest-rebase check.

### Handling Prepend During Fast WebKit Wheel / Touch Scroll (Why Discard/Replay Cannot Hit It)
On `main`, WebKit discarded & replayed settle writes for four compounding reasons, **all eliminated by construction**:
1. **Blind per-call session tracking:** `scrollQuiescence.ts` initialized `scrollSessionLive = false` inside each wait call, so waits armed during a wheel/trackpad pause couldn't see the live session, and ignored upward `wheel` events at `scrollTop === 0` (`!canScroll`). The owner attaches **once on mount**, tracks `sessionLive` continuously, and counts **every** wheel event (including wheel-up at `0`).
2. **Aggressive mid-burst & 150 ms settles:** `shouldSettleLedgerAtBoundary` settled mid-burst on hitting `scrollTop === 0`, and `150 ms` quiescence fired inside 220 ms inter-burst pauses. In the owner, positive `originShiftPx > 0` creates **no blank space** at the top, so it **never** rebases mid-burst — neither proactively nor at `scrollTop === 0` while wheels are arriving. Rebase (`originShiftPx -> 0`, `scrollTop += originShiftPx`) runs **only** when `!activeTouches && !sessionLive && !rubberBanding` and `scrollTop` & `wheel` have been idle for `REBASE_QUIET_MS` (300 ms after `scrollend` / last input).
3. **100–240 ms settle-cascade frame:** Clearing `marginTop` and calling `virtualizer.setOptions({ scrollMargin: 0 })` forced virtual-core to remount/remeasure a band of rows inside the settle frame, widening the race window to >150 ms. Because `virtualizer.scrollMargin` is permanently `0` and virtual offset `scrollTop + originShiftPx` is invariant across a rebase, **zero rows remount or re-measure** on rebase (<5 ms frame).
4. **Heuristic discard-watching (`isDiscardedSettleWrite`):** Guessing "was that a WebKit discard or a user wheel?" and re-applying `marginTop` caused WebKit's subsequent replay to jump a second time. With no `marginTop` and rebases restricted to genuine compositor rest, the entire discard-watch heuristic is **deleted** — the owner never guesses whose move a scroll event was.

### iOS Momentum & Rubber-Band
- Active touch (`activeTouches > 0`), inertial momentum (`sessionLive` or sampled `scrollTop` changing), and rubber-band overscroll (`scrollTop < -1 || scrollTop > maxScrollTop + 1`) all satisfy `isScrollLive() === true`: **zero `scrollTop` writes**, all prepends & above-viewport measurements flow into `originShiftPx`.
- **Negative `originShiftPx < 0`** (rows above shrank, leaving empty space `[0, |originShiftPx|)` above row 0): rebases only when `!activeTouches && !rubberBanding` and `scrollTop < |originShiftPx| + 1.5 * clientHeight` while moving backward, preventing blank top bands (`thread-ride-under-latency`) without snapping rubber-band bounces.
- Explicit user button taps (`Jump to Latest`, status-bar tap) remain the only callers of `stopIOSFlick`.

### Room Timeline Scope
**Out of scope for this PR (thread-first).** `RoomTimeline.tsx` currently multiplexes two structurally different scroll models (flat chronological thread vs windowed room with `latestAtTop`, `roomScrollLedger`, `membershipFolds`, `unreadMarkerOpening`, `CompactRoomView`). Thread-first keeps the diff focused and risk-isolated: `RoomTimeline.tsx` routes `threadId` to `useThreadScrollOwner` and leaves the room branch untouched; once proven on threads, a follow-up PR migrates the room timeline and deletes the remaining ledger/clamp/quiescence files.

---

## 4. What Gets Deleted (Estimated Net Product Lines)

| File / Symbol | Action (this PR) | Est. Δ lines |
|---|---|---|
| `src/app/timeline/threadScrollLedger.ts` | **Delete file** (30-line pure anchor-delta helper folded into `threadScrollOwner.ts`) | −95 |
| `src/app/timeline/useThreadOpeningReveal.ts` | **Delete file** (folded into `useThreadScrollOwner`) | −60 |
| `src/app/timeline/useThreadPrependViewport.ts` | **Delete file** (owner exposes `ThreadPrependViewportPort`) | −27 |
| `src/app/timeline/threadBackPaginationController.ts` | **Delete file** (folded into owner) | −65 |
| `src/app/timeline/timelineScrollLedgerController.ts` | **Delete all thread branches** (`threadLedger*`, `holdThreadBannerResize`, `readerTopOffset`, thread `leadingRef` `minHeight` hack, `observeThreadHeightRef`, `rangeExtractor`) | −310 |
| `src/app/timeline/roomFocusScrollController.ts` | **Delete thread hooks** (`useThreadOpeningPin`, `useThreadJumpTarget`, thread gesture branch) | −210 |
| `src/app/timeline/roomTimelineScroll.ts` | **Delete thread branches** (`useThreadOpenedAtLatest`, `onThreadGesture`, `surface==='thread'` in `useLatestRowPin`, `scrollThreadEventIntoView`) | −85 |
| `src/app/event-store/threads/threadRenderUtils.ts` | **Delete** `shouldPinThreadToBottomOnOpen` & thread-only open helpers | −45 |
| `src/app/timeline/RoomTimeline.tsx` | **Remove** thread scroll wiring; bypass `useFooterBottomPin`, `useFollowContentGrowth`, `useListEndClamp`, `useTimelineBulkExpansionAnchor` (via `enabled: !threadId`) & `heldList` on threads | −130 |
| **New:** `threadScrollOwner.ts` (~220) + `useThreadScrollOwner.ts` (~280) + `RoomTimeline`/`InsetScrollbar`/`TimelineMinimap` extent hook (~60) | **Add** | +560 |
| **Net (this PR, thread-first)** | **Net reduction** | **≈ −467 lines** |
| *Follow-up PR (room adopts owner)* | Delete `timelineScrollLedgerController.ts`, `roomScrollLedger.ts`, `clampedScrollCorrection.ts`, `useListEndClamp.ts`, `useFooterBottomPin.ts`, `useFollowContentGrowth.ts`, `useTimelineBulkExpansionAnchor.ts`, `scrollQuiescence.ts`, `isDiscardedSettleWrite`, `shouldSettleLedgerAtBoundary`, `buildMeasurementScrollCorrectionHook` | *≈ −1,900 more* |

---

## 5. Migration Plan (One Branch `refactor/thread-scroll-owner`, One PR)

Every commit keeps all 8 thread scroll specs green (`thread-timeline-jumps.live`, `thread-fast-scroll-overlap.live`, `thread-prepend-scroll.live`, `thread-scroll-stability.live`, `thread-open-chain-prepend-anchor.live`, `thread-first-open-paints-once`, `thread-ride-under-latency.live`, `unread-thread-open-landing`):

1. **`feat(timeline): add pure threadScrollOwner state machine and unit tests`**
   Add `threadScrollOwner.ts` + exhaustive vitest suite (anchor stability, bottom-pin transitions, `originShiftPx` rebase rules, iOS momentum/rubber-band deferral, negative-origin top guard, jump lifecycle). Zero wiring changes yet; all specs untouched and green.
2. **`feat(timeline): add extent-change subscription to InsetScrollbar and TimelineMinimap`**
   Add optional `onExtentChange` / imperative notify prop so threads do not attach shallower `ResizeObserver(contentRef)` listeners (preserving existing RO fallback for room & other pages). All specs green.
3. **`feat(timeline): add useThreadScrollOwner hook and architecture guard`**
   Implement `useThreadScrollOwner.ts` (virtualizer with `shouldAdjustScrollPositionOnItemSizeChange: () => false`, `overflow-anchor: none`, `originShiftPx` tile/height placement, `ThreadLoadingLines` inside `virtualInner`, persistent scroll-session tracking, single ResizeObserver) + vitest contract tests (including real `@tanstack/virtual-core` zero-write iOS contract). Not wired into `RoomTimeline` yet.
4. **`refactor(timeline): switch thread timeline in RoomTimeline to useThreadScrollOwner`**
   Route `threadId` in `RoomTimeline.tsx` to `useThreadScrollOwner`; gate off `useTimelineScrollLedgerController` (thread path), `useFooterBottomPin`, `useFollowContentGrowth`, `useListEndClamp`, `useTimelineBulkExpansionAnchor`, `useThreadOpeningPin`, `useThreadJumpTarget`, and `useLatestRowPin` for threads; route `ThreadTimelineHeader`, `InsetScrollbar`, `JumpToLatest`, status-bar tap, and `ThreadPrependViewportPort` through the owner.
   *Note on `thread-ride-under-latency.live.spec.ts:562,606-607`:* that test currently inspects white-box `inner.style.marginTop` and `probes.ledgerBoundarySettles`. Update those two probe assertions in this commit to verify the owner's `data-origin-shift` / zero blank band + zero jump user invariants (keeping every user-visible budget identical).
   **Un-fixme `e2e/threads/thread-timeline-jumps.live.spec.ts:462`** (WebKit fast upward wheel scroll) in this commit!
5. **`refactor(timeline): delete dead thread scroll files and thread branches`**
   Delete `threadScrollLedger.ts`, `useThreadOpeningReveal.ts`, `useThreadPrependViewport.ts`, `threadBackPaginationController.ts`, and dead thread branches in `timelineScrollLedgerController.ts`, `roomFocusScrollController.ts`, `roomTimelineScroll.ts`, `threadRenderUtils.ts`, plus their obsolete unit tests. Add an architecture test asserting no file other than `useThreadScrollOwner.ts` writes `scrollTop`/`scrollTo`/`scrollBy` on the thread timeline scroller.

---

## 6. Risks, Alternatives & Open Questions

### Alternatives Considered & Rejected
1. **Keep the `marginTop` ledger and funnel all 24 writes through one wrapper function:**
   *Cost:* Small initial diff, zero conceptual simplification. *Why rejected:* Keeps `marginTop` + `scrollMargin` + 4 list-height truths + `listShrinkNotRendered` + `isDiscardedSettleWrite` heuristic guessing. Funnelling stale-state callers through a mutex does not stop callers from passing stale targets, nor does it eliminate WebKit's `marginTop`/settle discard-replay race.
2. **Pure commit-time `scrollTop += Δ` with no `originShiftPx`:**
   *Cost:* Simplest coordinate math. *Why rejected:* Any above-viewport row measuring taller during an iOS flick MUST adopt its real height before entering view (`thread-fast-scroll-overlap`) — writing `scrollTop += Δ` kills iOS momentum, while deferring row heights causes overlap/seams.
3. **`flex-direction: column-reverse` (bottom = `scrollTop 0`, prepends grow negative):**
   *Cost:* Zero `scrollTop` write on prepend. *Why rejected:* Known WebKit `position: sticky` bugs (`ThreadTimelineHeader`), breaks live-streaming stability while reading history (appends at bottom now shift every older row), and inverts `@tanstack/virtual-core`, `InsetScrollbar`, `statusBarTapScroll`, and all existing e2e `scrollTop` contracts.

### Main Risks
- **Chromium vs WebKit `scrollend` & wheel timing:** Older WebKit builds without `scrollend` fall back to `REBASE_QUIET_MS` + sampled-offset stability; Playwright WebKit on Linux (GTK/WPE) vs macOS/iOS Safari can have slightly different wheel deceleration tails.
- **Virtualizer coupling:** Passing `scrollTop + originShiftPx - leadingHeightPx` through `observeElementOffset` relies on `@tanstack/virtual-core` calling `onOffset` cleanly when we notify it synchronously on rebase (must be pinned with a real-core vitest contract test, like `virtualizerIOSScrollContract.test.ts`).
- **Pre-paint `flushSync` performance:** Batching row resizes into one `queueMicrotask(() => flushSync(...))` per RO turn matches current behavior, but must avoid mounting new overscan rows during that microtask so fast rides stay within frame budget and never emit RO loop warnings.

### Decisions Least Sure Of (Open Questions)
1. **Rebase quiet window vs top-edge responsiveness (`REBASE_QUIET_MS`):** Waiting 300 ms after `scrollend`/wheel avoids colliding with 220 ms inter-burst pauses, and at `scrollTop === 0` holds until the burst pauses. If a user continuously wheels against `scrollTop === 0` with pauses `< 300 ms` and no longer pause, how long before we force-reveal prepended rows — or should desktop Chromium (which has no scrolling-thread discard bug) rebase immediately at `scrollTop === 0` while WebKit waits for `scrollend` + quiet?
2. **Thread-only `useThreadScrollOwner` vs unifying `RoomTimeline.tsx` split:** Keeping `RoomTimeline.tsx` as one component that branches hooks on `!!threadId` avoids mounting/unmounting plumbing, whereas splitting `<ThreadTimeline>` and `<RoomMainTimeline>` cleanly separates React hook trees (no conditional/disabled room hooks running on threads). Is splitting the component wrapper worth doing in Commit 4, or better kept minimal with `enabled: !threadId` flags?
3. **White-box assertion in `thread-ride-under-latency.live.spec.ts:606-607`:** Updating `ledgerBoundarySettles > 0` to observe owner negative-origin boundary rebases preserves the test's exact intent ("never enter blank top space on shrunk over-estimates"), but we should confirm with Bas whether the spec may switch its white-box probe counter name when `marginTop` is removed.
