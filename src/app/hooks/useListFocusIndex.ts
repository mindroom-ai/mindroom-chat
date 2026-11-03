import { useCallback, useEffect, useState } from 'react';

/**
 * Keyboard focus within a list of `size` items, wrapping at both ends. The index returns to
 * `initialIndex` when the list size changes.
 */






  }, [size, initialIndex]);

  const next = useCallback(() => {
    setIndex((current) => (size <= 0 ? initialIndex : (current + 1) % size));
  }, [size, initialIndex]);

  const previous = useCallback(() => {
    setIndex((current) => (size <= 0 ? initialIndex : (current - 1 + size) % size));
  }, [size, initialIndex]);

  const reset = useCallback(() => setIndex(initialIndex), [initialIndex]);

  return { index, setIndex, next, previous, reset };
};
