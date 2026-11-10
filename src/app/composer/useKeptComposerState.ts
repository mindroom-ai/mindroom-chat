import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { useInConversationView } from '../navigation/conversationView';
import { isPasteFileName } from '../matrix/protocol/pasteAttachmentMarker';
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
 * text alone without noticing. Large pastes are not among them: their text is kept with the draft
 * (`keptPastes.ts`), and the composer's attachments put them back.
 */
export const useKeptComposerState = (ownUserId: string, roomId: string): KeptComposerState => {
  const store = useStore();
  // Another view of the room (a plugin's thread view) keeps nothing; the room's page does.
  const userId = useInConversationView() ? '' : ownUserId;
  const itemsAtom = roomIdToUploadItemsAtomFamily(roomId);
  // Pastes the composer puts back do not answer the notice of the other files.
  const stagedCount = useAtomValue(itemsAtom).filter(
    (item) => !isPasteFileName(item.originalFile.name)
  ).length;

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
    const kept = userId && !staged ? readKeptFileNames(userId, roomId) : [];
    setLost({ roomId, names: kept.filter((name) => !isPasteFileName(name)) });
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
