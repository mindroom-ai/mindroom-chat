import { useCallback } from 'react';
import { useStore } from 'jotai';
import { useConversationOutOfSightAtom } from '../navigation/conversationView';

/**
 * Whether the reader sees the timeline now, which automatic read receipts wait for: the window has
 * the focus and the conversation is not out of sight (`useConversationOutOfSightAtom`). The function
 * keeps its identity and reads the atom when called. Without a `document` (a unit test in Node)
 * the reader sees nothing.
 */
export const useReaderSees = (): (() => boolean) => {
  const store = useStore();
  const outOfSightAtom = useConversationOutOfSightAtom();
  return useCallback(
    () => typeof document !== 'undefined' && document.hasFocus() && !store.get(outOfSightAtom),
    [outOfSightAtom, store]
  );
};
