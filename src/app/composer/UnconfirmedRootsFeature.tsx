import { useEffect } from 'react';
import { useStore } from 'jotai';
import { EventStatus, RoomEvent, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import {
  getRoomInputDraftKey,
  moveMessageDraft,
  pendingVoiceSendDraftAtom,
} from './roomInputDrafts';
import { isDraftShown } from './useRoomInputDraft';

/**
 * What waits for a thread root the server has not confirmed follows the root wherever the person
 * is: when the root gets its own ID, the thread's draft moves to that ID, and when it is deleted
 * unsent, a recording kept for the thread becomes a room message, offered on the room's page.
 */
export function UnconfirmedRootsFeature() {
  const mx = useMatrixClient();
  const store = useStore();

  useEffect(() => {
    const onEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event, room, oldId) => {
      if (!oldId || !isLocalEchoEventId(oldId)) return;
      const confirmedId = event.getId();
      if (confirmedId && !isLocalEchoEventId(confirmedId)) {
        const userId = mx.getSafeUserId();
        // A composer showing the thread moves its draft itself as it follows the root.
        if (!isDraftShown(getRoomInputDraftKey(userId, room.roomId, oldId))) {
          moveMessageDraft(store, userId, room.roomId, oldId, confirmedId);
        }
        return;
      }
      const recording = store.get(pendingVoiceSendDraftAtom);
      if (
        event.status === EventStatus.CANCELLED &&
        recording?.context.roomId === room.roomId &&
        recording.context.threadId === oldId
      ) {
        store.set(pendingVoiceSendDraftAtom, {
          ...recording,
          context: {
            ...recording.context,
            threadId: undefined,
            replyDraft: undefined,
            threadView: undefined,
          },
        });
      }
    };
    mx.on(RoomEvent.LocalEchoUpdated, onEcho);
    return () => {
      mx.removeListener(RoomEvent.LocalEchoUpdated, onEcho);
    };
  }, [mx, store]);

  return null;
}
