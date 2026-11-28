import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import { playsMotion } from '../../ui/listMotion';
import {
  findDragTargetIndex,
  mergeVisibleSectionOrder,
  moveSectionInOrder,
} from './compactColumnsLayout';
import type { CompactThreadSectionId } from './compactThreadSections';

/** Pointer movement required before a press becomes a column drag instead of a fold toggle click. */
export const COLUMN_DRAG_THRESHOLD_PX = 6;
export const COLUMN_FLIP_DURATION_MS = 260;
export const COLUMN_SETTLE_DURATION_MS = 220;
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const FLIP_OPTIONS: KeyframeAnimationOptions = { duration: COLUMN_FLIP_DURATION_MS, easing: FLIP_EASING };
const SETTLE_OPTIONS: KeyframeAnimationOptions = { duration: COLUMN_SETTLE_DURATION_MS, easing: FLIP_EASING };

type ActiveDrag = {
  id: CompactThreadSectionId;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastPointerAxis: number;
  started: boolean;
  originLeft: number;
  currentLayoutLeft: number;
  lastTx: number;
  initialOrder: CompactThreadSectionId[];
  order: CompactThreadSectionId[];
};

type SettleHandle = { flush: () => void; abort: () => void };

const sameOrder = (a: readonly CompactThreadSectionId[], b: readonly CompactThreadSectionId[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const isRtlElement = (element: HTMLElement | null): boolean =>
  element ? getComputedStyle(element).direction === 'rtl' : false;

const startDropSettle = (el: HTMLElement, tx: number, onComplete: () => void): SettleHandle => {
  let doneCalled = false;
  const anim = el.animate(
    [{ transform: `translate3d(${tx}px, 0, 0) scale(1.01)` }, { transform: 'translate3d(0, 0, 0) scale(1)' }],
    SETTLE_OPTIONS
  );
  const finish = () => {
    if (doneCalled) return;
    doneCalled = true;
    clearTimeout(timer);
    onComplete();
  };
  const timer = setTimeout(finish, COLUMN_SETTLE_DURATION_MS + 60);
  anim?.finished?.then(finish, finish);
  return {
    flush: () => { anim?.cancel?.(); finish(); },
    abort: () => { doneCalled = true; clearTimeout(timer); anim?.cancel?.(); },
  };
};

export type UseCompactColumnMotionOptions = {
  boardRef: RefObject<HTMLDivElement | null>;
  sectionIds: readonly CompactThreadSectionId[];
  fullOrder?: readonly CompactThreadSectionId[];
  foldedSignature: string;
  onToggleFold: (id: CompactThreadSectionId) => void;
  onReorder: (order: CompactThreadSectionId[]) => void;
};

/**
 * Coordinates pointer drag-to-reorder, Alt+Arrow keyboard reorder with focus preservation,
 * real-time sibling FLIP gliding on swaps and collapse/expand, and smooth drop settle animation.
 */
export const useCompactColumnMotion = ({
  boardRef,
  sectionIds,
  fullOrder,
  foldedSignature,
  onToggleFold,
  onReorder,
}: UseCompactColumnMotionOptions) => {
  const [draggingId, setDraggingId] = useState<CompactThreadSectionId | null>(null);
  const [dragOrder, setDragOrder] = useState<CompactThreadSectionId[] | null>(null);

  const columnElsRef = useRef(new Map<CompactThreadSectionId, HTMLElement>());
  const restingRectsRef = useRef(new Map<CompactThreadSectionId, DOMRect>());
  const pendingFlipRef = useRef<Map<CompactThreadSectionId, DOMRect> | null>(null);
  const runningAnimsRef = useRef(new Map<CompactThreadSectionId, Animation>());
  const dragRef = useRef<ActiveDrag | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settleRef = useRef<SettleHandle | null>(null);
  const pendingFocusIdRef = useRef<CompactThreadSectionId | null>(null);
  const mountedRef = useRef(false);
  const lastSignatureRef = useRef<string | undefined>(undefined);
  const windowCleanupRef = useRef<(() => void) | null>(null);

  const effectiveOrder = useMemo(() => {
    if (!dragOrder) return [...sectionIds];
    const liveSet = new Set(sectionIds);
    const kept = dragOrder.filter((id) => liveSet.has(id));
    const keptSet = new Set(kept);
    sectionIds.forEach((id) => { if (!keptSet.has(id)) kept.push(id); });
    return kept;
  }, [dragOrder, sectionIds]);

  const latestRef = useLatestRef({ sectionIds, effectiveOrder, fullOrder, onToggleFold, onReorder });

  const captureVisualRects = useCallback((): Map<CompactThreadSectionId, DOMRect> => {
    const rects = new Map<CompactThreadSectionId, DOMRect>();
    columnElsRef.current.forEach((el, id) => rects.set(id, el.getBoundingClientRect()));
    return rects;
  }, []);

  const commitOrder = useCallback(
    (nextVisible: readonly CompactThreadSectionId[]) => {
      const { fullOrder: baseOrder, onReorder: reorder } = latestRef.current;
      reorder(baseOrder ? mergeVisibleSectionOrder(baseOrder, nextVisible) : [...nextVisible]);
    },
    [latestRef]
  );

  const setColumnRef = useCallback(
    (id: CompactThreadSectionId) => (node: HTMLElement | null) => {
      if (node) columnElsRef.current.set(id, node);
      else columnElsRef.current.delete(id);
    },
    []
  );

  const layoutSignature = `${effectiveOrder.join(',')}|${foldedSignature}`;

  useLayoutEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      lastSignatureRef.current = layoutSignature;
      restingRectsRef.current = captureVisualRects();
      return;
    }

    const prevRects = pendingFlipRef.current ?? restingRectsRef.current;
    pendingFlipRef.current = null;
    const active = dragRef.current;
    const activeDraggedId = active?.started ? active.id : undefined;
    const draggedEl = activeDraggedId ? columnElsRef.current.get(activeDraggedId) : undefined;
    const savedTransform = draggedEl?.style.transform ?? '';
    if (draggedEl) draggedEl.style.transform = '';

    runningAnimsRef.current.forEach((anim, id) => {
      if (id !== activeDraggedId) { anim.cancel?.(); runningAnimsRef.current.delete(id); }
    });

    const nextResting = captureVisualRects();
    restingRectsRef.current = nextResting;

    if (active?.started && draggedEl) {
      const nextRect = nextResting.get(active.id);
      if (nextRect) {
        active.currentLayoutLeft = nextRect.left;
        active.lastTx = active.originLeft + (active.lastClientX - active.startClientX) - nextRect.left;
        draggedEl.style.transform = `translate3d(${active.lastTx}px, 0, 0) scale(1.01)`;
      } else {
        draggedEl.style.transform = savedTransform;
      }
    }

    if (lastSignatureRef.current !== layoutSignature) {
      lastSignatureRef.current = layoutSignature;
      nextResting.forEach((nextRect, id) => {
        if (id === activeDraggedId) return;
        const prevRect = prevRects.get(id);
        const el = columnElsRef.current.get(id);
        if (!prevRect || !el || !playsMotion(el)) return;
        const dx = prevRect.left - nextRect.left;
        if (Math.abs(dx) < 0.5) return;
        const anim = el.animate(
          [{ transform: `translate3d(${dx}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
          FLIP_OPTIONS
        );
        runningAnimsRef.current.set(id, anim);
        const clear = () => { if (runningAnimsRef.current.get(id) === anim) runningAnimsRef.current.delete(id); };
        anim?.finished?.then(clear, clear);
      });
    }

    const focusId = pendingFocusIdRef.current;
    if (focusId) {
      pendingFocusIdRef.current = null;
      const trigger = columnElsRef.current
        .get(focusId)
        ?.querySelector<HTMLElement>('[data-compact-column-header], [data-compact-column-rail]');
      if (trigger && trigger.ownerDocument.activeElement !== trigger) trigger.focus({ preventScroll: true });
    }
  }, [captureVisualRects, layoutSignature]);

  useEffect(() => () => {
    windowCleanupRef.current?.();
    windowCleanupRef.current = null;
    clearTimeout(suppressClickTimerRef.current);
    settleRef.current?.abort();
    settleRef.current = null;
    runningAnimsRef.current.forEach((anim) => anim.cancel?.());
    runningAnimsRef.current.clear();
  }, []);

  const handleHeaderPointerDown = useCallback(
    (id: CompactThreadSectionId) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      settleRef.current?.flush();
      windowCleanupRef.current?.();

      const currentOrder = [...latestRef.current.sectionIds];
      if (currentOrder.length <= 1) return;

      const isRtl = isRtlElement(boardRef.current);
      const axis = (x: number) => (isRtl ? -x : x);
      const active: ActiveDrag = {
        id, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY,
        lastClientX: event.clientX, lastPointerAxis: axis(event.clientX), started: false,
        originLeft: 0, currentLayoutLeft: 0, lastTx: 0, initialOrder: currentOrder, order: currentOrder,
      };
      dragRef.current = active;

      const detach = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        windowCleanupRef.current = null;
      };

      const finish = (commit: boolean) => {
        detach();
        if (dragRef.current !== active) return;
        dragRef.current = null;
        if (!active.started) return;

        suppressClickRef.current = true;
        clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = setTimeout(() => { suppressClickRef.current = false; }, 0);

        const draggedEl = columnElsRef.current.get(active.id);
        if (draggedEl) draggedEl.style.transform = '';
        if (!commit) {
          pendingFlipRef.current = captureVisualRects();
          setDraggingId(null);
          setDragOrder(null);
          return;
        }

        const changed = !sameOrder(active.order, active.initialOrder);
        const finalizeCommit = () => {
          settleRef.current = null;
          setDraggingId(null);
          setDragOrder(null);
          if (changed) commitOrder(active.order);
        };
        if (draggedEl && playsMotion(draggedEl) && Math.abs(active.lastTx) > 0.5) {
          settleRef.current = startDropSettle(draggedEl, active.lastTx, finalizeCommit);
        } else {
          finalizeCommit();
        }
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (dragRef.current !== active || moveEvent.pointerId !== active.pointerId) return;
        const dx = moveEvent.clientX - active.startClientX;
        const dy = moveEvent.clientY - active.startClientY;

        if (!active.started) {
          if (Math.hypot(dx, dy) < COLUMN_DRAG_THRESHOLD_PX) return;
          if (moveEvent.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx) * 1.5) {
            finish(false);
            return;
          }
          runningAnimsRef.current.forEach((anim) => anim.cancel?.());
          runningAnimsRef.current.clear();
          const freshRects = captureVisualRects();
          restingRectsRef.current = freshRects;
          const startRect = freshRects.get(active.id);
          if (!startRect) return;
          active.started = true;
          active.originLeft = startRect.left;
          active.currentLayoutLeft = startRect.left;
          setDraggingId(active.id);
          setDragOrder(active.order);
        }

        active.lastClientX = moveEvent.clientX;
        active.lastTx = active.originLeft + dx - active.currentLayoutLeft;
        const draggedEl = columnElsRef.current.get(active.id);
        if (draggedEl) draggedEl.style.transform = `translate3d(${active.lastTx}px, 0, 0) scale(1.01)`;

        const pointerAxis = axis(moveEvent.clientX);
        const prevAxis = active.lastPointerAxis;
        active.lastPointerAxis = pointerAxis;

        const currentIndex = active.order.indexOf(active.id);
        if (currentIndex < 0) return;
        const targetIndex = findDragTargetIndex(
          active.order, currentIndex, pointerAxis, prevAxis, restingRectsRef.current, axis
        );
        if (targetIndex !== currentIndex) {
          pendingFlipRef.current = captureVisualRects();
          active.order = moveSectionInOrder(active.order, currentIndex, targetIndex);
          setDragOrder(active.order);
        }
      };

      const onPointerUp = (e: PointerEvent) => e.pointerId === active.pointerId && finish(true);
      const onPointerCancel = (e: PointerEvent) => e.pointerId === active.pointerId && finish(false);

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      windowCleanupRef.current = detach;
    },
    [boardRef, captureVisualRects, commitOrder, latestRef]
  );

  const handleHeaderClick = useCallback(
    (id: CompactThreadSectionId) => (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        clearTimeout(suppressClickTimerRef.current);
        event.preventDefault();
        return;
      }
      settleRef.current?.flush();
      pendingFlipRef.current = captureVisualRects();
      latestRef.current.onToggleFold(id);
    },
    [captureVisualRects, latestRef]
  );

  const handleHeaderKeyDown = useCallback(
    (id: CompactThreadSectionId) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (
        !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
      ) return;
      event.preventDefault();
      settleRef.current?.flush();
      const order = latestRef.current.effectiveOrder;
      const index = order.indexOf(id);
      if (index < 0) return;
      const step = (event.key === 'ArrowRight' ? 1 : -1) * (isRtlElement(boardRef.current) ? -1 : 1);
      const nextIndex = index + step;
      if (nextIndex < 0 || nextIndex >= order.length) return;
      pendingFlipRef.current = captureVisualRects();
      pendingFocusIdRef.current = id;
      commitOrder(moveSectionInOrder(order, index, nextIndex));
    },
    [boardRef, captureVisualRects, commitOrder, latestRef]
  );

  return {
    effectiveOrder, draggingId, setColumnRef,
    handleHeaderPointerDown, handleHeaderClick, handleHeaderKeyDown,
  };
};
