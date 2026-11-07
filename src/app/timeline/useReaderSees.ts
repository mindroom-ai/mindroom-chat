import { useCallback } from 'react';
import { useStore } from 'jotai';
import { conversationOutOfSightAtom } from '../navigation/conversationCover';

/**
 * Whether the reader sees the timeline now, which automatic read receipts wait for: the window has
 * the focus and the conversation is not out of sight (`conversationOutOfSightAtom`). The function
 * keeps its identity and reads the atom when called. Without a `document` (a unit test in Node)
 * the reader sees nothing.
 */
export const useReaderSees = (): (() => boolean) => {
  const store = useStore();
  return useCallback(
    () =>
      typeof document !== 'undefined' &&
      document.hasFocus() &&
      !store.get(conversationOutOfSightAtom),
    [store]
  );
};
