import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useAtomValue, useStore } from 'jotai';
import {
  keepReplyDraft,
  keepStagedFileNames,
  readKeptFileNames,
  restoreKeptReplyDraft,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
} from './roomInputDrafts';

type KeptComposerState = {
  /** Files staged here before the page reloaded, which a reload cannot keep; empty for none. */
  lostFileNames: string[];
  /** Hides the lost files' notice and forgets their names. */
  dismissLostFiles: () => void;
};

/**
 * What a room's composer keeps across a reload besides its text: the message being replied to
 * comes back, and the files staged before, which cannot be kept, are named, so nobody sends the
 * text alone without noticing.
 */
export const useKeptComposerState = (userId: string, roomId: string): KeptComposerState => {
  const store = useStore();
  const itemsAtom = roomIdToUploadItemsAtomFamily(roomId);
  const stagedCount = useAtomValue(itemsAtom).length;

  // Before the first paint, so the reply bar shows with the restored text.
  useLayoutEffect(() => {
    if (!userId) return undefined;
    restoreKeptReplyDraft(store, userId, roomId);
    const replyAtom = roomIdToReplyDraftAtomFamily(roomId);
    return store.sub(replyAtom, () => keepReplyDraft(userId, roomId, store.get(replyAtom)));
  }, [roomId, store, userId]);

  const [lost, setLost] = useState<{ roomId: string; names: string[] }>();
  // Names kept while nothing is staged here are files the page before had.
  useLayoutEffect(() => {
    const staged = store.get(roomIdToUploadItemsAtomFamily(roomId)).length > 0;
    setLost({ roomId, names: userId && !staged ? readKeptFileNames(userId, roomId) : [] });
  }, [roomId, store, userId]);
  // Attaching files again answers the notice.
  useEffect(() => {
    if (stagedCount > 0) setLost(undefined);
  }, [stagedCount]);

  const dismissLostFiles = useCallback(() => {
    setLost(undefined);
    if (userId && store.get(roomIdToUploadItemsAtomFamily(roomId)).length === 0) {
      keepStagedFileNames(userId, roomId, []);
    }
  }, [roomId, store, userId]);

  const lostFileNames = lost?.roomId === roomId ? lost.names : [];
  return { lostFileNames, dismissLostFiles };
};
