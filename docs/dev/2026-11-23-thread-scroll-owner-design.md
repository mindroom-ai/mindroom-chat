# Thread Timeline Scroll Owner — Design & Migration Plan

**Status:** Revised after Opus + Astra review & m2 WebKit prototyping (based on `main` @ `d4c629d13`)
**Scope:** Single `scrollTop` owner for the **thread timeline** (room timeline deferred to follow-up via `enabled: !threadId` guards; disabled room hooks attach no `ResizeObserver`).

---

## 1. Inventory of Scroll Writers & Sources of Truth on `main`

### Scroll writers (28 call sites + 1 `marginTop` writer across 11 files in `src/app/timeline/` & `src/app/threads/`, plus 3 UI/native helpers, virtual-core, and the browser)

| # | Site (`file:line`) | Fires when | Believes (bottom / anchor / height) | Conflicts with |
|---|---|---|---|---|
| 1 | `timeline/timelineScrollLedgerController.ts:197` (`applyLedgerSettle`) | 150 ms quiescence timer or boundary guard | `scrollTop + px`, `inner.style.marginTop === -px`, `scrollMargin = 0` | WebKit wheel/scrub (discard+replay), `useListEndClamp`, virtual-core |
| 2 | `timeline/timelineScrollLedgerController.ts:719` (`holdThreadBannerResize`) | `ThreadTimelineHeader` rAF resize callback | `scrollTop + deltaPx` when `threadLedgerAnchorRef` set & `scrollTop > 0` | `useThreadOpeningPin`, `useListEndClamp`, virtual-core |
| 3 | `timeline/timelineScrollLedgerController.ts:1027,1029` (`onStatusBarScrollTop`) | iOS status-bar tap custom event | `top = 0`, clears ledger/margin/anchor | Pending pins or smooth jump rAF |
| 4 | `timeline/timelineScrollLedgerController.ts:1065` (`commitLedgerMargin`) | Every `useInsertionEffect` + `useLayoutEffect` | `inner.style.marginTop = -ledgerPxAtRender` (hides rows `< 0`) | `useListEndClamp`, WebKit container-query pre-style layout |
| 5 | `timeline/clampedScrollCorrection.ts:59` (`useClampedCorrectionFinish`) | `useLayoutEffect` (≤3 commits after clamped write) | `pending.target` if `scrollTop ≈ clampedAt` & range grew | Pins, jumps, clamps landing near `clampedAt` |
| 6 | `timeline/roomFocusScrollController.ts:454,507` (`useThreadOpeningPin`) | 2 `useLayoutEffect`s every commit while open-pinned | `scrollToBottom`, `pinnedPositionRef` + `measurementCorrectionPx` | `useListEndClamp`, `heldListHeight`, `useLatestRowPin` |
| 7 | `timeline/roomFocusScrollController.ts:605,643` (`finishSmoothBottomPin`, `useBottomPinRequests`) | Shared `scrollToBottomRef.count` commit + ≤60-frame rAF | `scrollToLatestEnd` (`scrollHeight - clientHeight` or `0`) | `useThreadOpeningPin`, `useLatestRowPin`, `useFooterBottomPin`, `useFollowContentGrowth` |
| 8 | `timeline/roomTimelineScroll.ts:79,80,404,419,420` (`scrollToLatestEnd`, `useLatestRowPin`) | Every commit while `latestRowRequestRef` holds | `scrollTo({top:0})`, `scrollToIndex(last)` (room), `scrollToBottom` (thread) | `useThreadOpeningPin`, `useListEndClamp`, `useFollowContentGrowth` |
| 9 | `timeline/roomTimelineScroll.ts:665,694,713` (`useTimelineRowJumps`) | Event jumps (`followFarRow` ≤45f, `scrollToItem`, `scrollThreadEventIntoView`) | `virtualizer.scrollToIndex` (arms 5 s `reconcileScroll`) | `useThreadOpeningPin`, `reconcileScroll`, ledger margin |
| 10 | `timeline/useVirtualPaginator.ts:187,195,537` (`scrollToElement`, window shift) | `useThreadJumpTarget`, `useEditedRowInView`, `useRoomFocusJump`, room range | `scrollBy(rect.top - targetTop)` + next-frame rAF | Ledger margin, `useThreadOpeningPin`, `useListEndClamp` |
| 11 | `timeline/useFooterBottomPin.ts:46` & `useFollowContentGrowth.ts:67` | RO on `footerProbeRef`/`scroll` & `contentRef` (streaming) | Local `readerAtBottom` / `pinned` + `pendingListShrinkPx()`; `scrollTop += covered` / `scrollTo(end)` | Fires during touch near bottom; races `useListEndClamp` & pins |
| 12 | `timeline/useListEndClamp.ts:104` | Last RO on `contentRef` + `footerProbeRef` | `end = scrollHeight - clientHeight - listShrinkNotRendered` | Every bottom pin & #4 (`marginTop` misread as shrink) |
| 13 | `timeline/useTimelineBulkExpansionAnchor.ts:85,93` | `expandAll` layout effect + 30-frame rAF loop | Local `BOTTOM_THRESHOLD_PX = 24` or mid-viewport `rect.top` | Virtual-core, `useListEndClamp`, `useLatestRowPin` |
| 14 | `threads/overview/useCompactScrollFallback.ts:126` & `ThreadFilterDropdown.tsx:95-96` | Non-timeline views (Compact WebKit fallback; dropdown nav) | Separate scrollers (out of thread scope) | None with thread scroller |
| 15 | `ui/InsetScrollbar.tsx:84,147`; `native/statusBarTapScroll.ts:71`; `lib/dom.ts:138` | Thumb drag/keys; status-bar fallback; `scrollToBottom` helper | Direct `scroll.scrollTop = ...` / `scrollTo` | Thumb drag races pins & ledger boundary guard |
| 16 | **`@tanstack/virtual-core` 3.17.3** (`_willUpdate`, `anchorTo`, `reconcileScroll`, `_iosDeferredAdjustment`, `applyScrollAdjustment`) | Attach `_willUpdate` calls `_scrollToFn(getScrollOffset())`; `resizeItem` (incl. `useThreadApprovalRowMeasurements` & `useTurnBreakRowMeasurements` at `RoomTimeline.tsx:1378-1379`); `scrollToIndex` | Stale cached `scrollOffset`, lazy `measurementsCache` Proxy, private `scrollAdjustments` | Races ledger baseline, clamps at end, kills iOS momentum or replays banked lurch |
| 17 | **Browser itself** | Native shrink clamp; Chromium `overflow-anchor: auto`; WebKit container-query pre-style layout; WebKit scrolling-thread discard/replay; iOS momentum & rubber-band | Browser layout tree & async scrolling thread | Discards/replays JS `scrollTop` writes during wheel/scrub; clamps before commit |

