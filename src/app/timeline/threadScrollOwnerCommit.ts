import type { MutableRefObject } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { MatrixEvent } from 'matrix-js-sdk';
import { hasActiveWindowTouches } from './scrollQuiescence';
import type { ScrollToBottomState } from './roomFocusScrollController';
import {
  MIN_HISTORY_BUDGET_VIEWPORTS,
  TOP_UP_LOW_WATER_VIEWPORTS,
  computeHeadroomBudget,
  computeTrimPlan,
  type ThreadScrollOwnerState,
} from './threadScrollHeadroom';
import {
  writeThreadScrollBy,
  writeThreadScrollToBottom,
  writeThreadScrollToIndex,
  writeThreadScrollTop,
} from './threadScrollWriter';

const SMOOTH_PIN_MAX_FRAMES = 60;

export type OwnerWriteContext = {
  owner: ThreadScrollOwnerState;
  scrollElement: HTMLElement;
  virt: Virtualizer<HTMLDivElement, Element>;
  setAtBottom?: (atBottom: boolean) => void;
  onAfterScrollWrite?: (scrollTop: number) => void;
  recordProgrammatic: (actual: number) => void;
};

export type HeadroomTransitionRequest = {
  nextHeadroom: number;
  scrollKind: 'offset' | 'bottom';
  targetScrollTop?: number;
  releaseHeldEvents?: boolean;
};

export const countUnmeasuredVisibleRows = (
  events: MatrixEvent[],
  sizeCache: ReadonlyMap<unknown, number> | undefined,
  measurementsCache: readonly { size: number }[],
  upToIndex?: number
): number => {
  const limit = upToIndex !== undefined ? Math.min(upToIndex, events.length) : events.length;
  let count = 0;
  for (let i = 0; i < limit; i += 1) {
    const id = events[i]?.getId();
    if (!id || sizeCache?.has(id)) continue;
    const est = measurementsCache[i]?.size;
    if (est !== undefined && est <= 0) continue;
    count += 1;
  }
  return count;
};

const computeElementJumpDelta = (
  scrollElement: HTMLElement,
  element: HTMLElement,
  align: 'start' | 'center' | 'end' = 'center',
  offset = 0,
  stopInView = false
): number | undefined => {
  const view = scrollElement.getBoundingClientRect();
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(scrollElement) : null;
  const viewTop = view.top + (Number.parseFloat(style?.scrollPaddingTop ?? '') || 0);
  const viewBottom = view.bottom - (Number.parseFloat(style?.scrollPaddingBottom ?? '') || 0);
  const rect = element.getBoundingClientRect();
  if (stopInView && rect.top >= viewTop && rect.bottom <= viewBottom) return undefined;
  const usable = viewBottom - viewTop;
  const effectiveAlign = rect.height > usable ? 'start' : align;
  const targetTop =
    effectiveAlign === 'end'
      ? viewBottom - rect.height + offset
      : effectiveAlign === 'center'
      ? viewTop + (usable - rect.height) / 2 + offset
      : viewTop + offset;
  return rect.top - targetTop;
};

export const applyBottomPinRequestIfChanged = (
  ctx: OwnerWriteContext,
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>,
  seenBottomPinCountRef: MutableRefObject<number>,
  shouldApplyThreadBottomPin: ((count: number) => boolean) | undefined,
  guardBottomPinRef: MutableRefObject<((count: number) => boolean) | undefined>
): boolean => {
  const { owner, scrollElement, virt, setAtBottom, onAfterScrollWrite, recordProgrammatic } = ctx;
  const { count, smooth } = scrollToBottomRef.current;
  if (count === seenBottomPinCountRef.current) return false;
  seenBottomPinCountRef.current = count;
  if (count <= 0 || (shouldApplyThreadBottomPin && !shouldApplyThreadBottomPin(count))) {
    return false;
  }
  const result = writeThreadScrollToBottom(scrollElement, virt, smooth ? 'smooth' : 'instant');
  recordProgrammatic(result.actual);
  owner.bottomPinned = true;
  owner.lastPinnedTop = result.actual;
  setAtBottom?.(true);
  onAfterScrollWrite?.(result.actual);
  if (smooth && typeof requestAnimationFrame !== 'undefined') {
    let frames = 0;
    let lastTop = Number.NaN;
    const checkSmooth = () => {
      if (
        !scrollElement.isConnected ||
        scrollToBottomRef.current.count !== count ||
        (guardBottomPinRef.current && !guardBottomPinRef.current(count))
      ) {
        return;
      }
      const below =
        scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
      if (below <= 1 || scrollElement.scrollTop < lastTop) return;
      if (scrollElement.scrollTop === lastTop || frames >= SMOOTH_PIN_MAX_FRAMES) {
        owner.pendingFacts.push({ kind: 'pin-bottom', behavior: 'instant', markAtBottom: true });
        owner.bumpCommitTick();
        return;
      }
      lastTop = scrollElement.scrollTop;
      frames += 1;
      requestAnimationFrame(checkSmooth);
    };
    requestAnimationFrame(() => requestAnimationFrame(checkSmooth));
    return false;
  }
  return result.offsetChanged;
};

