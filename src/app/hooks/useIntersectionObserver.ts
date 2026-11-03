import { useEffect, useRef, useState } from 'react';

/** What the observer last reported for `target`, when that batch of entries includes it. */
export function getIntersectionObserverEntry(
  target: Element | null | undefined,
  entries: readonly IntersectionObserverEntry[]
): IntersectionObserverEntry | undefined {
  if (!target) return undefined;
  return entries.find((entry) => entry.target === target);
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
  const onIntersectionRef = useRef(onIntersection);
  onIntersectionRef.current = onIntersection;
  const [observer, setObserver] = useState<IntersectionObserver>();

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const nextObserver = new IntersectionObserver(
      (entries) => onIntersectionRef.current(entries),
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
