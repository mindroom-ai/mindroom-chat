import { useCallback, useEffect, useState } from 'react';

/**
 * Keyboard focus within a list of `itemCount` items, wrapping at both ends. The index returns to
 * `startIndex` when the list size changes.
 */
export const useListFocusIndex = (itemCount: number, startIndex: number) => {
  const [index, setIndex] = useState(startIndex);

  // A new list starts over: the old position may not exist in it.
  useEffect(() => setIndex(startIndex), [itemCount, startIndex]);

  // Moves the focus one item forward or back; an empty list keeps it on `startIndex`.
  const step = useCallback(
    (delta: 1 | -1) =>
      setIndex((current) =>
        itemCount <= 0 ? startIndex : (current + delta + itemCount) % itemCount
      ),
    [itemCount, startIndex]
  );
  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);
  const reset = useCallback(() => setIndex(startIndex), [startIndex]);

  return { index, setIndex, next, previous, reset };
};
