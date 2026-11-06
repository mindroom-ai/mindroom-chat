import { useLayoutEffect, useMemo, useRef } from 'react';
import { applyFrozenThreadOrder } from '../../event-store/threads/roomThreadOverviewModel';

/**
 * The overview's thread order, held while `held` (the reader points at, focuses or has a menu
 * open on a card) so no card moves under the pointer: the threads keep the order they were shown
 * in, threads that leave the list go, and new ones join at the end. Once released, the live
 * order applies.
 */
export const useHeldThreadOrder = (liveRootIds: string[], held: boolean): string[] => {
  const shownRef = useRef(liveRootIds);
  const shown = useMemo(
    () => (held ? applyFrozenThreadOrder(shownRef.current, liveRootIds) : liveRootIds),
    [held, liveRootIds]
  );
  useLayoutEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  return shown;
};