export const applyOpenOrLiveBottomPin = (
  ctx: OwnerWriteContext,
  {
    openPinActive,
    atLiveEnd,
    scrollToBottomRef,
    seenBottomPinCountRef,
    requestThreadOpenBottomPin,
  }: {
    openPinActive: boolean;
    atLiveEnd: boolean;
    scrollToBottomRef?: MutableRefObject<ScrollToBottomState>;
    seenBottomPinCountRef: MutableRefObject<number>;
    requestThreadOpenBottomPin?: () => boolean;
  }
): boolean => {
  const { owner, scrollElement, virt, setAtBottom, onAfterScrollWrite, recordProgrammatic } = ctx;
  const distBelow =
    scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
  if (openPinActive) {
    if (distBelow <= 1) {
      owner.bottomPinned = true;
      owner.lastPinnedTop = scrollElement.scrollTop;
      setAtBottom?.(true);
      return false;
    }
    if (owner.lastPinnedTop !== undefined && scrollElement.scrollTop < owner.lastPinnedTop - 1) {
      return false;
    }
    const allowed = !requestThreadOpenBottomPin || requestThreadOpenBottomPin();
    if (scrollToBottomRef) seenBottomPinCountRef.current = scrollToBottomRef.current.count;
    if (!allowed) return false;
    const res = writeThreadScrollToBottom(scrollElement, virt, 'instant');
    recordProgrammatic(res.actual);
    owner.bottomPinned = true;
    owner.lastPinnedTop = res.actual;
    setAtBottom?.(true);
    onAfterScrollWrite?.(res.actual);
    return res.offsetChanged;
  }
  if (
    owner.bottomPinned &&
    atLiveEnd &&
    !hasActiveWindowTouches() &&
    scrollElement.dataset.scrollbarDragging !== 'true'
  ) {
    if (owner.lastPinnedTop !== undefined && scrollElement.scrollTop < owner.lastPinnedTop - 1) {
      owner.bottomPinned = false;
      return false;
    }
    if (distBelow > 1) {
      const res = writeThreadScrollToBottom(scrollElement, virt, 'instant');
      recordProgrammatic(res.actual);
      owner.lastPinnedTop = res.actual;
      onAfterScrollWrite?.(res.actual);
      return res.offsetChanged;
    }
  }
  return false;
};

/** Drains queued explicit scroll facts through the single writer funnel. */
export const drainPendingScrollFacts = (
  ctx: OwnerWriteContext,
  hasMoreHistory: boolean
): boolean => {
  const { owner, scrollElement, virt, setAtBottom, onAfterScrollWrite, recordProgrammatic } = ctx;
  if (owner.pendingFacts.length === 0) return false;
  const facts = owner.pendingFacts;
  owner.pendingFacts = [];
  let needsReRender = false;
  for (let i = 0; i < facts.length; i += 1) {
    const fact = facts[i]!;
    if (fact.kind === 'pin-bottom') {
      const res = writeThreadScrollToBottom(scrollElement, virt, fact.behavior ?? 'instant');
      recordProgrammatic(res.actual);
      owner.bottomPinned = true;
      owner.lastPinnedTop = res.actual;
      if (fact.markAtBottom) setAtBottom?.(true);
      onAfterScrollWrite?.(res.actual);
      if (res.offsetChanged) needsReRender = true;
    } else if (fact.kind === 'jump-index') {
      owner.bottomPinned = false;
      const res = writeThreadScrollToIndex(scrollElement, virt, fact.index, fact.align);
      if (res) {
        recordProgrammatic(res.actual);
        onAfterScrollWrite?.(res.actual);
        if (res.offsetChanged) needsReRender = true;
      }
    } else if (fact.kind === 'jump-element') {
      owner.bottomPinned = false;
      const delta = computeElementJumpDelta(
        scrollElement,
        fact.element,
        fact.align,
        fact.offset,
        fact.stopInView
      );
      if (delta !== undefined) {
        const res = writeThreadScrollBy(scrollElement, delta, virt, fact.behavior ?? 'instant');
        recordProgrammatic(res.actual);
        onAfterScrollWrite?.(res.actual);
        if (res.offsetChanged) needsReRender = true;
      }
    } else if (fact.kind === 'clamp-reserve') {
      const res = writeThreadScrollTop(scrollElement, fact.target, virt);
      recordProgrammatic(res.actual);
      if (res.offsetChanged) needsReRender = true;
    } else if (fact.kind === 'status-bar-top') {
      owner.bottomPinned = false;
      const res = writeThreadScrollTop(scrollElement, 0, virt);
      recordProgrammatic(res.actual);
      onAfterScrollWrite?.(res.actual);
      if (!hasMoreHistory && owner.committedHeadroomPx > 0) {
        owner.committedHeadroomPx = 0;
        needsReRender = true;
      } else if (res.offsetChanged) {
        needsReRender = true;
      }
    }
  }
  return needsReRender;
};

