import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useSetting } from '../preferences/useSetting';
import { PAGE_ZOOM_DEFAULT, settingsAtom, stepPageZoom } from '../preferences/settings';
import { useShortcut } from '../shortcuts/useShortcut';
import { usePinchToZoom } from './usePinchToZoom';

/**
 * Scales the root font size by the page zoom setting. folds sizes everything in rem, so the
 * whole interface grows or shrinks with it; at 100 % the browser default stays untouched. A pinch
 * anywhere in the app changes the setting (`usePinchToZoom`), and so do a browser's zoom keys in
 * the native apps, where no browser takes them.
 */
export const usePageZoom = (): void => {
  const [pageZoom, setPageZoom] = useSetting(settingsAtom, 'pageZoom');
  usePinchToZoom(pageZoom, setPageZoom);
  const native = Capacitor.isNativePlatform();
  const zoomTo = (next: (zoom: number) => number) => {
    setPageZoom(next);
    return true;
  };
  useShortcut('zoomIn', () => zoomTo((zoom) => stepPageZoom(zoom, 1)), native);
  useShortcut('zoomOut', () => zoomTo((zoom) => stepPageZoom(zoom, -1)), native);
  useShortcut('resetZoom', () => zoomTo(() => PAGE_ZOOM_DEFAULT), native);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.style.fontSize = pageZoom === PAGE_ZOOM_DEFAULT ? '' : `${pageZoom}%`;
    return () => {
      root.style.fontSize = '';
    };
  }, [pageZoom]);
};
