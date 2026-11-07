import { type RefObject, useLayoutEffect } from 'react';

/**
 * Makes the element inert (no focus, clicks or find-in-page) and hidden from assistive technology
 * while `inert` is true. React 18 has no prop for the attribute, so it is set on the element
 * itself; `aria-hidden` says the same to tools that do not read `inert`.
 */
export const useInert = (ref: RefObject<HTMLElement>, inert: boolean): void => {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    element.inert = inert;
    if (inert) element.setAttribute('aria-hidden', 'true');
    return () => {
      element.inert = false;
      element.removeAttribute('aria-hidden');
    };
  }, [ref, inert]);
};
