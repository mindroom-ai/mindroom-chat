import { useEffect, useEffectEvent, useState } from 'react';

/** The newest report for `target` in a batch, which can include several layout passes. */
export function getIntersectionObserverEntry(
  target: Element | null | undefined,
  entries: readonly IntersectionObserverEntry[]
): IntersectionObserverEntry | undefined {
  if (!target) return undefined;
  return entries.findLast((entry) => entry.target === target);
}

/**
 * One IntersectionObserver for the element(s) `getElement` returns, rebuilt when either getter
 * changes. The latest `onIntersection` always runs, so callers need not memoize it. Undefined
 * where the browser has no IntersectionObserver.
 */
export const useIntersectionObserver = (
  onIntersection: (entries: IntersectionObserverEntry[]) => void,
  getOptions?: () => IntersectionObserverInit | undefined,
  getElement?: () => Element | Element[] | null | undefined
): IntersectionObserver | undefined => {
  const handleIntersection = useEffectEvent(onIntersection);
  const [observer, setObserver] = useState<IntersectionObserver>();

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const nextObserver = new IntersectionObserver(
      (entries) => handleIntersection(entries),
      getOptions?.()
    );
    const target = getElement?.();
    (Array.isArray(target) ? target : [target]).forEach((element) => {
      if (element) nextObserver.observe(element);
    });
    setObserver(nextObserver);
    return () => {
      nextObserver.disconnect();
      setObserver(undefined);
    };
  }, [getOptions, getElement]);

  return observer;
};
