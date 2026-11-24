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
+      if (live !== null && this._holdOffset !== 0) this.scrollOffset = Math.max(0, live + this._holdOffset)
+      this._flushHoldIfReady(true); this._retryClampedAdjustment()
+    }, delay)
+  }
+  const onWheel = () => { if (!this.options.holdScrollDuringWheel) return; if (!this._wheelLive) this._wheelSince = this.now(); scheduleWheelFlush(150) }
+  el.addEventListener('wheel', onWheel, addEventListenerOptions)
+  this.unsubs.push(() => el.removeEventListener('wheel', onWheel))
-  private _canWriteScroll = () => !(isIOSWebKit() && this._iosGesture.inMotion()) && !this._reportedOverscroll
+  private _canWriteScroll = () => !(isIOSWebKit() && this._iosGesture.inMotion()) && !this._reportedOverscroll && !(this._wheelLive && this.options.holdScrollDuringWheel)
```

## PR 2: Reconcile unseen live `scrollTop` moves in `applyScrollAdjustment`

**Problem & repro:** If app/driver code writes `scrollElement.scrollTop` synchronously and an item resizes before the `scroll` event delivers the new offset, `applyScrollAdjustment` writes from the stale cached `scrollOffset` and snaps the scroller back. Reproduce by mutating `el.scrollTop += 600` (without a scroll event) then calling `resizeItem(aboveIdx, size - 20)`.

```diff
-  const offset = this.getScrollOffset() // in applyScrollAdjustment() else-branch
+  const live = this._holdOffset === 0 && this._clampedAdjustment === null ? this._readElementOffset() : null
+  const offset = live !== null && this._lastElementOffset !== null && live !== this._lastElementOffset && (this.pendingWrite === null || !approxEqual(live, this.pendingWrite.target)) ? live : this.getScrollOffset()
-  if (this.pendingWrite === write) this.scrollOffset += delta
+  if (this.pendingWrite === write) this.scrollOffset = offset + delta
```

## PR 3: Clamp negative `_holdOffset` to `-live` in `applyScrollAdjustment`

**Problem & repro:** While scroll writes are held (`!this._canWriteScroll()`), negative size deltas (rows above the viewport shrinking on first measurement) accumulate negative `_holdOffset` without bound. When `live + _holdOffset < 0`, virtual items shift downward by `|_holdOffset|` leaving a blank gap above item 0, and `_flushHoldIfReady` clamps `scrollOffset` at `0` while zeroing `_holdOffset`, snapping every visible row upward by the excess. Clamp negative held deltas in `applyScrollAdjustment` so `live + _holdOffset` never drops below `0`.

```diff
   if (!this._canWriteScroll()) {
-    this._holdOffset += delta
-    if (this.scrollOffset !== null) this.scrollOffset += delta
+    const live = this._readElementOffset()
+    const applied = delta < 0 && live !== null ? Math.max(delta, Math.min(0, -(live + this._holdOffset))) : delta
+    if (applied === 0) return false
+    this._holdOffset += applied
+    if (this.scrollOffset !== null) this.scrollOffset += applied
     return true
   }
```
