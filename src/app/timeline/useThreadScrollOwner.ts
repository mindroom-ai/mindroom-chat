import { useCallback, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { ThreadLedgerAnchor } from './threadScrollLedger';
import type { ScrollToBottomState } from './roomFocusScrollController';
import {
  computeAverageMeasuredRowHeight,
  type HeadroomRenderSnapshot,
  type PendingThreadScrollFact,
  type ThreadScrollOwnerState,
} from './threadScrollHeadroom';
import { writeThreadScrollToBottom, writeThreadScrollTop } from './threadScrollWriter';
import {
  applyBottomPinRequestIfChanged,
  applyOpenOrLiveBottomPin,
  applyRestTimeHeadroomIntent,
  countUnmeasuredVisibleRows,
  drainPendingScrollFacts,
  type HeadroomTransitionRequest,
  type OwnerWriteContext,
} from './threadScrollOwnerCommit';
import { planOpeningHeadroomTransition } from './useThreadHeadroomEventsGate';
import {
  isOwnerScrollerAtRest,
  shouldArmOwnerIdleWork,
  useThreadScrollRestObserver,
} from './useThreadScrollRestObserver';

export type UseThreadScrollOwnerCommitOptions = {
  owner: ThreadScrollOwnerState;
  snapshot: HeadroomRenderSnapshot;
  ownerEnabled: boolean;
  resettingLedgerView: boolean;
  threadId: string | undefined;
  threadEvents: MatrixEvent[];
  expectedThreadEvents: number;
  hasMoreHistory: boolean;
  rawHasMoreHistory: boolean;
  threadUserScrolled: boolean;
  threadOpenedAtLatest: boolean;
  threadLatestOpenPending: boolean;
  atLiveEndRef?: MutableRefObject<boolean>;
  scrollToBottomRef?: MutableRefObject<ScrollToBottomState>;
  isThreadOpenBottomPinSuppressed?: () => boolean;
  requestThreadOpenBottomPin?: () => boolean;
  shouldApplyThreadBottomPin?: (count: number) => boolean;
  setAtBottom?: (atBottom: boolean) => void;
  footerProbeRef?: RefObject<HTMLElement>;
  getScrollElement: () => HTMLDivElement | null;
  virtualInnerRef: RefObject<HTMLDivElement | null>;
  virtualizerRef: MutableRefObject<Virtualizer<HTMLDivElement, Element>>;
  anchorRef: MutableRefObject<ThreadLedgerAnchor | undefined>;
  sizeCacheRef: MutableRefObject<Map<unknown, number> | undefined>;
  onAfterScrollWrite?: (scrollTop: number) => void;
};

export const useThreadScrollOwnerCommit = (options: UseThreadScrollOwnerCommitOptions) => {
  const {
    owner,
    snapshot,
    ownerEnabled,
    resettingLedgerView,
    threadId,
    threadEvents,
    expectedThreadEvents,
    hasMoreHistory,
    rawHasMoreHistory,
    threadUserScrolled,
    threadOpenedAtLatest,
    threadLatestOpenPending,
    atLiveEndRef,
    scrollToBottomRef,
    isThreadOpenBottomPinSuppressed,
    requestThreadOpenBottomPin,
    shouldApplyThreadBottomPin,
    setAtBottom,
    footerProbeRef,
    getScrollElement,
    virtualInnerRef,
    virtualizerRef,
    anchorRef,
    sizeCacheRef,
    onAfterScrollWrite,
  } = options;
  owner.anchorRef = anchorRef;
  const { headroomPxAtRender, renderedResizeSeq } = snapshot;
  const armIdleRef = useRef<() => void>(() => undefined);
  const seenBottomPinCountRef = useRef(scrollToBottomRef?.current.count ?? 0);
  const guardBottomPinRef = useRef(shouldApplyThreadBottomPin);
  guardBottomPinRef.current = shouldApplyThreadBottomPin;

  const enqueueAboveResize = useCallback(
    (delta: number, itemMeta?: { index: number; key: unknown; oldSize: number }) => {
      if (!ownerEnabled || delta === 0) return;
      owner.nextResizeSeq += 1;
      owner.aboveResizeQueue.push({
        seq: owner.nextResizeSeq,
        delta,
        ...(itemMeta
          ? { itemIndex: itemMeta.index, itemKey: itemMeta.key, oldSize: itemMeta.oldSize }
          : {}),
      });
    },
    [owner, ownerEnabled]
  );

  const enqueueScrollFact = useCallback(
    (fact: PendingThreadScrollFact) => {
      if (!ownerEnabled) return;
      owner.pendingFacts.push(fact);
      owner.bumpCommitTick();
    },
    [owner, ownerEnabled]
  );

  const resizeRow = useCallback(
    (index: number, nextSize: number) => {
      virtualizerRef.current.resizeItem(index, nextSize);
    },
    [virtualizerRef]
  );

  useThreadScrollRestObserver({
    owner,
    ownerEnabled,
    threadId,
    hasMoreHistory,
    threadUserScrolled,
    getScrollElement,
    footerProbeRef,
    armIdleRef,
  });

  // Single commit-time writer for every thread scrollTop change: open-init, open-pin,
  // bottom-pin requests, jumps, status-bar top, held-page release, top-up, and rest trim.
  useLayoutEffect(() => {
    if (!ownerEnabled || resettingLedgerView) return;

    if (renderedResizeSeq > 0) {
      owner.aboveResizeQueue = owner.aboveResizeQueue.filter(
        (entry) => entry.seq > renderedResizeSeq
      );
    }

    owner.committedHeadroomPx = headroomPxAtRender;
    owner.sizeCache = sizeCacheRef.current;
    owner.anchorRef = anchorRef;
    const virt = virtualizerRef.current;
    const avgRowHeight = computeAverageMeasuredRowHeight(
      owner.sizeCache,
      owner.lastAvgRowHeight,
      virt.measurementsCache
    );
    owner.lastAvgRowHeight = avgRowHeight;

    if (owner.aboveResizeQueue.length > 0) {
      owner.bumpCommitTick();
      return;
    }

    const scrollElement = getScrollElement();
    if (!scrollElement) return;

    const recordProgrammatic = (actual: number) => {
      owner.sampledScrollTop = actual;
      owner.lastProgrammaticScrollTop = actual;
      owner.lastProgrammaticWriteAt = Date.now();
    };

    const writeCtx: OwnerWriteContext = {
      owner,
      scrollElement,
      virt,
      setAtBottom,
      onAfterScrollWrite,
      recordProgrammatic,
    };

    const writeAbsoluteScroll = (target: number, notifyAnchor: boolean): boolean => {
      const result = writeThreadScrollTop(scrollElement, target, virt);
      recordProgrammatic(result.actual);
      if (notifyAnchor) onAfterScrollWrite?.(result.actual);
      return result.offsetChanged;
    };

    const applyHeadroomTransition = ({
      nextHeadroom,
      scrollKind,
      targetScrollTop,
      releaseHeldEvents = false,
    }: HeadroomTransitionRequest) => {
      const inner = virtualInnerRef.current;
      const delta = nextHeadroom - owner.committedHeadroomPx;
      const preTop = scrollElement.scrollTop;
      if (!inner) {
        owner.committedHeadroomPx = nextHeadroom;
        owner.pendingAbsoluteScroll =
          scrollKind === 'bottom'
            ? { kind: 'bottom' }
            : { kind: 'offset', target: Math.max(0, targetScrollTop ?? preTop + delta) };
        owner.pendingReleaseAfterTopUp = releaseHeldEvents;
        owner.bumpCommitTick();
        return;
      }
      if (delta > 0) inner.style.height = `${nextHeadroom + virt.getTotalSize()}px`;
      const target =
        scrollKind === 'bottom'
          ? delta >= 0
            ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
            : Math.max(0, scrollElement.scrollHeight + delta - scrollElement.clientHeight)
          : Math.max(0, targetScrollTop ?? preTop + delta);
      writeAbsoluteScroll(target, false);
      owner.committedHeadroomPx = nextHeadroom;
      owner.pendingReconcileAfterWrite = true;
      owner.pendingBottomReconcile = scrollKind === 'bottom';
      owner.pendingReleaseAfterTopUp = releaseHeldEvents;
      owner.bumpCommitTick();
    };

    const releaseHeldIfPending = (): boolean => {
      if (!owner.pendingReleaseAfterTopUp || owner.heldRawEvents === undefined) return false;
      owner.pendingReleaseAfterTopUp = false;
      owner.presentedEvents = owner.heldRawEvents;
      owner.heldRawEvents = undefined;
      owner.heldPrependEstimatePx = 0;
      owner.bumpCommitTick();
      return true;
    };

    if (owner.pendingReconcileAfterWrite) {
      owner.pendingReconcileAfterWrite = false;
      const bottomReconcile = owner.pendingBottomReconcile;
      owner.pendingBottomReconcile = false;
      const result = bottomReconcile
        ? writeThreadScrollToBottom(scrollElement, virt, 'instant')
        : writeThreadScrollTop(scrollElement, scrollElement.scrollTop, virt);
      recordProgrammatic(result.actual);
      if (bottomReconcile) {
        owner.bottomPinned = true;
        owner.lastPinnedTop = result.actual;
        setAtBottom?.(true);
      }
      onAfterScrollWrite?.(result.actual);
      if (releaseHeldIfPending()) return;
      if (result.offsetChanged) {
        owner.bumpCommitTick();
        return;
      }
    }

    const pendingScroll = owner.pendingAbsoluteScroll;
    if (pendingScroll !== undefined) {
      owner.pendingAbsoluteScroll = undefined;
      const target =
        pendingScroll.kind === 'bottom'
          ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
          : pendingScroll.target;
      const offsetChanged = writeAbsoluteScroll(target, true);
      if (pendingScroll.kind === 'bottom') {
        owner.bottomPinned = true;
        owner.lastPinnedTop = scrollElement.scrollTop;
        setAtBottom?.(true);
      }
      if (releaseHeldIfPending()) return;
      if (offsetChanged) {
        owner.bumpCommitTick();
        return;
      }
    }

    if (
      scrollToBottomRef &&
      applyBottomPinRequestIfChanged(
        writeCtx,
        scrollToBottomRef,
        seenBottomPinCountRef,
        shouldApplyThreadBottomPin,
        guardBottomPinRef
      )
    ) {
      owner.bumpCommitTick();
      return;
    }

    if (drainPendingScrollFacts(writeCtx, hasMoreHistory)) {
      owner.bumpCommitTick();
      return;
    }

    const viewH = Math.max(300, scrollElement.clientHeight || 900);
    const viewW = scrollElement.clientWidth || 1200;

    const openTransition = planOpeningHeadroomTransition({
      owner,
      threadUserScrolled,
      threadOpenedAtLatest,
      hasMoreHistory,
      threadEventsLength: threadEvents.length,
      expectedThreadEvents,
      unmeasuredVisible: countUnmeasuredVisibleRows(
        threadEvents,
        sizeCacheRef.current,
        virt.measurementsCache
      ),
      avgRowHeight,
      scrollTop: scrollElement.scrollTop,
      contentHeight: Math.max(0, scrollElement.scrollHeight - owner.committedHeadroomPx),
      viewHeight: viewH,
      viewWidth: viewW,
    });
    if (openTransition) {
      applyHeadroomTransition(openTransition);
      return;
    }

    const openPinActive =
      !threadUserScrolled &&
      threadOpenedAtLatest &&
      !threadLatestOpenPending &&
      threadEvents.length > 0 &&
      !isThreadOpenBottomPinSuppressed?.();
    if (
      applyOpenOrLiveBottomPin(writeCtx, {
        openPinActive,
        atLiveEnd: atLiveEndRef?.current ?? true,
        scrollToBottomRef,
        seenBottomPinCountRef,
        requestThreadOpenBottomPin,
      })
    ) {
      owner.bumpCommitTick();
      return;
    }

    if (!owner.idleIntentQueued) {
      const preTop = scrollElement.scrollTop;
      const anchorIdx = anchorRef.current?.index ?? 0;
      const unmeasuredAbove =
        preTop >= owner.committedHeadroomPx && anchorIdx > 0
          ? countUnmeasuredVisibleRows(
              threadEvents,
              sizeCacheRef.current,
              virt.measurementsCache,
              anchorIdx
            )
          : 0;
      if (
        shouldArmOwnerIdleWork({
          owner,
          scrollTop: preTop,
          viewHeight: viewH,
          viewWidth: viewW,
          hasMoreHistory,
          threadUserScrolled,
          threadEventsLength: threadEvents.length,
          unmeasuredAbove,
        })
      ) {
        armIdleRef.current();
      }
      return;
    }

    owner.idleIntentQueued = false;
    if (!isOwnerScrollerAtRest(owner, scrollElement)) {
      armIdleRef.current();
      return;
    }

    applyRestTimeHeadroomIntent({
      owner,
      scrollElement,
      threadEvents,
      expectedThreadEvents,
      hasMoreHistory,
      rawHasMoreHistory,
      threadUserScrolled,
      avgRowHeight,
      anchorIndex: anchorRef.current?.index,
      sizeCache: sizeCacheRef.current,
      measurementsCache: virt.measurementsCache,
      applyHeadroomTransition,
    });
  });

  return { enqueueAboveResize, enqueueScrollFact, resizeRow };
};
