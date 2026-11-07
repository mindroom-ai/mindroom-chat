import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';

/**
 * Whether the reader sees the timeline now, which automatic read receipts wait for: the window has
 * the focus and no phone navigation drawer covers the page. The function keeps its identity and
 * reads the newest drawer state. Without a `document` (a unit test in Node) the reader sees nothing.
 */
export const useReaderSees = (): (() => boolean) => {
  const drawerOpenRef = useLatestRef(useAtomValue(phoneNavDrawerOpenAtom));
  return useCallback(
    () => typeof document !== 'undefined' && document.hasFocus() && !drawerOpenRef.current,
    [drawerOpenRef]
  );
};
