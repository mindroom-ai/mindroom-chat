import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import { playsMotion } from '../../ui/listMotion';
import { mergeVisibleSectionOrder } from './compactColumnsLayout';
import { isCompactBoardRtl } from './useCompactColumnDrag';
import type { CompactThreadSectionId } from './compactThreadSections';

export const COLUMN_FLIP_DURATION_MS = 260;
const COLUMN_FLIP_OPTIONS: KeyframeAnimationOptions = {
  duration: COLUMN_FLIP_DURATION_MS,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
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
 * Owns smooth collapse/expand FLIP glides (capturing fresh rects right before toggling so layout
 * resizes never leave stale measurements) and `Alt+ArrowLeft/Right` keyboard column reordering
 * with focus retention and `ShortcutRoot` isolation. Pointer drag-and-drop is handled by `@dnd-kit`.
 */
export const useCompactColumnMotion = ({
  boardRef,
  sectionIds,
  fullOrder,
  foldedSignature,
  onToggleFold,
  onReorder,
}: UseCompactColumnMotionOptions) => {
  const columnElsRef = useRef(new Map<CompactThreadSectionId, HTMLElement>());
  const pendingFlipRef = useRef<Map<CompactThreadSectionId, DOMRect> | null>(null);
  const pendingFocusRef = useRef<{ id: CompactThreadSectionId; reveal?: true } | null>(null);
  const runningAnimsRef = useRef(new Map<CompactThreadSectionId, Animation>());
  const latestRef = useLatestRef({ sectionIds, fullOrder, onToggleFold, onReorder });

  const captureRects = useCallback((): Map<CompactThreadSectionId, DOMRect> => {
    const rects = new Map<CompactThreadSectionId, DOMRect>();
    columnElsRef.current.forEach((el, id) => rects.set(id, el.getBoundingClientRect()));
    return rects;
  }, []);

  const setColumnRef = useCallback(
    (id: CompactThreadSectionId) => (node: HTMLElement | null) => {
      if (node) columnElsRef.current.set(id, node);
      else columnElsRef.current.delete(id);
    },
    []
  );

  const layoutSignature = `${sectionIds.join(',')}|${foldedSignature}`;

  useLayoutEffect(() => {
    const prevRects = pendingFlipRef.current;
    pendingFlipRef.current = null;

    if (prevRects) {
      runningAnimsRef.current.forEach((anim) => anim.cancel?.());
      runningAnimsRef.current.clear();
    }

    const scrollLeft = boardRef.current?.scrollLeft;
    const focus = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (focus) {
      const trigger = columnElsRef.current
        .get(focus.id)
        ?.querySelector<HTMLElement>('[data-compact-column-header], [data-compact-column-rail]');
      if (trigger && trigger.ownerDocument.activeElement !== trigger) {
        trigger.focus({ preventScroll: true });
      }
      if (focus.reveal) trigger?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    // Measure the destination after revealing it. Don't animate from the old viewport if it panned.
    if (!prevRects || scrollLeft !== boardRef.current?.scrollLeft) return;
    columnElsRef.current.forEach((el, id) => {
      const prevRect = prevRects.get(id);
      if (!prevRect || !playsMotion(el)) return;
      const dx = prevRect.left - el.getBoundingClientRect().left;
      if (Math.abs(dx) < 0.5) return;
      const anim = el.animate(
        [{ transform: `translate3d(${dx}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        COLUMN_FLIP_OPTIONS
      );
      runningAnimsRef.current.set(id, anim);
      const clear = () => {
        if (runningAnimsRef.current.get(id) === anim) runningAnimsRef.current.delete(id);
      };
      anim?.finished?.then(clear, clear);
    });
  }, [boardRef, layoutSignature]);

  useEffect(
    () => () => {
      runningAnimsRef.current.forEach((anim) => anim.cancel?.());
      runningAnimsRef.current.clear();
    },
    []
  );

  const handleHeaderClick = useCallback(
    (id: CompactThreadSectionId) => () => {
      pendingFlipRef.current = captureRects();
      const el = columnElsRef.current.get(id);
      if (el?.contains(el.ownerDocument.activeElement)) pendingFocusRef.current = { id };
      latestRef.current.onToggleFold(id);
    },
    [captureRects, latestRef]
  );

  const handleHeaderKeyDown = useCallback(
    (id: CompactThreadSectionId) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
      ) {
        return;
      }
      // Stop bubbling to window so ShortcutRoot (leaveThread/openThread) never sees column reorder chords.
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopPropagation();
      const { sectionIds: order, fullOrder: baseOrder, onReorder: reorder } = latestRef.current;
      const index = order.indexOf(id);
      if (index < 0) return;
      const step =
        (event.key === 'ArrowRight' ? 1 : -1) * (isCompactBoardRtl(boardRef.current) ? -1 : 1);
      const nextIndex = index + step;
      if (nextIndex < 0 || nextIndex >= order.length) return;
      pendingFlipRef.current = captureRects();
      pendingFocusRef.current = { id, reveal: true };
      const nextVisible = arrayMove([...order], index, nextIndex);
      reorder(baseOrder ? mergeVisibleSectionOrder(baseOrder, nextVisible) : nextVisible);
    },
    [boardRef, captureRects, latestRef]
  );

  return {
    setColumnRef,
    handleHeaderClick,
    handleHeaderKeyDown,
  };
};
