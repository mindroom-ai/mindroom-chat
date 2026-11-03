import { useEffect, useRef, useState } from 'react';













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
