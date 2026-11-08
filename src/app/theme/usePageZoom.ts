import { useEffect } from 'react';
import { useSetting } from '../preferences/useSetting';
import { PAGE_ZOOM_DEFAULT, settingsAtom } from '../preferences/settings';
import { usePinchToZoom } from './usePinchToZoom';

/**
 * Scales the root font size by the page zoom setting. folds sizes everything in rem, so the
 * whole interface grows or shrinks with it; at 100 % the browser default stays untouched. A pinch
 * anywhere in the app changes the setting (`usePinchToZoom`).
 */
export const usePageZoom = (): void => {
  const [pageZoom, setPageZoom] = useSetting(settingsAtom, 'pageZoom');
  usePinchToZoom(pageZoom, setPageZoom);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.style.fontSize = pageZoom === PAGE_ZOOM_DEFAULT ? '' : `${pageZoom}%`;
    return () => {
      root.style.fontSize = '';
    };
  }, [pageZoom]);
};
