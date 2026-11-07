import { useCallback } from 'react';
import { useStore } from 'jotai';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';

/**
 * Whether the reader sees the timeline now, which automatic read receipts wait for: the window has
 * the focus, no phone navigation drawer covers the page and no plugin's cover the conversation. The
 * function keeps its identity and reads both when called. Without a `document` (a unit test in
 * Node) the reader sees nothing.
 */
export const useReaderSees = (): (() => boolean) => {
  const store = useStore();
  return useCallback(
    () =>
      typeof document !== 'undefined' &&
      document.hasFocus() &&
      !store.get(phoneNavDrawerOpenAtom) &&
      !store.get(conversationCoveredAtom),
    [store]
  );
};
