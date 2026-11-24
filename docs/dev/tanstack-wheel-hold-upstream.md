# Upstream PR drafts (`@tanstack/virtual-core` `packages/virtual-core/src/index.ts`)

## PR 1: Hold `scrollTop` writes during live wheel gestures

**Problem & repro:** On desktop WebKit, synchronous `scrollTop` writes from `applyScrollAdjustment` during a live `wheel` stream or its compositor tail fight WebKit's scrolling tree, which replays pre-write offsets over the adjustment. Mount an `anchorTo: 'end'` vertical `Virtualizer` (~100 variable-height items at bottom) in desktop WebKit, dispatch upward `wheel` ticks (`deltaY: -120` every ~16 ms) while prepending 50-item pages near the top, and observe >1,000 px anchor jumps.

```diff
+  private _wheelLive = false
+  private _wheelTimer: ReturnType<typeof setTimeout> | null = null
   // cleanup(): reset _wheelLive = false, clearTimeout(_wheelTimer), _wheelTimer = null.
   // _willUpdate(): armWheelHold() on `wheel` and on external `isScrolling` events while `_wheelLive`:
+  const armWheelHold = () => {
+    if (!this.targetWindow) return
+    this._wheelLive = true
+    if (this._wheelTimer !== null) this.targetWindow.clearTimeout(this._wheelTimer)
+    this._wheelTimer = this.targetWindow.setTimeout(() => {
+      const live = this._readElementOffset()
+      if (live !== null && this._lastElementOffset !== null && Math.abs(live - this._lastElementOffset) >= 1) {
+        this._lastElementOffset = live; armWheelHold(); return
+      }
+      this._wheelTimer = null; this._wheelLive = false
+      if (live !== null && this._holdOffset !== 0) this.scrollOffset = Math.max(0, live + this._holdOffset)
+      this._flushHoldIfReady(true); this._retryClampedAdjustment()
+    }, 150)
+  }
-  private _canWriteScroll = () => !(isIOSWebKit() && this._iosGesture.inMotion()) && !this._reportedOverscroll
+  private _canWriteScroll = () => !(isIOSWebKit() && this._iosGesture.inMotion()) && !this._reportedOverscroll && !this._wheelLive
```

## PR 2: Reconcile unseen live `scrollTop` moves in `applyScrollAdjustment`

**Problem & repro:** If app/driver code writes `scrollElement.scrollTop` synchronously and an item resizes before the `scroll` event delivers the new offset, `applyScrollAdjustment` writes from the stale cached `scrollOffset` and snaps the scroller back. Reproduce by mutating `el.scrollTop += 600` (without a scroll event) then calling `resizeItem(aboveIdx, size - 20)`.

```diff
   // applyScrollAdjustment() else-branch:
-  const offset = this.getScrollOffset()
+  const live = this._holdOffset === 0 && this._clampedAdjustment === null ? this._readElementOffset() : null
+  const offset = live !== null && this._lastElementOffset !== null && live !== this._lastElementOffset && (this.pendingWrite === null || !approxEqual(live, this.pendingWrite.target)) ? live : this.getScrollOffset()
-  if (this.pendingWrite === write) this.scrollOffset += delta
+  if (this.pendingWrite === write) this.scrollOffset = offset + delta
```
