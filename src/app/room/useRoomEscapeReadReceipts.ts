import { useCallback } from 'react';
import { isKeyHotkey } from 'is-hotkey';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { markRoomAndThreadsAsRead, markThreadAsRead } from '../notifications/readReceipts';

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

  // Escape marks the conversation as read, wherever the focus is on the page.
  useKeyDown(window,
    useCallback(
      (evt: KeyboardEvent) => {
        if (conversationHidden || !isKeyHotkey('escape', evt)) return;
        if (threadId) {
          markThreadAsRead(mx, roomId, threadId, hideActivity);
          return;
        }
        markRoomAndThreadsAsRead(mx, roomId, hideActivity);
      },
      [conversationHidden, hideActivity, mx, roomId, threadId]
    )
  );
};
