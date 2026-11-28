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

export type CompactColumnViewState = {
  scrollTop: number;
  limit: number;
};

const EMPTY_LIMITS: Readonly<Partial<Record<CompactThreadSectionId, number>>> = {};
const columnStateMemories = new WeakMap<ScrollAnchorMemory, Map<string, CompactColumnViewState>>();

const getColumnStateMap = (
  memory?: ScrollAnchorMemory
): Map<string, CompactColumnViewState> | undefined => {
  if (!memory) return undefined;
  let states = columnStateMemories.get(memory);
  if (!states) {
    states = new Map();
    columnStateMemories.set(memory, states);
  }
  return states;
};

const readSavedLimits = (
  columnStates: ReadonlyMap<string, CompactColumnViewState> | undefined,
  scopeKey: string
): Readonly<Partial<Record<CompactThreadSectionId, number>>> => {
  if (!columnStates) return EMPTY_LIMITS;
  const prefix = `${scopeKey}:`;
  let restored: Partial<Record<CompactThreadSectionId, number>> | undefined;
  columnStates.forEach((entry, key) => {
    if (!key.startsWith(prefix) || entry.limit <= COMPACT_COLUMN_INITIAL_CARDS) return;
    const id = key.slice(prefix.length) as CompactThreadSectionId;
    restored ??= {};
    restored[id] = entry.limit;
  });
  return restored ?? EMPTY_LIMITS;
};

export type UseCompactColumnsBoardOptions = {
  viewRef: RefObject<HTMLElement | null>;
  scopeKey: string;
  sections: readonly CompactThreadSection[];
  folded: readonly CompactThreadSectionId[];
  scrollMemory?: ScrollAnchorMemory;
  idOf?: (card: HTMLElement) => string | undefined;
};

/**
 * Shared board controller for Columns mode across CompactRoomView and SpaceThreadsList:
 * owns per-column progressive card caps, reveals target cards on demand (for `End`/arrow
 * navigation and deep links), registers full open-column card order with keyboard navigation,
 * and preserves per-column `{ scrollTop, limit }` state across List <-> Columns remounts.
 */
export const useCompactColumnsBoard = ({
  viewRef,
  scopeKey,
  sections,
  folded,
  scrollMemory,
  idOf,
}: UseCompactColumnsBoardOptions) => {
  const columnStates = useMemo(() => getColumnStateMap(scrollMemory), [scrollMemory]);
  const [limitState, setLimitState] = useState<{
    scopeKey: string;
    limits: Readonly<Partial<Record<CompactThreadSectionId, number>>>;
  }>(() => ({ scopeKey, limits: readSavedLimits(columnStates, scopeKey) }));

  const limits = useMemo(
    () =>
      limitState.scopeKey === scopeKey
        ? limitState.limits
        : readSavedLimits(columnStates, scopeKey),
    [columnStates, limitState, scopeKey]
  );
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
  const latestRef = useLatestRef({ sections, foldedSet, allOpenIds, columnStates });

  useLayoutEffect(() => {
    if (!columnStates) return;
    (Object.entries(limits) as [CompactThreadSectionId, number | undefined][]).forEach(
      ([id, limit]) => {
        if (!limit || limit <= COMPACT_COLUMN_INITIAL_CARDS) return;
        const key = `${scopeKey}:${id}`;
        const prev = columnStates.get(key);
        if (!prev || prev.limit < limit) {
          columnStates.set(key, { scrollTop: prev?.scrollTop ?? 0, limit });
        }
      }
    );
  }, [columnStates, limits, scopeKey]);

  const showMore = useCallback(
    (id: CompactThreadSectionId) => {
      setLimitState((prev) => {
        const base =
          prev.scopeKey === scopeKey
            ? prev.limits
            : readSavedLimits(latestRef.current.columnStates, scopeKey);
        const current = base[id] ?? COMPACT_COLUMN_INITIAL_CARDS;
        return { scopeKey, limits: { ...base, [id]: current + COMPACT_COLUMN_CARDS_STEP } };
      });
    },
    [latestRef, scopeKey]
  );

  const revealCard = useCallback(
    (cardId: string): boolean => {
      const {
        sections: currentSections,
        foldedSet: currentFolded,
        columnStates: states,
      } = latestRef.current;
      for (const section of currentSections) {
        if (currentFolded.has(section.id)) continue;
        const index = section.rootIds.indexOf(cardId);
        if (index < 0) continue;
        const needed =
          Math.ceil((index + 1) / COMPACT_COLUMN_CARDS_STEP) * COMPACT_COLUMN_CARDS_STEP;
        setLimitState((prev) => {
          const base = prev.scopeKey === scopeKey ? prev.limits : readSavedLimits(states, scopeKey);
          const current = base[section.id] ?? COMPACT_COLUMN_INITIAL_CARDS;
          if (current >= needed) return prev;
          return { scopeKey, limits: { ...base, [section.id]: needed } };
        });
        return true;
      }
      return false;
    },
    [latestRef, scopeKey]
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
    limits,
    allOpenIds,
    visibleIds,
    columnStates,
    showMore,
    revealCard,
  };
};
