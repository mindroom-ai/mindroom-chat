# Upstream PR drafts (`@tanstack/virtual-core` `packages/virtual-core/src/index.ts`)

## PR 1: Opt-in `holdScrollDuringWheel` to hold `scrollTop` writes during live wheel gestures

**Problem & repro:** On desktop WebKit, synchronous `scrollTop` writes from `applyScrollAdjustment` during a live `wheel` stream fight WebKit's scrolling tree, which replays pre-write offsets over the adjustment. Expose an opt-in `holdScrollDuringWheel?: boolean` option (default `false`) so callers enable it only on desktop WebKit without UA sniffing inside the library or affecting Chromium/Firefox. Mount an `anchorTo: 'end'` vertical `Virtualizer` (~100 variable-height items at bottom) in desktop WebKit, dispatch upward `wheel` ticks (`deltaY: -120` every ~16 ms) while prepending 50-item pages near the top, and observe >1,000 px anchor jumps.

```diff
+  holdScrollDuringWheel?: boolean // VirtualizerOptions (default false)
+  private _wheelLive = false
+  private _wheelTimer: ReturnType<typeof setTimeout> | null = null
+  private _wheelSince = 0
   // cleanup(): reset _wheelLive = false, clearTimeout(_wheelTimer), _wheelTimer = null, _wheelSince = 0.
   // _willUpdate() (`if ('addEventListener' in this.scrollElement)`):
+  const scheduleWheelFlush = (delay: number) => {
+    if (!this.targetWindow) return
+    this._wheelLive = true
+    if (this._wheelTimer !== null) this.targetWindow.clearTimeout(this._wheelTimer)
+    this._wheelTimer = this.targetWindow.setTimeout(() => {
+      const live = this._readElementOffset()
+      if (live !== null && this._lastElementOffset !== null && Math.abs(live - this._lastElementOffset) >= 1 && this.now() - this._wheelSince < 1e3) {
+        this._lastElementOffset = live; scheduleWheelFlush(50); return
+      }
+      this._wheelTimer = null; this._wheelLive = false
+      const heldBefore = this._holdOffset
+      this._flushHoldIfReady(true)
+      if (this._holdOffset < 0 && this._holdOffset === heldBefore) this.notify(true)
+      this._retryClampedAdjustment()
+    }, delay)
+  }
+  const onWheel = () => { if (!this.options.holdScrollDuringWheel) return; if (!this._wheelLive) this._wheelSince = this.now(); scheduleWheelFlush(150) }
+  el.addEventListener('wheel', onWheel, addEventListenerOptions)
+  this.unsubs.push(() => el.removeEventListener('wheel', onWheel))
-  private _canWriteScroll = () => !(isIOSWebKit() && this._iosGesture.inMotion()) && !this._reportedOverscroll
+  private _canWriteScroll = () => !(isIOSWebKit() && this._iosGesture.inMotion()) && !this._reportedOverscroll && !(this._wheelLive && this.options.holdScrollDuringWheel)
```

## PR 2: Reconcile unseen live `scrollTop` moves in `applyScrollAdjustment`

**Problem & repro:** If iOS momentum scrolling during `lateFling` (`_iosGesture.inMotion() === false`) or synchronous app/driver code moves `scrollElement.scrollTop` before a `scroll` event delivers the new offset, `applyScrollAdjustment` writes from the stale cached `scrollOffset` and snaps the scroller back. Reproduce on iOS by finishing a moved touch drag into `lateFling`, advancing `el.scrollTop` from `1000` to `960` without a `scroll` event, and calling `resizeItem(aboveIdx, size + 80)` (lands at `1080` instead of `1040`); or on desktop by mutating `el.scrollTop += 200` (without a `scroll` event) then calling `resizeItem(aboveIdx, size - 20)` (lands at `old - 20` instead of `old + 180`).

```diff
-  const offset = this.getScrollOffset() // in applyScrollAdjustment() else-branch
+  const live = this._holdOffset === 0 && this._clampedAdjustment === null ? this._readElementOffset() : null
+  const offset = live !== null && this._lastElementOffset !== null && live !== this._lastElementOffset && (this.pendingWrite === null || !approxEqual(live, this.pendingWrite.target)) ? live : this.getScrollOffset()
-  if (this.pendingWrite === write) this.scrollOffset += delta
-  if (this.scrollOffset < 0) this.scrollOffset = 0
+  if (this.pendingWrite === write) this.scrollOffset = offset + delta
+  if (this._holdOffset === 0 && this.scrollOffset < 0) this.scrollOffset = 0
```

## PR 3: Never flush negative `_holdOffset` past `scrollTop = 0`

**Problem & repro:** While scroll writes are held (`!this._canWriteScroll()`), negative size deltas (rows above the viewport shrinking on first measurement) accumulate a negative `_holdOffset`. If the reader then scrolls upward until `live + _holdOffset < 0`, `_flushHoldIfReady` zeroes `_holdOffset` while `scrollTop` clamps at `0`, snapping every visible row upward by `-(live + _holdOffset)`. Flush only the portion that fits above `0` (`nextHold = live + _holdOffset < 0 ? live + _holdOffset : 0`), leaving the excess held without snapping until a prepend or downward scroll provides room above `0` (notifying once when wheel or iOS gesture rest keeps a clamped negative hold, so callers at true history start can clear it).

