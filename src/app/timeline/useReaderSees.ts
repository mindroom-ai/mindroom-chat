import { useCallback } from 'react';
import { useStore } from 'jotai';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';

/**
 * Whether the reader sees the timeline now, which automatic read receipts wait for: the window has
 * the focus and no phone navigation drawer covers the page. The function keeps its identity and
 * reads the drawer when called. Without a `document` (a unit test in Node) the reader sees nothing.
 */
export const useReaderSees = (): (() => boolean) => {
  const store = useStore();
  return useCallback(
    () =>
      typeof document !== 'undefined' && document.hasFocus() && !store.get(phoneNavDrawerOpenAtom),
    [store]
  );
};
