import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ScrollAnchorSnapshot } from '../../ui/scrollAnchorMemory';

/** New cards that mount with the list's first screenful, whatever else is pending. */
export const FIRST_SCREEN_CARDS = 24;
/** New cards that mount per task once a change brings more than this many. */
export const CARD_MOUNT_CHUNK = 40;

/**
 * How many cards a room's first render needs (`useStagedCardIds`): the first screenful, or, for a
 * room the reader left scrolled down (`place`), every card down to the last one of that place
 * still listed and a screenful past it, so the list reopens on them. A place with none of its
 * cards listed is found by its scroll position alone, which needs the whole list.
 */
export const firstRenderCardCount = (
  threadRootIds: string[],
  place: ScrollAnchorSnapshot | undefined
): number => {
  if (!place || place.scrollTop <= 0) return FIRST_SCREEN_CARDS;
  const last = Math.max(-1, ...place.anchors.map(({ key }) => threadRootIds.indexOf(key)));
  return last < 0 ? threadRootIds.length : last + 1 + FIRST_SCREEN_CARDS;
};

/**
 * The cards to render now. A filter change can bring back hundreds of cards at once, and mounting
 * them all in the frame after the click took 160 to 200 ms in a room with 600 threads (live test
 * L6-F020). So, after the first render, cards already shown stay, the new ones in the first
 * screenful of the list mount at once, and the others mount `CARD_MOUNT_CHUNK` per task, in list
 * order. A change that brings no more than `CARD_MOUNT_CHUNK` new cards (a new thread, a stream)
 * renders the whole list at once. The first render of a room (`scope`) renders its first
 * `firstCount` cards (`firstRenderCardCount`), by default the whole list, and the others mount as
 * those of a filter change: mounting all 259 cards of a room at once on the way back from a
 * thread kept a phone (4x CPU throttling) from painting for 3.5 to 5 s.
 */
export const useStagedCardIds = (
  scope: string,
  threadRootIds: string[],
  firstCount = threadRootIds.length
): string[] => {
  // The cards of the last commit in this scope.
  const mountedRef = useRef<{ scope: string; ids: ReadonlySet<string> }>();
  const [chunk, nextChunk] = useState(0);

  // Worked out again for a new list or the next chunk's task only: a room's first commit sets off
  // renders of its own in the same task, which would otherwise mount every chunk before it paints.
  // The same cards in a new array, as a rebuilt index gives them, are the same list.
  const listKey = threadRootIds.join('\n');
  const shownIds = useMemo(() => {
    void chunk;
    const mounted = mountedRef.current?.scope === scope ? mountedRef.current.ids : undefined;
    if (!mounted) {
      return firstCount < threadRootIds.length ? threadRootIds.slice(0, firstCount) : threadRootIds;
    }
    const pending = threadRootIds.reduce((count, id) => (mounted.has(id) ? count : count + 1), 0);
    if (pending <= CARD_MOUNT_CHUNK) return threadRootIds;
    let budget = CARD_MOUNT_CHUNK;
    return threadRootIds.filter((id, index) => {
      if (mounted.has(id) || index < FIRST_SCREEN_CARDS) return true;
      budget -= 1;
      return budget >= 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `listKey` stands for the list
  }, [chunk, firstCount, scope, listKey]);

  useLayoutEffect(() => {
    mountedRef.current = { scope, ids: new Set(shownIds) };
  }, [scope, shownIds]);

  // The next chunk in a task of its own, so the frame with the first screenful paints first.
  const complete = shownIds.length === threadRootIds.length;
  useEffect(() => {
    if (complete) return undefined;
    const timer = setTimeout(() => nextChunk((count) => count + 1), 0);
    return () => clearTimeout(timer);
  }, [complete, shownIds]);

  return shownIds;
};
