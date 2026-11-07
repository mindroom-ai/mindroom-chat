import { useCallback } from 'react';
import { isKeyHotkey } from 'is-hotkey';
import { useStore } from 'jotai';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { markMainTimelineAsRead, markThreadAsRead } from '../notifications/readReceipts';
import { conversationOutOfSightAtom } from '../navigation/conversationCover';

type UseRoomEscapeReadReceiptsOptions = {
  /** A panel covers the conversation, so its messages are not in view. */
  conversationHidden?: boolean;
  hideActivity: boolean;
  roomId: string;
  threadId?: string;
};

export const useRoomEscapeReadReceipts = ({
  conversationHidden = false,
  hideActivity,
  roomId,
  threadId,
}: UseRoomEscapeReadReceiptsOptions): void => {
  const mx = useMatrixClient();
  // A phone's navigation drawer over the page, or a plugin's cover, hides the conversation too.
  const store = useStore();

  // Escape marks the conversation as read, wherever the focus is on the page: an open thread, or
  // else the room's own messages, never its threads.
  useKeyDown(window,
    useCallback(
      (evt: KeyboardEvent) => {
        if (conversationHidden || store.get(conversationOutOfSightAtom)) return;
        if (!isKeyHotkey('escape', evt)) return;
        if (threadId) {
          markThreadAsRead(mx, roomId, threadId, hideActivity);
          return;
        }
        markMainTimelineAsRead(mx, roomId, hideActivity);
      },
      [conversationHidden, hideActivity, mx, roomId, store, threadId]
    )
  );
};