### Duplicate sources of truth on `main`
- **List height (4):** `virtualizer.getTotalSize()`, `heldListHeight()`, `scrollElement.scrollHeight`, `scrollHeight - listShrinkNotRendered()`.
- **Reader's anchor (6):** `threadLedgerAnchorRef`, `useTimelineBulkExpansionAnchor` `anchorRef`, `pinnedPositionRef`, `threadTargets`, room `roomLedgerAnchorRef` / `useVirtualPaginator` `anchorRef`.
- **"At bottom" (9):** `atBottom`/`atBottomRef` (IntersectionObserver), `isScrollNearBottom` (120 px), `<= 1 px` checks (3 places), `useFooterBottomPin` `readerAtBottom`, `useFollowContentGrowth` `pinned`, `useLatestRowRequest` `requestRef`, `useTimelineBulkExpansionAnchor` (24 px), `scrollToBottomRef.count`, `threadBackPaginationController.suppressed`.

---

## 2. Invariants (Thread Timeline)

1. **Every loaded row can be scrolled to:** `headroomPx >= 0` always; no loaded row is ever placed at `top < 0` or hidden behind a negative margin/offset.
2. **Anchor stability:** Unless the user scrolls or initiates a jump, the anchor row's viewport `top` moves `≤ 1 px` across prepends, row measurements, hidden/folded row price changes, banner/leading resizes, and bulk expand/collapse.
3. **Bottom-pin fidelity:** While pinned (`open`, `jump`, own send, or resting at live end during streaming/footer/viewport changes), the newest visible row stays flush (`scrollHeight - clientHeight - scrollTop ≤ 1 px`, zero blank band) until a user gesture releases the pin. Expanding a collapsible while merely resting near bottom unfolds in place.
4. **One-paint opening:** Open-at-latest threads stay hidden until the first commit resting at the true bottom (`≤ 1 px`) with the last non-relation tile mounted (bounded by user takeover or 1,500 ms fallback).
5. **Zero overlap, zero seams:** Newly mounted or resized rows commit updated tile `top` positions before paint (`thread-fast-scroll-overlap`).
6. **Native gesture & momentum preservation:** While a touch is active, iOS momentum/rubber-band is running, or a wheel burst is live, the owner issues **zero** `scrollTop` writes (including near the bottom: streaming and footer pins defer while `activeTouches > 0`). User input always wins.

