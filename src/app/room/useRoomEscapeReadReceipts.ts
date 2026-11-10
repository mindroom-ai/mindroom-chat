import { useCallback } from 'react';
import { isKeyHotkey } from 'is-hotkey';
import { useStore } from 'jotai';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { markMainTimelineAsRead, markThreadAsRead } from '../notifications/readReceipts';
import {
  conversationBehindPanelAtom,
  conversationOutOfSightAtom,
  conversationUnderThreadAtom,
} from '../navigation/conversationCover';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';

type UseRoomEscapeReadReceiptsOptions = {
  hideActivity: boolean;
  roomId: string;
  threadId?: string;
};

export const useRoomEscapeReadReceipts = ({
  hideActivity,
  roomId,
  threadId,
}: UseRoomEscapeReadReceiptsOptions): void => {
  const mx = useMatrixClient();
  const store = useStore();

  // Escape marks the conversation as read, wherever the focus is on the page: an open thread, or
  // else the room's own messages, never its threads.
  useKeyDown(
    window,
    useCallback(
      (evt: KeyboardEvent) => {
        // The thread's column filling the page hides the room's messages, not the thread.
        const threadShows =
          !!threadId &&
          store.get(conversationUnderThreadAtom) &&
          !store.get(conversationBehindPanelAtom) &&
          !store.get(phoneNavDrawerOpenAtom);
        if (store.get(conversationOutOfSightAtom) && !threadShows) return;
        if (!isKeyHotkey('escape', evt)) return;
        if (threadId) {
          markThreadAsRead(mx, roomId, threadId, hideActivity);
          return;
        }
        markMainTimelineAsRead(mx, roomId, hideActivity);
      },
      [hideActivity, mx, roomId, store, threadId]
    )
  );
};
