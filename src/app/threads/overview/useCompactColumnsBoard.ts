import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { compactCardNavigation, findCompactCard, focusCompactCard } from './compactCardKeys';
import {
  COMPACT_COLUMN_CARDS_STEP,
  COMPACT_COLUMN_INITIAL_CARDS,
  getVisibleColumnCardIds,
} from './compactColumnsLayout';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';

type ScopeColumnsMemory = {
  scrollLeft?: number;
  scrollTops: Map<CompactThreadSectionId, number>;
  limits: Map<CompactThreadSectionId, number>;
};
const columnsMemories = new WeakMap<ScrollAnchorMemory, Map<string, ScopeColumnsMemory>>();

const getScopeColumnsMemory = (
  memory: ScrollAnchorMemory,
  scopeKey: string
): ScopeColumnsMemory => {
  let scopes = columnsMemories.get(memory);
  if (!scopes) {
    scopes = new Map();
    columnsMemories.set(memory, scopes);
  }
  let scope = scopes.get(scopeKey);
  if (!scope) {
    scope = { scrollTops: new Map(), limits: new Map() };
    scopes.set(scopeKey, scope);
  }
  return scope;
};

export type UseCompactColumnsBoardOptions = {
  viewRef: RefObject<HTMLElement | null>;
  scopeKey: string;
  sections: readonly CompactThreadSection[];
  folded: readonly CompactThreadSectionId[];
  scrollMemory: ScrollAnchorMemory;
  idOf?: (card: HTMLElement) => string | undefined;
};

/**
 * Shared board controller for Columns mode across CompactRoomView and SpaceThreadsList:
 * owns per-column progressive card caps, reveals target cards on demand (for `End`/arrow
 * navigation and deep links), registers full open-column card order with keyboard navigation,
 * and preserves column state and horizontal scroll across List <-> Columns remounts.
 */
export const useCompactColumnsBoard = ({
  viewRef,
  scopeKey,
  sections,
  folded,
  scrollMemory,
  idOf,
}: UseCompactColumnsBoardOptions) => {
  const scopeState = getScopeColumnsMemory(scrollMemory, scopeKey);
  // Capture before scroll listeners or cap persistence can populate this scope.
  const [hadSavedColumnsOnMount] = useState(
    () =>
      scopeState.scrollLeft !== undefined ||
      scopeState.limits.size > 0 ||
      [...scopeState.scrollTops.values()].some((top) => top > 0)
  );
  const boardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return undefined;
    board.scrollLeft = scopeState.scrollLeft ?? 0;
    const save = () => {
      scopeState.scrollLeft = board.scrollLeft;
    };
    board.addEventListener('scroll', save, { passive: true });
    return () => board.removeEventListener('scroll', save);
  }, [scopeState]);
  // Start each visit with a snapshot of the scope’s committed limits.
  const savedLimits = useMemo<ReadonlyMap<CompactThreadSectionId, number>>(
    () => new Map(scopeState.limits),
    [scopeState]
  );
  const [limitState, setLimitState] = useState({ savedLimits, limits: savedLimits });
  const limits = limitState.savedLimits === savedLimits ? limitState.limits : savedLimits;
  const pendingFocusIdRef = useRef<string | null>(null);

  const foldedSet = useMemo(() => new Set(folded), [folded]);
  const allOpenIds = useMemo(
    () => sections.flatMap((section) => (foldedSet.has(section.id) ? [] : section.rootIds)),
    [foldedSet, sections]
  );
  const visibleIds = useMemo(
    () => getVisibleColumnCardIds(sections, folded, limits),
    [folded, limits, sections]
  );
  const latestRef = useLatestRef({ sections, foldedSet });

  useLayoutEffect(() => {
    limits.forEach((limit, id) => {
      if (limit > (scopeState.limits.get(id) ?? COMPACT_COLUMN_INITIAL_CARDS)) {
        scopeState.limits.set(id, limit);
      }
    });
  }, [limits, scopeState]);

  const updateLimit = useCallback(
    (id: CompactThreadSectionId, getNext: (current: number) => number) => {
      setLimitState((prev) => {
        const base = prev.savedLimits === savedLimits ? prev.limits : savedLimits;
        const current = base.get(id) ?? COMPACT_COLUMN_INITIAL_CARDS;
        const next = getNext(current);
        if (next <= current) return prev;
        return { savedLimits, limits: new Map(base).set(id, next) };
      });
    },
    [savedLimits]
  );
  const showMore = useCallback(
    (id: CompactThreadSectionId) =>
      updateLimit(id, (current) => current + COMPACT_COLUMN_CARDS_STEP),
    [updateLimit]
  );

  const revealCard = useCallback(
    (cardId: string): boolean => {
      const { sections: currentSections, foldedSet: currentFolded } = latestRef.current;
      for (const section of currentSections) {
        if (currentFolded.has(section.id)) continue;
        const index = section.rootIds.indexOf(cardId);
        if (index < 0) continue;
        const needed =
          Math.ceil((index + 1) / COMPACT_COLUMN_CARDS_STEP) * COMPACT_COLUMN_CARDS_STEP;
        updateLimit(section.id, () => needed);
        return true;
      }
      return false;
    },
    [latestRef, updateLimit]
  );

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || typeof document === 'undefined') return undefined;
    const focus = (id: string | undefined): boolean => {
      if (!id) return false;
      const existing = findCompactCard(view, id);
      if (existing) {
        pendingFocusIdRef.current = null;
        existing.scrollIntoView?.({ block: 'nearest' });
        return focusCompactCard(existing);
      }
      if (!revealCard(id)) return false;
      pendingFocusIdRef.current = id;
      return true;
    };
    const nav = { ids: allOpenIds, idOf, focus };
    compactCardNavigation.set(view, nav);

    const pendingId = pendingFocusIdRef.current;
    if (pendingId) {
      if (!allOpenIds.includes(pendingId)) {
        pendingFocusIdRef.current = null;
      } else {
        const revealed = findCompactCard(view, pendingId);
        if (revealed) {
          pendingFocusIdRef.current = null;
          revealed.scrollIntoView?.({ block: 'nearest' });
          focusCompactCard(revealed);
        }
      }
    }

    return () => {
      if (compactCardNavigation.get(view) === nav) compactCardNavigation.delete(view);
    };
  }, [allOpenIds, idOf, revealCard, viewRef, visibleIds]);

  return {
    boardRef,
    hadSavedColumnsOnMount,
    limits,
    allOpenIds,
    visibleIds,
    scrollTops: scopeState.scrollTops,
    showMore,
    revealCard,
  };
};
