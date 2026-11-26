import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { tabbablesOf } from '../../lib/overlayFocus';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { compactCardNavigation, compactCardsIn, focusCompactCard } from './compactCardKeys';
import { useCompactBlocks } from './useCompactBlocks';

type FocusIntent = {
  id: string;
  scope: string;
  from: Element | null;
  last?: boolean;
  at: readonly [number, number];
};

type Options = {
  groups: Record<string, string[]>;
  memory?: ScrollAnchorMemory;
  memoryKey: string;
  keyScope?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  contentRef?: RefObject<HTMLDivElement | null>;
  priorityTarget?: string;
  protectedId?: string;
  records?: ReadonlyMap<string, unknown>;
  indexPending?: boolean;
  getRowId?: (row: Element) => string | undefined;
};

/** Shared block virtualization and card key navigation for compact thread lists. */
export function useVirtualCompactList(options: Options) {
  const { groups, memoryKey, keyScope = memoryKey, priorityTarget, protectedId } = options;
  const { records, indexPending, getRowId } = options;
  const ownScrollRef = useRef<HTMLDivElement>(null);
  const ownContentRef = useRef<HTMLDivElement>(null);
  const ownMemoryRef = useRef<ScrollAnchorMemory>(new Map());
  const scrollRef = options.scrollRef ?? ownScrollRef;
  const contentRef = options.contentRef ?? ownContentRef;
  const memory = options.memory ?? ownMemoryRef.current;

  const ids = useMemo(() => Object.values(groups).flat(), [groups]);
  const [intent, setIntent] = useState<FocusIntent>();
  const pending = intent?.scope === keyScope && ids.includes(intent.id) ? intent : undefined;
  const hasPriorityTarget = priorityTarget !== undefined && ids.includes(priorityTarget);
  const idOf = useMemo(
    () =>
      getRowId
        ? (card: HTMLElement) =>
            getRowId(card.closest('[data-scroll-anchor]') ?? card) ?? card.dataset.threadRootId
        : undefined,
    [getRowId]
  );

  const blocks = useCompactBlocks({
    groups,
    scrollRef,
    contentRef,
    memory,
    roomId: memoryKey,
    target: hasPriorityTarget ? priorityTarget : pending?.id,
    protectedId,
    records,
    indexPending,
    getRowId,
  });

  const findCard = useCallback(
    (id: string) => {
      const view = scrollRef.current;
      if (!view) return undefined;
      const cardKey = idOf ?? ((el: HTMLElement) => el.dataset.threadRootId);
      return compactCardsIn(view).find((entry) => cardKey(entry) === id);
    },
    [idOf, scrollRef]
  );

  useLayoutEffect(() => {
    const view = scrollRef.current;
    if (!view || typeof document === 'undefined') return undefined;
    // A card's button, or the last control Tab reaches in the card: where Shift+Tab enters it.
    const card = (id: string, last?: boolean) => {
      const button = findCard(id);
      const shell = last && button?.closest('[data-scroll-anchor]');
      return (shell && tabbablesOf(shell).at(-1)) || button;
    };
    const at = () => [view.scrollTop, blocks.progress.input] as const;
    const focus = (id: string | undefined, last?: boolean) => {
      if (!id) return false;
      if (focusCompactCard(card(id, last))) setIntent(undefined);
      else {
        if (!document.activeElement || document.activeElement === document.body)
          view.focus({ preventScroll: true });
        setIntent({ id, scope: keyScope, from: document.activeElement, last, at: at() });
      }
      return true;
    };
    compactCardNavigation.set(view, { ids, idOf, focus });
    const active = document.activeElement;
    // A reader whose input scrolled the list since the key keeps the place, as with an address.
    const left = pending && at().every((now, i) => now !== pending.at[i]);
    if (intent && (!pending || left || (active !== pending.from && active !== document.body)))
      setIntent(undefined);
    else if (pending && !hasPriorityTarget && blocks.targetReady) {
      focusCompactCard(card(pending.id, pending.last));
      // The focus scrolled the list: the window follows before the target's band is let go.
      blocks.progress.onWrite?.();
      setIntent(undefined);
    }
    return () => void compactCardNavigation.delete(view);
  }, [
    blocks.progress,
    blocks.targetReady,
    findCard,
    hasPriorityTarget,
    idOf,
    ids,
    intent,
    keyScope,
    pending,
    scrollRef,
  ]);

  return { scrollRef, contentRef, memory, ids, hasPriorityTarget, findCard, ...blocks };
}