---

## 3. Design: Headroom + Single Commit-Time Owner (`useThreadScrollOwner`)

### Flip the Sign: Positive Headroom, Not Hidden Debt
Instead of folding prepends/growth into negative `marginTop` (hidden debt that traps rows at `< 0` and must be settled later via `scrollTop += px`), reserve **real, positive scrollable headroom** (`headroomPx >= 0`) above row 0:
- **Coordinate layout:** `inner.style.marginTop` is **always `''`**. Pass `scrollMargin: headroomPx` to the virtualizer; tiles render at `top: item.start` (`headroomPx + rawStart`), `inner.style.height = headroomPx + virtualizer.getTotalSize()`, and `ThreadLoadingLines` renders inside the headroom band directly above row 0.
- **Reservation on open:** While opening-pinned (`!userScrolled && hasMoreHistory`), keep `headroomPx >= Math.max(unloadedReplies * 260, 28_000)` using `threadReplyCountMap` / `data-thread-count` (topping up during open so opening-chain pages do not drain headroom to 0 before the reader scrolls).
- **Consuming & adding headroom (zero `scrollTop` write):**
  - Prepend or above-anchor row growth (`Δ > 0`): consumes headroom (`headroomPx -= Δ`).
  - Above-anchor row shrink (`Δ < 0`): adds headroom (`headroomPx += |Δ|`).
  - On narrow viewports (phone), unmeasured rows wrap significantly taller than estimates as they mount; headroom absorbs both prepends **and** wrap growth with zero `scrollTop` writes.
- **The only two cases that ever write `scrollTop` for geometry:**
  1. **Headroom exhaustion (`headroomPx < Δ`):** `headroomPx -> 0`, `deficit = Δ - headroomPx`.
     - *Chromium:* write `scrollTop += deficit` immediately at commit (no scrolling-thread discard).
     - *WebKit / iOS:* backward pagination gates commits on scroll rest (`ThreadPrependViewportPort`); if an unbuffered deficit occurs (e.g. massive underestimate), commit with pre-synced `virtualizer.scrollOffset = next` (explicit takeover: `m2` prototyping showed any raw or `overflow-y: hidden` write mid-wheel-burst in WebKit causes discard/replay or dropped ticks, so keeping headroom topped up during open + unmeasured-row cushion is essential to prevent exhaustion in practice).
  2. **Final correction when history completes (`!hasMoreHistory`) & `headroomPx > 0`:**
     - Never trim mid-burst (`m2` phone prototype proved a mid-burst near-top trim causes a 3,132 px WebKit discard reversal) and never trim to `0` while unmeasured rows remain above the anchor (phone wrap growth consumes ~13k px after history finishes).
     - When `!activeTouches && !rubberBanding` and wheel/scroll has paused (`>= 260 ms` idle; plus `scrollend` where supported on Safari 26.2+, falling back cleanly on iOS 16.4–26.1), trim **only excess headroom** above an unmeasured-row cushion:
       `keep = unmeasuredAbove * (viewWidth < 600 ? 70 : 20)`, `trim = Math.min(headroomPx - keep, scrollTop)`.
       Bounding by `scrollTop` guarantees we never clamp at `0` and teleport rows; as the reader nears row 0 (`unmeasuredAbove -> 0`), the final trim lands at `headroomPx = 0` before entering empty space.