/** Evaluates rest-time headroom actions in priority order: held-release > topup > nearTop trim. */
export const applyRestTimeHeadroomIntent = ({
  owner,
  scrollElement,
  threadEvents,
  expectedThreadEvents,
  hasMoreHistory,
  rawHasMoreHistory,
  threadUserScrolled,
  avgRowHeight,
  anchorIndex,
  sizeCache,
  measurementsCache,
  applyHeadroomTransition,
}: {
  owner: ThreadScrollOwnerState;
  scrollElement: HTMLElement;
  threadEvents: MatrixEvent[];
  expectedThreadEvents: number;
  hasMoreHistory: boolean;
  rawHasMoreHistory: boolean;
  threadUserScrolled: boolean;
  avgRowHeight: number;
  anchorIndex: number | undefined;
  sizeCache: ReadonlyMap<unknown, number> | undefined;
  measurementsCache: readonly { size: number }[];
  applyHeadroomTransition: (req: HeadroomTransitionRequest) => void;
}): void => {
  const viewH = Math.max(300, scrollElement.clientHeight || 900);
  const viewW = scrollElement.clientWidth || 1200;

  if (owner.heldRawEvents !== undefined) {
    const heldEvents = owner.heldRawEvents;
    const unmeasuredAfter = countUnmeasuredVisibleRows(
      threadEvents,
      sizeCache,
      measurementsCache,
      anchorIndex
    );
    const prependEstimate = Math.ceil(owner.heldPrependEstimatePx);
    const targetHeadroom = rawHasMoreHistory
      ? Math.max(
          computeHeadroomBudget({
            unloadedReplies: Math.max(0, expectedThreadEvents - heldEvents.length),
            unmeasuredLoaded: unmeasuredAfter,
            avgRowHeight,
            viewHeight: viewH,
            viewWidth: viewW,
            hasMoreHistory: true,
          }) + prependEstimate,
          prependEstimate + Math.round(viewH * MIN_HISTORY_BUDGET_VIEWPORTS)
        )
      : Math.max(
          prependEstimate +
            Math.min(unmeasuredAfter * (viewW < 600 ? 70 : 10), 12_000) +
            Math.round(viewH * 1.25),
          prependEstimate
        );
    const delta = targetHeadroom - owner.committedHeadroomPx;
    if (delta > 1) {
      applyHeadroomTransition({
        nextHeadroom: targetHeadroom,
        scrollKind: 'offset',
        targetScrollTop: scrollElement.scrollTop + delta,
        releaseHeldEvents: true,
      });
      return;
    }
    owner.presentedEvents = heldEvents;
    owner.heldRawEvents = undefined;
    owner.heldPrependEstimatePx = 0;
    owner.bumpCommitTick();
    return;
  }

  if (
    hasMoreHistory &&
    threadUserScrolled &&
    owner.committedHeadroomPx < viewH * TOP_UP_LOW_WATER_VIEWPORTS
  ) {
    const targetHeadroom = computeHeadroomBudget({
      unloadedReplies: Math.max(0, expectedThreadEvents - threadEvents.length),
      unmeasuredLoaded: countUnmeasuredVisibleRows(
        threadEvents,
        sizeCache,
        measurementsCache,
        anchorIndex ?? threadEvents.length
      ),
      avgRowHeight,
      viewHeight: viewH,
      viewWidth: viewW,
      hasMoreHistory: true,
    });
    const delta = targetHeadroom - owner.committedHeadroomPx;
    if (delta > 1) {
      applyHeadroomTransition({
        nextHeadroom: targetHeadroom,
        scrollKind: 'offset',
        targetScrollTop: scrollElement.scrollTop + delta,
      });
      return;
    }
  }

  if (!hasMoreHistory && owner.committedHeadroomPx > 0 && threadEvents.length > 0) {
    const preTop = scrollElement.scrollTop;
    const anchorIdx = anchorIndex ?? 0;
    const plan = computeTrimPlan({
      headroomPx: owner.committedHeadroomPx,
      scrollTop: preTop,
      viewHeight: viewH,
      viewWidth: viewW,
      unmeasuredAbove:
        preTop >= owner.committedHeadroomPx && anchorIdx > 0
          ? countUnmeasuredVisibleRows(threadEvents, sizeCache, measurementsCache, anchorIdx)
          : 0,
    });
    if (plan) {
      applyHeadroomTransition({
        nextHeadroom: plan.nextHeadroom,
        scrollKind: 'offset',
        targetScrollTop: plan.targetScrollTop,
      });
    }
  }
};
