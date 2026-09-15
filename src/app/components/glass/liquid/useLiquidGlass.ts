import { Ref, RefCallback, useCallback, useEffect, useRef } from 'react';
import { attachLiquidGlass } from './liquidGlass';

export const useLiquidGlass = <T extends HTMLElement>(
  forwardedRef?: Ref<T>,
  enabled = true
): RefCallback<T> => {
  const element = useRef<T | null>(null);
  const cleanup = useRef<(() => void) | undefined>();
  useEffect(() => {
    // React 18 StrictMode replays effects without replaying DOM refs.
    if (enabled && element.current && !cleanup.current) {
      cleanup.current = attachLiquidGlass(element.current);
    }
    return () => {
      cleanup.current?.();
      cleanup.current = undefined;
    };
  }, [enabled]);

  return useCallback(
    (node: T | null) => {
      cleanup.current?.();
      cleanup.current = undefined;
      element.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) (forwardedRef as { current: T | null }).current = node;
      if (enabled && node) cleanup.current = attachLiquidGlass(node);
    },
    [enabled, forwardedRef]
  );
};