```diff
   // _flushHoldIfReady(sync):
-  this._holdOffset = 0
-  if (this.scrollOffset !== null && this.scrollOffset < 0) {
-    this.scrollOffset = 0
-  }
+  const cmd = this.getCommandWrittenOffset()
+  const live = cmd === null ? this._readElementOffset() : null
+  const nextHold = live !== null && live + this._holdOffset < 0 ? live + this._holdOffset : 0
+  if (nextHold === this._holdOffset) {
+    if (live !== null) this.scrollOffset = nextHold
+    return
+  }
+  this._holdOffset = nextHold
+  if (nextHold < 0) {
+    this.scrollOffset = nextHold; this._clampedAdjustment = null
+    this._scrollToOffset(nextHold); this.notify(sync); return
+  }
+  if (this.scrollOffset !== null && this.scrollOffset < 0) {
+    this.scrollOffset = 0
+  }
   this.notify(sync)
-  const target = this.getCommandWrittenOffset() ?? this.getScrollOffset()
+  const target = cmd ?? this.getScrollOffset()
```

## PR 4: Opt-in `anchorSkipLeading` to skip stable leading items in view when picking the `anchorTo: 'end'` prepend anchor

**Problem & repro:** When an `anchorTo: 'end'` list renders caller-owned stable leading items (e.g., a room `[+all]`/intro tile at index 0, or a thread "Load Older" chip and root at indices 0–1) and prepends older items after them while `scrollOffset` sits within that prefix, `getVirtualItemForOffset(scrollOffset)` returns a leading item whose key stays at its index (`merged.getItemKey(item.index) === getPreviousKey(item.index)`). `setOptions` then computes `newOffset = scrollOffset` and pushes every visible item down by the prepended height. Expose an opt-in `anchorSkipLeading?: number` option (default `0`, preserving upstream behaviour) so callers declare only their true leading prefix without accidentally skipping content rows (such as an expanding membership fold at index 1 in a room). Never advance onto an item whose `start >= scrollOffset + this.getSize() / 2`, so reading a tall leading item (such as an expanded thread root, even below a fixed-height thread header above the list) never jumps when items arrive below the top half of the viewport. Skip runs only when the list grows (`nextCount > prevCount`), because same-count reorders must anchor normally.

```diff
+  anchorSkipLeading?: number // VirtualizerOptions (default 0)
   // setOptions() inside `if (didEdgeKeysChange)` (already gated on `merged.anchorTo === 'end'`):
-  const item = prevCount > 0 ? this.getVirtualItemForOffset(this.getScrollOffset()) ?? measurements[0] : null
-  if (item) {
-    anchor = [item.key, this.getScrollOffset() - item.start]
-  }
+  const scrollOffset = this.getScrollOffset()
+  let item = prevCount > 0 ? this.getVirtualItemForOffset(scrollOffset) ?? measurements[0] : null
+  while (nextCount > prevCount && item && item.index < merged.anchorSkipLeading && item.index + 1 < prevCount && item.index < nextCount && merged.getItemKey(item.index) === getPreviousKey(item.index)) {
+    const next = measurements[item.index + 1]
+    if (!next || next.start >= scrollOffset + this.getSize() / 2) break
+    item = next
+  }
+  if (item) {
+    anchor = [item.key, scrollOffset - item.start]
+  }
```

## PR 5: Keep iOS gesture tail open while `_holdOffset !== 0` and unify live-offset rebase in `_flushHoldIfReady`

**Problem & repro:** During an iOS momentum fling, `scroll` events can pause for >=150 ms while `scrollTop` is still moving. `_iosGesture`'s `tailStillMoving()` only checked live `scrollTop` movement when a scroll command was queued (`scrollState?.phase === 'queued'`), so an active `_holdOffset` (with `scrollState === null`) flushed prematurely straight into the live fling. In addition, when the iOS tail closed after unseen `scrollTop` movement (whether >=1 px checked by `tailStillMoving()` or sub-1 px quiet-tail drift), `_flushHoldIfReady` wrote from the stale cached `scrollOffset` instead of rebasing from `live` (unlike the desktop wheel flush path). Extending `tailStillMoving()` to also check live element movement when `this._holdOffset !== 0` (appending to `state.samples` only when `queued`) keeps the tail open until momentum settles, and moving the live-offset rebase (preserving any pre-gesture `_clampedAdjustment` shortfall) into `_flushHoldIfReady` makes it the single owner for both iOS gesture and desktop WebKit wheel flushes. Reproduce on iOS by starting a touch drag, resizing an above-viewport item (+200 px) to accumulate `_holdOffset = 200`, firing `touchend`, advancing `el.scrollTop` by -20 px without a `scroll` event, and waiting 150 ms: without this fix `_holdOffset` flushes immediately into the fling to stale `oldScroll + 200`; with this fix `_holdOffset` stays `200` while moving and flushes cleanly to `live + 200` once steady.

```diff
   // _iosGesture host tailStillMoving():
-  const state = this.scrollState
-  if (state?.phase !== 'queued' || this.pendingWrite !== null) {
+  const state = this.scrollState
+  const queued = state?.phase === 'queued'
+  if ((!queued && this._holdOffset === 0) || this.pendingWrite !== null) {
     return false
   }
   const now = this._readElementOffset()
   if (now === null || this._lastElementOffset === null || Math.abs(now - this._lastElementOffset) < 1) {
     return false
   }
   this._lastElementOffset = now
-  state.samples = [...(state.samples ?? []), { t: this.now(), offset: now }]
+  if (queued) {
+    state.samples = [...(state.samples ?? []), { t: this.now(), offset: now }]
+  }
   return true

   // _flushHoldIfReady(sync) — before `this._holdOffset = nextHold` (removes duplicate rebase from scheduleWheelFlush):
+  if (live !== null && nextHold === 0) {
+    const clamped = this._clampedAdjustment
+    const clampShortfall =
+      clamped !== null && Math.abs(live - clamped.maxAtWrite) < 1.5
+        ? clamped.target - clamped.maxAtWrite
+        : 0
+    this.scrollOffset = this._toLayoutOffset(live) + clampShortfall
+  }
```
