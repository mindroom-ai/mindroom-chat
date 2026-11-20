import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useStore } from 'jotai';
import { EventStatus, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { isFailedLocalEchoEvent } from '../matrix/protocol/pendingLocalEcho';
import { moveMessageDraft } from './roomInputDrafts';

/** A send the composer holds while its thread's root waits for the server. */
export type HeldSend = { kind: 'message' } | { kind: 'sticker'; mxc: string; label: string };

type Held = { root: MatrixEvent; localId: string; sends: HeldSend[] };

/** The root failed to send or was deleted unsent: nothing can wait for it. */
const isDeadRoot = (root: MatrixEvent): boolean =>
  isFailedLocalEchoEvent(root) || root.status === EventStatus.CANCELLED;

type Options = {
  room: Room;
  roomId: string;
  threadId: string | undefined;
  userId: string;
  /** Sends what waited, with the composer's newest handlers, once the root has its own ID. */
  onConfirmedRef: RefObject<((sends: HeldSend[]) => void) | undefined>;
};

/**
 * A thread opened by a message the server has not confirmed yet has that message's local ID,
 * which no reply can point at. The composer stays usable there:
 * - its draft moves with the thread when the root gets its own ID, and to the room's composer,
 *   after the text it holds, when the root is deleted unsent;
 * - a send waits, its text in the composer, until the root has its own ID, and then goes out
 *   (`hold`). A root that fails to send, or a composer that moves elsewhere, drops the wait and
 *   the text stays where it is.
 *
 * Call it before `useRoomInputDraft`: its draft move has to come after that hook saves the old
 * thread's draft and before it restores the new one's.
 */
export const useUnconfirmedRootSends = ({
  room,
  roomId,
  threadId,
  userId,
  onConfirmedRef,
}: Options) => {
  const store = useStore();
  const previousRef = useRef<{ roomId: string; threadId?: string; root?: MatrixEvent }>({
    roomId,
  });

  useLayoutEffect(() => {
    const previous = previousRef.current;
    const pendingRoot =
      threadId && isLocalEchoEventId(threadId) ? room.findEventById(threadId) : undefined;
    previousRef.current = { roomId, threadId, root: pendingRoot };
    const { root } = previous;
    if (!root || previous.roomId !== roomId || previous.threadId === threadId) return;
    const confirmed = root.getId() === threadId;
    const deleted = root.status === EventStatus.CANCELLED && threadId === undefined;
    if (!confirmed && !deleted) return;
    moveMessageDraft(store, userId, roomId, previous.threadId, threadId);
  }, [room, roomId, store, threadId, userId]);

  const [held, setHeld] = useState<Held>();

  /** Holds `send` when the thread's root is unconfirmed; false when it can go out now. */
  const hold = useCallback(
    (send: HeldSend): boolean => {
      if (!threadId || !isLocalEchoEventId(threadId)) return false;
      const root = room.findEventById(threadId);
      // A failed or deleted root takes nothing; its Retry and Delete show above the composer.
      if (!root || isDeadRoot(root)) return true;
      setHeld((current) => {
        const sends = current?.localId === threadId ? current.sends : [];
        if (send.kind === 'message' && sends.some((waiting) => waiting.kind === 'message')) {
          return current;
        }
        return { root, localId: threadId, sends: [...sends, send] };
      });
      return true;
    },
    [room, threadId]
  );

  const rootStatus = held?.root.status;
  useEffect(() => {
    if (!held) return;
    if (threadId === held.localId && !isDeadRoot(held.root)) return;
    setHeld(undefined);
    const confirmed = !!threadId && !isLocalEchoEventId(threadId);
    if (confirmed && held.root.getId() === threadId) onConfirmedRef.current?.(held.sends);
  }, [held, onConfirmedRef, rootStatus, threadId]);

  return { hold, waiting: held !== undefined };
};
