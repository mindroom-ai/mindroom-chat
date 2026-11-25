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

removed: not needed after #900, ablation 2026-11-25

## PR 3: Never flush negative `_holdOffset` past `scrollTop = 0`

removed: not needed after #900, ablation 2026-11-25

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