### Complete Virtualizer Containment & Single Source of Truth
- **Virtualizer strictly read-only:** Pass **`scrollToFn: () => {}`** and **`shouldAdjustScrollPositionOnItemSizeChange: () => false`** on threads. This blocks `_willUpdate`, `anchorTo`, `reconcileScroll`, `_iosDeferredAdjustment`, and `applyScrollAdjustment` completely. Set `overflowAnchor: 'none'` on the thread scroller.
- **All resize facts routed to the owner:** Both `measureElement` (RO/mount) **and** imperative `resizeItem` callers (`useThreadApprovalRowMeasurements`, `useTurnBreakRowMeasurements` at `RoomTimeline.tsx:1378-1379`) report `{ index, delta }` through the owner's `resizeRow(index, size)` wrapper into one pending queue flushed in a single pre-paint microtask (`flushSync`, keeping mounted keys fixed inside RO turns so no new overscan mounts trigger RO depth-loop warnings).
- **One committed snapshot + live DOM offset (no duplicated state):**
  - Stored state is strictly `{ viewKey, mode, headroomPx, revealed }` where `mode` is `bottom(reason, hardPin, smooth)` | `anchor(eventId, viewportOffset)` | `jump(eventId, align, stopInView, attempts)`.
  - `atBottom`, `rubberBanding` (`scrollTop < -1 || scrollTop > max + 1`), range, and extent are **derived** on demand from the committed snapshot + live `scrollElement.scrollTop` (no stored `atBottom`/`rubberBanding`/`sampledScrollTop` copies or parallel render-vs-live accumulators).
  - Pending facts (prepends, row resizes, `ThreadTimelineHeader` resize, `ThreadLoadingLines`, streaming frames, footer/viewport RO) accumulate in a pending delta queue and apply in **one** commit-time `useLayoutEffect` writer (pre-syncing `virtualizer.scrollOffset` before render whenever a commit shifts `scrollTop` so zero blank `visibleCount: 0` frames occur).
  - All pins (`useThreadOpeningPin`, shared `useBottomPinRequests`, streaming, footer) and jumps (`useThreadJumpTarget`, `useEditedRowInView`, Jump to Latest, status-bar tap, `InsetScrollbar` drag/keys) route through this single decision; **user input always wins** (active touch suppresses streaming/footer pins; any gesture cancels open/jump pins).
  - `InsetScrollbar` and `TimelineMinimap` receive an imperative `onExtentChange` callback on threads instead of attaching shallower `ResizeObserver(contentRef)` listeners, eliminating `heldListHeight`, `listShrinkNotRendered`, and `useListEndClamp` on threads.

---

## 4. Prototype Results & Evidence (`m2` Mac Runner, Branch `proto/thread-scroll-headroom`)

Tested on `basnijholt-macbook-pro-m2` (real macOS Playwright WebKit + Chromium) against both an isolated hard-case harness (`0a8f42e1c`) and the full `e2e/threads/thread-timeline-jumps.live.spec.ts` fast upward wheel-scroll reproducer (24 bursts × 16 × `-240 px`, 220/450 ms pauses, 150 ms stall on `|ΔscrollTop| >= 48 px`):

