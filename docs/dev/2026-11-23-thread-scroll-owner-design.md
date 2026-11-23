# Thread Timeline Scroll Owner — Design & Migration Plan

**Status:** Revised after round-2 Opus + Astra review & m2 prototype closure (based on `main` @ `d4c629d13`, prototype `proto/thread-scroll-headroom` @ `4655a1250`)
**Scope:** Single `scrollTop` owner for the **thread timeline** (room timeline deferred to follow-up via `!ownerEnabled` guards; disabled legacy hooks attach no `ResizeObserver`, while the flag-off path keeps today's thread fixes intact).

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
| 16 | **`@tanstack/virtual-core` 3.17.3** (`_willUpdate`, `anchorTo`, `reconcileScroll`, `_iosDeferredAdjustment`, `applyScrollAdjustment`) | Attach `_willUpdate` calls `_scrollToFn(getScrollOffset())`; `resizeItem` (incl. `useThreadApprovalRowMeasurements` & `useTurnBreakRowMeasurements`); `scrollToIndex` | Stale cached `scrollOffset`, lazy `measurementsCache` Proxy, private `scrollAdjustments` | Races ledger baseline, clamps at end, kills iOS momentum or replays banked lurch |
| 17 | **Browser itself** | Native shrink clamp; Chromium `overflow-anchor: auto`; WebKit container-query pre-style layout; WebKit scrolling-thread discard/replay; iOS momentum & rubber-band | Browser layout tree & async scrolling thread | Discards/replays JS `scrollTop` writes during wheel/scrub; clamps before commit |

### Duplicate sources of truth on `main`
- **List height (4):** `virtualizer.getTotalSize()`, `heldListHeight()`, `scrollElement.scrollHeight`, `scrollHeight - listShrinkNotRendered()`.
- **Reader's anchor (6):** `threadLedgerAnchorRef`, `useTimelineBulkExpansionAnchor` `anchorRef`, `pinnedPositionRef`, `threadTargets`, room `roomLedgerAnchorRef` / `useVirtualPaginator` `anchorRef`.
- **"At bottom" (9):** `atBottom`/`atBottomRef` (IntersectionObserver), `isScrollNearBottom` (120 px), `<= 1 px` checks (3 places), `useFooterBottomPin` `readerAtBottom`, `useFollowContentGrowth` `pinned`, `useLatestRowRequest` `requestRef`, `useTimelineBulkExpansionAnchor` (24 px), `scrollToBottomRef.count`, `threadBackPaginationController.suppressed`.

---

## 2. Invariants (Thread Timeline) & Exhaustion Priority

1. **Every loaded row can be scrolled to:** `headroomPx >= 0` always; no loaded row is placed at `top < 0` or hidden behind a negative margin.
2. **Native gesture & momentum preservation (highest priority):** While a touch is active, a scrollbar thumb drag is live, iOS momentum/rubber-band is running, or a wheel/scroll burst is active, the owner issues **zero** `scrollTop` writes. User input always wins.
3. **Anchor stability:** Unless the user scrolls or initiates a jump, the anchor row's viewport `top` moves `≤ 1 px` across prepends, above-anchor row resizes, banner/leading resizes, and bulk expand/collapse (bounded by headroom availability — see exhaustion rules below).
4. **Bottom-pin fidelity:** While pinned (`open`, `jump`, own send, or resting at live end), the newest visible row stays flush (`scrollHeight - clientHeight - scrollTop ≤ 1 px`, zero blank band) until a user gesture releases the pin.
5. **One-paint opening & zero overlap:** Open-at-latest threads stay hidden until the first commit at true bottom with the last non-relation tile mounted; newly mounted or resized rows commit updated tile `top` positions before paint.
6. **Non-blank reserve & reachability of row 0:** Any positive headroom above row 0 renders loading chrome + skeleton rows (never pure blank). Once `!hasMoreHistory`, a reader in or near the reserve reaches row 0 via one rest-time trim targeting row 0.

### Explicit Invariant Trade-offs on Exhaustion (Which Invariant Gives Way)
- **Prepend arrives mid-gesture with insufficient headroom (`estimatedPrependPx > committedHeadroomPx`):** **Page-display immediacy gives way** — the fetched page is held out of `threadEvents` until genuine scroll rest, when the single layout effect tops up headroom and releases the page. Invariants 2 (zero mid-gesture writes) and 3 (anchor stability) hold.
- **Row grows above the reader with zero headroom (e.g. late image load):** **Anchor stability gives way** — `headroomPx` clamps at `0` and the owner accepts anchor drift rather than issuing a mid-gesture `scrollTop` write. Invariant 2 (zero mid-gesture writes) holds.
- **Fast flick outruns slow network pages into the reserve (`scrollTop < headroomPx`):** **Hard-stop clamping at row 0 gives way** — the reader glides into the skeleton reserve while pages are in flight; incoming pages fill the reserve from the bottom up (`headroomPx -= foldPx`), and once history completes a single rest-time trim brings the reader to row 0.

---

## 3. Design: Headroom + Single Commit-Time Owner (`useThreadScrollOwner`)

### Positive Headroom Budget, Reserve Chrome, Top-Up & Rest-Time Trim
- **Coordinate layout:** `inner.style.marginTop` is always `''`. Virtualizer receives `scrollMargin: headroomPx`; tiles render at `top: item.start` (`headroomPx + rawStart`); `inner.style.height = headroomPx + virtualizer.getTotalSize()`. `ThreadLoadingLines` stays in `leadingRef` above the list; `ThreadHeadroomReserve` renders sticky loading chrome + 8 skeleton rows across `[0, headroomPx)` so landing anywhere inside the reserve (Home, thumb drag, long flick) never shows pure blank space.
- **Budget & running average:**
  `avgRowHeight = totalMeasuredAndEstimatedSize / measurementsCache.length` (including 0-height folded/hidden rows so agent threads do not inflate the average), with `budget = max(unloadedReplies * avgRowHeight + unmeasuredVisible * perUnmeasured + 2 * viewH, 4 * viewH)`.
  Authoritative `expectedThreadEvents` reads `threadReplyCountMap`, `getKnownThreadReplyCount(root)`, `room.getThread(threadId).length`, and `threadRecord.presentation.messageCount`.
- **Consuming headroom & reserve-fill (zero `scrollTop` writes):** Prepends and above-anchor row growth (`Δ > 0`) consume headroom (`headroomPx -= Δ`); shrink (`Δ < 0`) adds headroom (`headroomPx += |Δ|`). When the reader is inside the reserve (`anchor === undefined && headroomPx > 0`), prepends anchor on the earliest existing non-root reply so new pages consume headroom and fill the reserve from the bottom up.
- **Continuous rest-time top-up:** Whenever `hasMoreHistory && committedHeadroomPx < 2 * viewH` (including **after** the first user scroll), the same idle/rest gate used for trimming tops up headroom back to `budget`. On open completion (`!threadUserScrolled && !hasMoreHistory`), desktop trims headroom to `0` while mobile (`viewW < 600`) retains a small wrap cushion capped at `min(unmeasuredVisible * 12, 2 * viewH)` so scrolling up through unmeasured mobile rows stays drift-free.
- **Rest-time trim (never overtaken, targets row 0 in reserve):**
  - Trim runs **only** when `!hasMoreHistory && nearTop` (`scrollTop <= headroomPx + 1.5 * viewH`) **and** input is genuinely at rest: `!hasActiveWindowTouches()`, `!isScrollerRubberBanding(el)`, `!el.dataset.scrollbarDragging`, `!scrollSessionLive` (`scrollend` where supported), and `>= 500 ms` since any `scroll`/`wheel`/`touch*` activity with exact `scrollTop` stability across checks. (500 ms clears 300 ms wheel pauses safely; on touch, gating on `activeTouches`, `rubberBanding`, and scroll-idle prevents premature trims when `wheel` never fires.)
  - When `scrollTop < headroomPx` (reader inside the reserve via Home, thumb drag, or long flick), one rest-time trim sets `nextHeadroom = 0, targetScrollTop = 0` to land on row 0 (not `min(excess, scrollTop)`, which would remove 0 px at `scrollTop = 0`). Otherwise it trims `headroomPx - keepCushion` and shifts `scrollTop` by `-trim`.

### Pure Render Snapshot + Single Commit-Time Writer (No Snapshot/Live Split)
- **Virtualizer strictly read-only:** Pass `scrollToFn: () => {}` and `shouldAdjustScrollPositionOnItemSizeChange: () => false` (routing above-reader resize deltas, offset by pending unrendered queue delta, into a sequence-numbered `aboveResizeQueue`); set `overflowAnchor: 'none'`.
- **Pure render (`computeHeadroomRenderSnapshot`):** Reads **only** `gate.committedHeadroomPx` plus queued facts (`prependFoldPx`, `leadingFoldPx`, `aboveResizeQueue`), returning `{ headroomPxAtRender, renderedResizeSeq, zeroHeadroomDrift }`. Render never reads live `scrollTop`, never calls `Date.now()`, and never decides trim/top-up.
- **Intent-driven single commit-time `useLayoutEffect`:**
  1. Clears **only** resize queue entries consumed by this render (`entry.seq > renderedResizeSeq`) — measurements arriving between render and commit are preserved and trigger a follow-up commit rather than being dropped.
  2. Idle timer enqueues an intent (`idleIntentQueued = true`) + bumps commit tick; the layout effect decides priority (`held-release` > `topup` > `nearTop trim`).
  3. Performs an **atomic extent+scroll transition**: captures one absolute target before shrinking (or pre-grows `inner.style.height` before writing when growing), writes `scrollElement.scrollTop` once, reconciles `virtualizer.scrollOffset` immediately to the actual DOM result (eliminating near-bottom double moves under native clamping and avoiding out-of-sync intermediate virtualizer windows), and bumps the synchronous pre-paint commit.

---

## 4. Prototype Results & Evidence (`m2` Mac Runner, `proto/thread-scroll-headroom`)

Verified on `basnijholt-macbook-pro-m2` (`tsc --noEmit -p tsconfig.json` PASS, `vitest run src/app/timeline/` PASS):

### Round-2 Matrix — 4× Repeats (`--repeat-each=4`, `610e6e85c`, `MR_THREAD_SCROLL_OWNER=1`, **64/64 PASS**)

| Case | Chromium desktop | WebKit desktop | WebKit phone | Notes / Measured Evidence |
|---|---|---|---|---|
| Fast upward wheel (un-fixme'd) | **4/4 PASS** | **4/4 PASS** | **4/4 PASS** | `reversal=0, unexplained=0, spread=0, lostPlace=0` (1–2 writes) |
| 300 ms-pause upward wheel | **4/4 PASS** | **4/4 PASS** | **4/4 PASS** | `reversal=0, unexplained=0, spread=0, lostPlace=0`; trim never overtaken |
| Exhausted headroom (`cap=1200`) | **4/4 PASS** | **4/4 PASS** | **4/4 PASS** | 4 pages held until rest, 1 rest top-up; zero-headroom growth drift = 0 writes |
| Home key + thumb drag to top | **4/4 PASS** | **4/4 PASS** | **4/4 PASS** | 6 skeleton rows visible in reserve; rest trim -> `headroom=0, scrollTop=0, row0=true` |
| Active touch trim gating | **4/4 PASS** | **4/4 PASS** | **4/4 PASS** | Trim deferred while touch active; trims cleanly after `touchend` + idle |
| Real CDP touch-swipe (Chromium phone) | — | — | **4/4 PASS** (Chr phone) | `reversal=0, unexplained=0, spread=0, lostPlace=0` |

**Touch testing status:** Playwright WebKit on `m2` only supports `touchscreen.tap()` (no touch-move/flick dispatch; `e2e/computer/computer-touchpad.spec.ts:26`). Real touch-swipe is covered on Chromium phone via CDP and active-touch trim gating is covered on WebKit phone, **so a real iPhone flick hand test from Bas is required before flipping the flag.**

### Full 8 Thread Specs Once with `MR_THREAD_SCROLL_OWNER=1` (`610e6e85c` + `4655a1250`, identical `src/`)

| Spec | Result | Notes |
|---|---|---|
| `thread-fast-scroll-overlap.live` | **PASS (1/1)** | Zero overlap/separation |
| `thread-open-chain-prepend-anchor.live` | **PASS (3/3)** | ≤1 px drift (Load Older, scrolled-up, and root anchor) |
| `thread-prepend-scroll.live` | **PASS (1/1)** | `maxDriftPx=0` |
| `thread-first-open-paints-once` | **PASS (1/1)** | 6.3 s at `4655a1250` (overview card-click detach flake in batch run at `610e6e85c`) |
| `unread-thread-open-landing` | **PASS (4/4)** | Chromium & WebKit × desktop & phone |
| `thread-scroll-stability.live` | **PASS (4/4)** | Chromium & WebKit × desktop & phone |
| `thread-timeline-jumps.live` | **26/28 PASS** | Opening 4/4, cold bottom 4/4, cold mid phone 2/2, 16 scroll/new cases 16/16; **2 fail**: desktop cold-open mid-thread 28 px seam-row turn-break shift at `threadCount 21->41` |
| `thread-ride-under-latency.live` | **3/5 PASS** | `LATENCY-RIDE` (`0/0/[]`), `SUSTAINED-RIDE` (`gap=11/jump=0`), `HYDRATION-PIN` (`0/0`) PASS; **2 fail** (inherent headroom trade-offs): `COMPOSITOR-RIDE` (`gap=0, leadGap=81`, fails `trackedIntervals 66/584` when 4,500 px/s fling outruns 1.5 s fetch into reserve); `LEDGER-BOUNDARY` (`gap=11, blank=0, writes=0`, fails `maxJump=608` on rest-time trim of unused mobile cushion at `scrollTop=0`) |

---

## 5. What Gets Deleted & Net Lines

- **Whole files deleted in this PR (247 lines):** `threadScrollLedger.ts` (95), `useThreadOpeningReveal.ts` (60), `useThreadPrependViewport.ts` (27), `threadBackPaginationController.ts` (65).
- **Thread branches deleted from shared files (~550–650 lines):** `timelineScrollLedgerController.ts`, `roomFocusScrollController.ts`, `roomTimelineScroll.ts`, `threadRenderUtils.ts`, `RoomTimeline.tsx`.
- **Net lines:** **about break-even for threads; the payoff comes with the room follow-up** (which deletes `timelineScrollLedgerController.ts`, `roomScrollLedger.ts`, `clampedScrollCorrection.ts`, `useListEndClamp.ts`, `useFooterBottomPin.ts`, `useFollowContentGrowth.ts`, `useTimelineBulkExpansionAnchor.ts`, `scrollQuiescence.ts`, and `isDiscardedSettleWrite`).

---

## 6. Feature-Flagged Migration Plan (One Branch, One PR)

All legacy hooks stay gated on **`!ownerEnabled`** (never `!threadId`) until the flag is removed, so the flag-off path preserves every existing thread fix on every commit:

1. **Commit 1 — Write funnel, architecture test & headroom-aware e2e harnesses:** Add `threadScrollWriter.ts` funnel + architecture test; keep legacy white-box assertions gated on flag-off while preserving all black-box gap/jump checks.
2. **Commit 2 — Extent hooks, `!ownerEnabled` guards & routed `resizeItem`:** Gate `useListEndClamp`, `useFooterBottomPin`, `useFollowContentGrowth`, `useTimelineBulkExpansionAnchor`, and `useThreadPrependViewport` on `!ownerEnabled`; mark `InsetScrollbar` thumb drag (`dataset.scrollbarDragging`); route `useThreadApprovalRowMeasurements` & `useTurnBreakRowMeasurements` through owner `resizeRow`.
3. **Commit 3 — Owner behind `localStorage` flag (`mr.threadScrollOwner=1`):** Land `threadScrollOwner.ts` + `useThreadScrollOwner.ts` + `ThreadHeadroomReserve` behind the flag with unit + real-virtual-core contract tests; verify all 8 specs on flag-off and flag-on (closing the 28 px desktop seam-row turn-break case and deciding `COMPOSITOR-RIDE`/`LEDGER-BOUNDARY` expectations).
4. **Commit 4 — Real iPhone hand test, flip default & un-fixme WebKit fast-scroll:** Complete Bas's real iPhone flick hand test, make the owner default, and un-fixme WebKit fast-scroll + retain the 300 ms-pause, exhausted-headroom, Home/thumb, and touch specs.
5. **Commit 5 — Delete dead thread code & flag:** Remove the flag and delete the 4 thread-only files + dead thread branches; tighten the architecture test unconditionally.

---

## 7. Risks & Alternatives

- **Rejected alternatives:** (1) *Funneling the old `marginTop` ledger* — keeps negative-margin hidden rows and WebKit settle discard/replay. (2) *JS `originShiftPx` hidden debt* — same negative-coordinate failure mode. (3) *Zero-headroom commit writes* — kills iOS momentum and fails WebKit hard case (a). (4) *`flex-direction: column-reverse`* — WebKit sticky bugs, breaks scrollbar/e2e `scrollTop` contracts.
- **Open trade-offs / risks:** (1) *Fast fling into reserve (`COMPOSITOR-RIDE`)* — high-velocity flings faster than network fetches glide into the skeleton reserve rather than hard-clamping at row 0 until pages fill in or rest trims. (2) *Mobile wrap cushion vs top-trim snap (`LEDGER-BOUNDARY`)* — keeping a ≤2-viewport mobile cushion eliminates mid-ride wrap drift (`SUSTAINED-RIDE` `0` jumps) at the cost of a rest-time trim snap if the reader rides straight past row 0 to `scrollTop=0`. (3) *Untested iOS WebKit momentum flicks* — requires a real iPhone hand test from Bas before flipping the flag. (4) *Scrollbar thumb proportion* briefly reflects estimated headroom until excess trims at rest.
