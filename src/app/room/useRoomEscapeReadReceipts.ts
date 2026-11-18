import { type KeyboardEvent as ReactKeyboardEvent, useCallback } from 'react';
import { isKeyHotkey } from 'is-hotkey';
import { useStore } from 'jotai';
import { useKeyDown } from '../lib/hooks/useKeyDown';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { markMainTimelineAsRead, markThreadAsRead } from '../notifications/readReceipts';
import { conversationOutOfSightAtom } from '../navigation/conversationCover';
import { ROOM_MESSAGES_VIEW, shownConversationViewsAtom } from '../navigation/conversationView';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';

// Keys pressed in the thread's column, as its React tree sees them: on its resize handle too, and
// in the menus and dialogs it opens, which render outside it on the page.
const threadColumnKeys = new WeakSet<Event>();
export const noteThreadColumnKey = (evt: ReactKeyboardEvent): void => {
  threadColumnKeys.add(evt.nativeEvent);
};

// Keys pressed in a view of another thread on the page (the second thread beside the open one),
// with that thread: Escape there marks it read.
const threadViewKeys = new WeakMap<Event, string>();
export const noteThreadViewKey = (evt: ReactKeyboardEvent, threadId: string): void => {
  threadViewKeys.set(evt.nativeEvent, threadId);
};

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
        // Whether a view of the thread `id` of its own shows, as the room page's column does
        // while the page's own conversation is hidden, under a plugin's cover or under that column.
        const shows = (id: string | undefined) =>
          !!id &&
          !store.get(phoneNavDrawerOpenAtom) &&
          store
            .get(shownConversationViewsAtom)
            .some((place) => place.roomId === roomId && place.threadId === id);
        // Escape in a second thread's view (B) reads B where it shows, whatever covers the rest.
        const noted = threadViewKeys.get(evt);
        if (noted && isKeyHotkey('escape', evt)) {
          if (shows(noted)) void markThreadAsRead(mx, roomId, noted, hideActivity);
          return;
        }
        const threadShows = shows(threadId);
        if (store.get(conversationOutOfSightAtom) && !threadShows) return;
        if (!isKeyHotkey('escape', evt)) return;
        // Beside the thread's column, Escape outside the column is the room's messages'. The column
        // noted the key as it passed, wherever the focus shortcut has moved the focus since.
        const messagesBeside = store
          .get(shownConversationViewsAtom)
          .some((place) => place.roomId === roomId && place.view === ROOM_MESSAGES_VIEW);
        if (threadId && (!messagesBeside || threadColumnKeys.has(evt))) {
          void markThreadAsRead(mx, roomId, threadId, hideActivity);
          return;
        }
        void markMainTimelineAsRead(mx, roomId, hideActivity);
      },
      [hideActivity, mx, roomId, store, threadId]
    )
  );
};
