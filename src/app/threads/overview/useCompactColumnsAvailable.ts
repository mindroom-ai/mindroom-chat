import { type RefObject, useCallback, useLayoutEffect, useState } from 'react';
import { compactCardNavigation, findCompactCard, focusCompactCard } from './compactCardKeys';
import {
  COMPACT_COLUMN_CARDS_STEP,
  COMPACT_COLUMN_INITIAL_CARDS,
  COMPACT_COLUMNS_MIN_WIDTH_PX,
} from './compactColumnsLayout';
import type { CompactThreadSectionId } from './compactThreadSections';

/**
 * Observes `containerRef` with `ResizeObserver` and returns whether the pane is wide enough for
 * side-by-side workflow columns (`COMPACT_COLUMNS_MIN_WIDTH_PX`). Defaults to `false` before
 * measurement or when `ResizeObserver` is unavailable so SSR and narrow/unmeasured layouts stay
 * on vertical sections until measured wide.
 */
export const useCompactColumnsAvailable = (
  containerRef: RefObject<HTMLElement | null>
): boolean => {
  const [available, setAvailable] = useState(false);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      setAvailable(false);
      return undefined;
    }
    const measure = (width?: number) => {
      const measured = width && width > 0 ? width : element.clientWidth;
      if (measured > 0) setAvailable(measured >= COMPACT_COLUMNS_MIN_WIDTH_PX);
    };
    measure();
    const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect?.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);

  return available;
};

/** Per-column progressive card limits, reset synchronously when `scopeKey` (room/space) changes. */
export const useCompactColumnLimits = (scopeKey: string) => {
  const [state, setState] = useState<{
    scopeKey: string;
    limits: Partial<Record<CompactThreadSectionId, number>>;
  }>(() => ({ scopeKey, limits: {} }));
  const limits = state.scopeKey === scopeKey ? state.limits : {};
  const showMore = useCallback(
    (id: CompactThreadSectionId) => {
      setState((prev) => {
        const base = prev.scopeKey === scopeKey ? prev.limits : {};
        const current = base[id] ?? COMPACT_COLUMN_INITIAL_CARDS;
        return { scopeKey, limits: { ...base, [id]: current + COMPACT_COLUMN_CARDS_STEP } };
      });
    },
    [scopeKey]
  );
  return { limits, showMore };
};

/** Registers visible open-column card IDs with keyboard card navigation while Columns mode is active. */
export const useColumnsCardNavigation = (
  viewRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  ids: readonly string[],
  idOf?: (card: HTMLElement) => string | undefined
): void => {
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!enabled || !view || typeof document === 'undefined') return undefined;
    const focus = (id: string | undefined) =>
      id ? focusCompactCard(findCompactCard(view, id)) : false;
    compactCardNavigation.set(view, { ids, idOf, focus });
    return () => {
      if (compactCardNavigation.get(view)?.ids === ids) compactCardNavigation.delete(view);
    };
  }, [enabled, idOf, ids, viewRef]);
};
