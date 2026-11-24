# Upstream PR draft: hold `scrollTop` writes during live wheel gestures (`@tanstack/virtual-core`)

## Problem

On desktop WebKit, synchronous `scrollTop` writes from `applyScrollAdjustment` during an active `wheel` / trackpad-momentum stream fight the compositor: subsequent wheel frames replay pre-write offsets over the adjustment, losing the reader's place by thousands of pixels on `anchorTo: 'end'` prepends. Separately, if user/app code mutates `scrollTop` before a `scroll` event delivers it, `applyScrollAdjustment` writes from the stale cached `scrollOffset`.

## Reproduction

Mount a vertical `Virtualizer` (`anchorTo: 'end'`, ~100 variable-height items, scrolled to bottom) in desktop WebKit, dispatch sustained upward `wheel` events (`deltaY: -120` every ~16 ms) while prepending 50-item pages near the top, and observe the visible anchor row jump >1,000 px when WebKit replays an earlier wheel offset over the prepend write.

## Proposed diff (`packages/virtual-core/src/index.ts`)

```diff
+  private _wheelLive = false
+  private _wheelTimer: ReturnType<typeof setTimeout> | null = null
   // In cleanup(): reset _wheelLive = false, clearTimeout(_wheelTimer), _wheelTimer = null.
   // In _willUpdate() (`if ('addEventListener' in this.scrollElement)`):
+  const onWheel = () => {
+    this._wheelLive = true
+    if (this._wheelTimer !== null) this.targetWindow?.clearTimeout(this._wheelTimer)
+    this._wheelTimer = this.targetWindow?.setTimeout(() => {
+      this._wheelTimer = null; this._wheelLive = false
+      const live = this._readElementOffset()
+      if (live !== null && this._holdOffset !== 0) this.scrollOffset = Math.max(0, live + this._holdOffset)
+      this._flushHoldIfReady(true); this._retryClampedAdjustment()
+    }, 150) ?? null
+  }
+  el.addEventListener('wheel', onWheel, addEventListenerOptions)
+  this.unsubs.push(() => el.removeEventListener('wheel', onWheel))
-  private _canWriteScroll = () => !(isIOSWebKit() && this._iosGesture.inMotion()) && !this._reportedOverscroll
+  private _canWriteScroll = () => !(isIOSWebKit() && this._iosGesture.inMotion()) && !this._reportedOverscroll && !this._wheelLive
   // In applyScrollAdjustment() else-branch:
-  const offset = this.getScrollOffset()
+  const live = this._holdOffset === 0 && this._clampedAdjustment === null ? this._readElementOffset() : null
+  const offset = live !== null && this._lastElementOffset !== null && live !== this._lastElementOffset && (this.pendingWrite === null || !approxEqual(live, this.pendingWrite.target)) ? live : this.getScrollOffset()
-  if (this.pendingWrite === write) this.scrollOffset += delta
+  if (this.pendingWrite === write) this.scrollOffset = offset + delta
```
