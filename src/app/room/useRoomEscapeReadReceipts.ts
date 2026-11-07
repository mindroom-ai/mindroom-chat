import { useCallback } from 'react';
import { isKeyHotkey } from 'is-hotkey';
import { useAtomValue } from 'jotai';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { markMainTimelineAsRead, markThreadAsRead } from '../notifications/readReceipts';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';

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
  // A phone's navigation drawer over the page covers the conversation too.
  const navDrawerOpen = useAtomValue(phoneNavDrawerOpenAtom);

  // Escape marks the conversation as read, wherever the focus is on the page: an open thread, or
  // else the room's own messages, never its threads.
  useKeyDown(window,
    useCallback(
      (evt: KeyboardEvent) => {
        if (conversationHidden || navDrawerOpen || !isKeyHotkey('escape', evt)) return;
        if (threadId) {
          markThreadAsRead(mx, roomId, threadId, hideActivity);
          return;
        }
        markMainTimelineAsRead(mx, roomId, hideActivity);
      },
      [conversationHidden, hideActivity, mx, navDrawerOpen, roomId, threadId]
    )
  );
};