| Case / Variant (commit) | Engine & Viewport | Result | Measured Evidence |
|---|---|---|---|
| Standalone harness: headroom absorbs prepend mid-burst (`0a8f42e1c`) | WebKit desktop (1440×900) & phone-size (390×844) | **PASS** | `maxUnexplained=0`, `maxReversal=0`, `lostPlace=0`, `totalRow=3840` (`totalWheel=-3840`) |
| **Hard case (a):** headroom=0 (`zero`), raw `+11,706 px` prepend write mid-burst (`ec78abdeb`) | WebKit desktop & phone-size | **FAIL** | WebKit discarded write (`appDelta=11706, dScroll=-240/-11946`), replayed `+11706` 103 ms later (`lostPlace=2`, `burstDrift=-480px`) |
| **Hard case (b1):** trim at 150 ms into 220 ms pause (`122110a4c` `hard-b-overtaken`) | WebKit desktop | **FAIL** | Overtaken by burst 2 + emptied headroom early (`writes=17`, `reversal=146px`, `burstDrift=+3244px`) |
| **Hard case (b2):** same with `overflow-y: hidden` takeover (`122110a4c` `trim-takeover`) | WebKit desktop | **FAIL** | Dropped wheel notches (`burstDrift=-480/-240px`), `reversal=152px`, `burstDrift=+3144px` |
| **Hard case (b3):** mid-burst `nearTop` trim (`122110a4c` phone `frame 780`, `-3,372 px`) | WebKit phone-size | **FAIL** | WebKit discarded `-3372` (`dScroll=+3132, median=-3132`), `reversal=3132px` |
| **Headroom + unmeasured-row cushion + 260 ms idle excess trim (`44b876244`)** | Chromium desktop (1440×900) | **PASS** | `writes=3`, `scrolled=63,484px`, `reversal=0`, `unexplained=0`, `spread=0`, `lostPlace=0` |
| **Headroom + unmeasured-row cushion + 260 ms idle excess trim (`44b876244`)** | **WebKit desktop (1440×900, un-fixme'd)** | **PASS** | `writes=3`, `scrolled=63,474px`, `reversal=0`, `unexplained=0`, `spread=0`, `lostPlace=0` |
| **Headroom + unmeasured-row cushion + 260 ms idle excess trim (`44b876244`)** | **WebKit phone-size (390×844)** | **PASS** | `writes=2`, `scrolled=64,328px`, `reversal=0`, `unexplained=0`, `spread=0`, `lostPlace=0` |

**Takeaway:** Headroom with open-time top-up + unmeasured-row cushion keeps the `test.fixme` WebKit fast-scroll spec **100% green (`0` reversal, `0` unexplained, `0` spread, `0` lostPlace)** on both WebKit desktop and WebKit phone-size. Prototyping also disproved `overflow-y: hidden` mid-scroll takeover (drops wheel ticks) and exposed phone text-wrap growth (~13k px after history loads).

---

## 5. What Gets Deleted & Honest Net-Line Estimate

- **Whole files deleted in this PR (247 lines):** `threadScrollLedger.ts` (95), `useThreadOpeningReveal.ts` (60), `useThreadPrependViewport.ts` (27), `threadBackPaginationController.ts` (65).
- **Thread branches deleted from shared files (~550–650 lines):** `timelineScrollLedgerController.ts` (~300), `roomFocusScrollController.ts` (~220, incl. thread paths in `useBottomPinRequests` & `useEditedRowInView`), `roomTimelineScroll.ts` (~80), `threadRenderUtils.ts` (`shouldPinThreadToBottomOnOpen`, ~30), `RoomTimeline.tsx` (~100).
- **New code added (~750–950 lines):** `threadScrollOwner.ts` (~320), `useThreadScrollOwner.ts` (~420), `InsetScrollbar`/`TimelineMinimap` extent hook + `enabled: !threadId` guards + arch test (~110).
- **Honest net product lines (this PR):** **≈ −150 to +50 lines** (roughly break-even while room stays on the old ledger; exact count taken from the real diff). The major net deletion (**≈ −1,800+ lines**) lands in the follow-up PR when room migrates and deletes `timelineScrollLedgerController.ts`, `roomScrollLedger.ts`, `clampedScrollCorrection.ts`, `useListEndClamp.ts`, `useFooterBottomPin.ts`, `useFollowContentGrowth.ts`, `useTimelineBulkExpansionAnchor.ts`, `scrollQuiescence.ts`, and `isDiscardedSettleWrite`.

---

## 6. Feature-Flagged Migration Plan (One Branch, One PR)

All 8 thread scroll specs (`thread-timeline-jumps.live`, `thread-fast-scroll-overlap.live`, `thread-prepend-scroll.live`, `thread-scroll-stability.live`, `thread-open-chain-prepend-anchor.live`, `thread-first-open-paints-once`, `thread-ride-under-latency.live`, `unread-thread-open-landing`) stay green on every commit:

1. **Commit 1 — Write funnel, architecture test & black-box ride probe:** Add `threadScrollWriter.ts` single funnel + architecture test checking both zero non-owner writes on threads and `scrollToFn: () => {}` once enabled. Replace white-box `marginTop` / `ledgerBoundarySettles` assertions in `thread-ride-under-latency.live.spec.ts:562,606-607` and `e2e/helpers/rideRecorder.ts:432` with black-box blank-band px and max-jump checks.
2. **Commit 2 — Extent hooks, `enabled` guards & routed `resizeItem`:** Add `onExtentChange` prop to `InsetScrollbar` / `TimelineMinimap`, `enabled: !threadId` (attaching zero ROs when disabled) to `useFooterBottomPin`, `useFollowContentGrowth`, `useListEndClamp`, `useTimelineBulkExpansionAnchor`, and route `useThreadApprovalRowMeasurements` / `useTurnBreakRowMeasurements` through an owner `resizeRow` callback.
3. **Commit 3 — Owner behind `localStorage` flag (`mr.threadScrollOwner=1`):** Land `threadScrollOwner.ts` + `useThreadScrollOwner.ts` (including `useBottomPinRequests` and `useEditedRowInView` routing) behind the flag, with unit + real-virtual-core contract tests. Run all 8 specs on **both** paths (flag off and flag on).
4. **Commit 4 — Flip default & un-fixme WebKit fast-scroll:** Make `useThreadScrollOwner` the default, verify all 8 specs on Chromium + WebKit (desktop & phone-size), and **un-fixme** `e2e/threads/thread-timeline-jumps.live.spec.ts:462`.
5. **Commit 5 — Delete dead thread code & flag:** Remove the flag and delete the 4 thread-only files + dead thread branches; tighten the architecture test to unconditional enforcement and report real net lines from `git diff --stat`.

---

## 7. Risks & Alternatives

- **Rejected alternatives:** (1) *Funneling the old `marginTop` ledger* — preserves negative-margin hidden rows, 9 bottom truths, and WebKit settle discard/replay. (2) *JS `originShiftPx` hidden debt* — same negative-coordinate failure mode as `marginTop`, violates invariant 1, still races WebKit on rebase. (3) *Zero-headroom commit writes* — kills iOS momentum and fails WebKit hard case (a) (`lostPlace=2`). (4) *`flex-direction: column-reverse`* — WebKit `position: sticky` bugs, flips streaming stability when reading history, breaks scrollbar/status-bar/e2e `scrollTop` contracts.
- **Main risks:** (1) *Severe headroom underestimation* on unusually media-heavy threads (can still hit hard case (a) on WebKit; mitigated by generous `260 px/event` + `28k` floor while opening). (2) *iOS 16.4–26.1 without `scrollend`* relies on `activeTouches === 0` + idle timer for excess trim (safe because trim never runs mid-touch/momentum and never clamps at `0`). (3) *Scrollbar thumb proportion* briefly reflects estimated headroom until excess trims after history completes.
