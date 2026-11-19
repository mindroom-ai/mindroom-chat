import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { MINDROOM_SERVER_EVENT } from '../computer/agentServer';
import { findDirectRoom } from '../matrix/createRoom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getMxIdLocalPart } from '../matrix/matrix';
import { agentRoomState } from '../matrix/protocol/agentRoomState';
import { navigationRoomsAtom } from '../matrix/state/archivedRooms';
import { mDirectAtom } from '../matrix/state/mDirectList';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';

/** MindRoom's router, which routes messages and answers no question itself. */
const ROUTER = /^mindroom_router(?:_[a-z0-9]{4,32})?$/;

export type HomeAgent = {
  userId: string;
  /** The rooms it is in, the one last used with it first, then by latest activity. */
  roomIds: string[];
  /** Its direct chat with the account, if there is one. */
  directRoomId?: string;
  /**
   * Where a question to it goes: the room last used with it, else its direct chat; undefined
   * while that chat has yet to be started.
   */
  defaultRoomId?: string;
  /** When it last answered in a thread the client knows, 0 if never. */
  lastUsedTs: number;
};

/**
 * The agents of the account's rooms, who answers Home's questions: each agent that publishes its
 * server state in a joined room, except the router, the one last used first. A room is "used with"
 * an agent when the agent replied in one of its threads.
 */
export const readHomeAgents = (
  mx: MatrixClient,
  roomIds: readonly string[],
  threads: Iterable<CrossRoomThreadIndexEntry>
): HomeAgent[] => {
  const roomsByAgent = new Map<string, Set<string>>();
  const activity = new Map<string, number>();
  roomIds.forEach((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room || room.isSpaceRoom() || room.getMyMembership() !== 'join') return;
    activity.set(roomId, room.getLastActiveTimestamp());
    agentRoomState(room, MINDROOM_SERVER_EVENT).forEach((event) => {
      const agentId = event.getSender()!;
      if (ROUTER.test(getMxIdLocalPart(agentId) ?? '')) return;
      roomsByAgent.set(agentId, (roomsByAgent.get(agentId) ?? new Set()).add(roomId));
    });
  });
  // When each agent last replied in each of its rooms.
  const used = new Map<string, Map<string, number>>();
  Array.from(threads).forEach((entry) => {
    entry.threadRecord.presentation.replyParticipantIds.forEach((agentId) => {
      if (!roomsByAgent.get(agentId)?.has(entry.roomId)) return;
      const rooms = used.get(agentId) ?? new Map<string, number>();
      rooms.set(entry.roomId, Math.max(rooms.get(entry.roomId) ?? 0, entry.lastActivityTs));
      used.set(agentId, rooms);
    });
  });
  const agents = Array.from(roomsByAgent, ([userId, rooms]): HomeAgent => {
    const usedIn = used.get(userId) ?? new Map<string, number>();
    const sorted = Array.from(rooms).sort(
      (a, b) =>
        (usedIn.get(b) ?? 0) - (usedIn.get(a) ?? 0) ||
        (activity.get(b) ?? 0) - (activity.get(a) ?? 0)
    );
    const lastUsedTs = Math.max(0, ...usedIn.values());
    const directRoomId = findDirectRoom(mx, userId);
    return {
      userId,
      roomIds: sorted,
      directRoomId,
      defaultRoomId: lastUsedTs > 0 ? sorted[0] : directRoomId,
      lastUsedTs,
    };
  });
  return agents.sort((a, b) => b.lastUsedTs - a.lastUsedTs || a.userId.localeCompare(b.userId));
};

/** `readHomeAgents` for the rooms the room list shows, read again as rooms or threads change. */
export const useHomeAgents = (): HomeAgent[] => {
  const mx = useMatrixClient();
  const roomIds = useAtomValue(navigationRoomsAtom);
  const directs = useAtomValue(mDirectAtom);
  const { entries } = useAtomValue(crossRoomThreadIndexAtom);
  return useMemo(
    () => {
      void directs;
      return readHomeAgents(mx, roomIds, entries.values());
    },
    // A new direct chat is listed in `m.direct`.
    [directs, entries, mx, roomIds]
  );
};
