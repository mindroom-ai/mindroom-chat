import { useEffect } from 'react';
import { useSetting } from '../preferences/useSetting';
import { PAGE_ZOOM_DEFAULT, settingsAtom } from '../preferences/settings';

/**
 * Scales the root font size by the page zoom setting. folds sizes everything in rem, so the
 * whole interface grows or shrinks with it; at 100 % the browser default stays untouched.
 */
export const usePageZoom = (): void => {
  const [pageZoom] = useSetting(settingsAtom, 'pageZoom');

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.style.fontSize = pageZoom === PAGE_ZOOM_DEFAULT ? '' : `${pageZoom}%`;
    return () => {
      root.style.fontSize = '';
    };
  }, [pageZoom]);
};
