import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** New cards that mount with the list's first screenful, whatever else is pending. */
export const FIRST_SCREEN_CARDS = 24;
/** New cards that mount per task once a change brings more than this many. */
export const CARD_MOUNT_CHUNK = 40;

/**
 * The cards to render now. A filter change can bring back hundreds of cards at once, and mounting
 * them all in the frame after the click took 160 to 200 ms in a room with 600 threads (live test
 * L6-F020). So, after the first render, cards already shown stay, the new ones in the first
 * screenful of the list mount at once, and the others mount `CARD_MOUNT_CHUNK` per task, in list
 * order. A change that brings no more than `CARD_MOUNT_CHUNK` new cards (a new thread, a stream)
 * renders the whole list at once, as does the first render of a room (`scope`), so a remembered
 * scroll position finds its card.
 */
export const useStagedCardIds = (scope: string, threadRootIds: string[]): string[] => {
  // The cards of the last commit in this scope.
  const mountedRef = useRef<{ scope: string; ids: ReadonlySet<string> }>();
  const [, nextChunk] = useState(0);
  const mounted = mountedRef.current?.scope === scope ? mountedRef.current.ids : undefined;

  const shownIds = useMemo(() => {
    if (!mounted) return threadRootIds;
    const pending = threadRootIds.reduce((count, id) => (mounted.has(id) ? count : count + 1), 0);
    if (pending <= CARD_MOUNT_CHUNK) return threadRootIds;
    let budget = CARD_MOUNT_CHUNK;
    return threadRootIds.filter((id, index) => {
      if (mounted.has(id) || index < FIRST_SCREEN_CARDS) return true;
      budget -= 1;
      return budget >= 0;
    });
  }, [mounted, threadRootIds]);

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
