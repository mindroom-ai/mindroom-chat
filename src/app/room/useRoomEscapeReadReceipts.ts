import { useCallback } from 'react';
import { isKeyHotkey } from 'is-hotkey';
import { useStore } from 'jotai';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { markMainTimelineAsRead, markThreadAsRead } from '../notifications/readReceipts';
import { conversationOutOfSightAtom } from '../navigation/conversationCover';
import { ROOM_MESSAGES_VIEW, shownConversationViewsAtom } from '../navigation/conversationView';
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
  // else the room's own messages, never its threads; beside the thread's column, the messages
  // unless the key was pressed in the column.
  useKeyDown(
    window,
    useCallback(
      (evt: KeyboardEvent) => {
        // A thread in a view of its own (the room page's column) shows while the page's own
        // conversation is hidden, under a plugin's cover or under that column.
        const threadShows =
          !!threadId &&
          !store.get(phoneNavDrawerOpenAtom) &&
          store
            .get(shownConversationViewsAtom)
            .some((place) => place.roomId === roomId && place.threadId === threadId);
        if (store.get(conversationOutOfSightAtom) && !threadShows) return;
        if (!isKeyHotkey('escape', evt)) return;
        // Beside the thread's column, Escape outside the column is the room's messages'. The key's
        // target says where it was pressed: the focus shortcut may have moved the focus since.
        const messagesBeside = store
          .get(shownConversationViewsAtom)
          .some((place) => place.roomId === roomId && place.view === ROOM_MESSAGES_VIEW);
        if (
          threadId &&
          (!messagesBeside ||
            (evt.target instanceof Element && !!evt.target.closest('[data-thread-column]')))
        ) {
          markThreadAsRead(mx, roomId, threadId, hideActivity);
          return;
        }
        markMainTimelineAsRead(mx, roomId, hideActivity);
      },
      [hideActivity, mx, roomId, store, threadId]
    )
  );
};
