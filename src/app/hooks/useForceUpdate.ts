import { useCallback, useState } from 'react';

/**
 * A render counter and a stable function that bumps it. Callers list the counter in memo
 * dependencies to recompute values that live outside React state.
 */
export const useForceUpdate = (): [number, () => void] => {
  const [version, setVersion] = useState(0);
  const update = useCallback(() => setVersion((current) => current + 1), []);
  return [version, update];
};
