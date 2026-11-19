import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useSetting } from '../preferences/useSetting';
import { PAGE_ZOOM_DEFAULT, settingsAtom, stepPageZoom } from '../preferences/settings';
import { isComposingKey, matchesShortcut } from '../shortcuts/shortcuts';
import { usePinchToZoom } from './usePinchToZoom';

const ZOOM_KEYS = [
  ['zoomIn', (zoom: number) => stepPageZoom(zoom, 1)],
  ['zoomOut', (zoom: number) => stepPageZoom(zoom, -1)],
  ['resetZoom', () => PAGE_ZOOM_DEFAULT],
] as const;

/**
 * Scales the root font size by the page zoom setting. folds sizes everything in rem, so the
 * whole interface grows or shrinks with it; at 100 % the browser default stays untouched. A pinch
 * anywhere in the app changes the setting (`usePinchToZoom`), and so do a browser's zoom keys in
 * the native apps, where no browser takes them.
 */
export const usePageZoom = (): void => {
  const [pageZoom, setPageZoom] = useSetting(settingsAtom, 'pageZoom');
  usePinchToZoom(pageZoom, setPageZoom);

  // From any field or dialog, signed in or out; held keys repeat.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isComposingKey(event)) return;
      const zoom = ZOOM_KEYS.find(([id]) => matchesShortcut(event, id));
      if (!zoom) return;
      event.preventDefault();
      setPageZoom(zoom[1]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setPageZoom]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.style.fontSize = pageZoom === PAGE_ZOOM_DEFAULT ? '' : `${pageZoom}%`;
    return () => {
      root.style.fontSize = '';
    };
  }, [pageZoom]);
};
