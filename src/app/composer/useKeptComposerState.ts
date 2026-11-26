import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { useInConversationView } from '../navigation/conversationView';
import { isPasteFileName } from '../matrix/protocol/pasteAttachmentMarker';
import {
  getRoomInputDraftKey,
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
export const useKeptComposerState = (
  ownUserId: string,
  roomId: string,
  stagedDraftKey?: string
): KeptComposerState => {
  const store = useStore();
  // Another view of the room (a plugin's thread view, Home Ask) keeps nothing; the room's page
  // and Space's All threads composer do.
  const userId = useInConversationView() ? '' : ownUserId;
  const fileScope = stagedDraftKey ?? roomId;
  const keptFilesKey = userId ? (stagedDraftKey ?? getRoomInputDraftKey(userId, roomId)) : undefined;
  const itemsAtom = roomIdToUploadItemsAtomFamily(fileScope);
  // Pastes the composer puts back do not answer the notice of the other files.
  const stagedCount = useAtomValue(itemsAtom).filter(
    (item) => !isPasteFileName(item.originalFile.name)
  ).length;

  // Before the first paint, so the reply bar shows with the restored text.
  // Staged-draft composers take no target-room reply draft.
  useLayoutEffect(() => {
    if (!userId || stagedDraftKey !== undefined) return undefined;
    restoreKeptReplyDraft(store, userId, roomId);
    const replyAtom = roomIdToReplyDraftAtomFamily(roomId);
    return store.sub(replyAtom, () => keepReplyDraft(userId, roomId, store.get(replyAtom)));
  }, [roomId, stagedDraftKey, store, userId]);

  const [lost, setLost] = useState<{ scope: string; names: string[] }>();
  // Names kept while nothing is staged here are files the page before had.
  useLayoutEffect(() => {
    const staged = store.get(roomIdToUploadItemsAtomFamily(fileScope)).length > 0;
    const kept = keptFilesKey && !staged ? readKeptFileNames(keptFilesKey) : [];
    setLost({ scope: fileScope, names: kept.filter((name) => !isPasteFileName(name)) });
  }, [fileScope, keptFilesKey, store]);
  // Attaching files again answers the notice.
  useEffect(() => {
    if (stagedCount > 0) setLost(undefined);
  }, [stagedCount]);

  const dismissLostFiles = useCallback(() => {
    setLost(undefined);
    if (keptFilesKey && store.get(roomIdToUploadItemsAtomFamily(fileScope)).length === 0) {
      keepStagedFileNames(keptFilesKey, [], store);
    }
  }, [fileScope, keptFilesKey, store]);

  const lostFileNames = lost?.scope === fileScope ? lost.names : [];
  return { lostFileNames, dismissLostFiles };
};
