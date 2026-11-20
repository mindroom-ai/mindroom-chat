import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { EventType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { MINDROOM_SERVER_EVENT } from '../computer/agentServer';
import { getPowersLevelFromMatrixEvent } from '../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../matrix/hooks/useRoomPermissions';
import { createDirectRoom } from '../matrix/createRoom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useStateEventCallback } from '../matrix/hooks/useStateEventCallback';
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import { addRoomIdToMDirect, getMxIdLocalPart } from '../matrix/matrix';
import { agentRoomState } from '../matrix/protocol/agentRoomState';
import { getMemberAvatarMxc, getMemberRawDisplayName, getStateEvent } from '../matrix/room';
import { navigationRoomsAtom } from '../matrix/state/archivedRooms';
import { mDirectAtom } from '../matrix/state/mDirectList';
import type { MDirectContent } from '../matrix/types/accountData';
import { StateEvent } from '../matrix/types/room';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';

/** MindRoom's router, which routes messages and answers no question itself. */
const ROUTER = /^mindroom_router(?:_[a-z0-9]{4,32})?$/;

export type HomeAgent = {
  userId: string;
  /** Its display name and avatar as the first of its rooms knows them. */
  name: string;
  avatarMxc?: string;
  /** The rooms a question to it can go to (`canAskIn`), the one it last answered in first. */
  roomIds: string[];
  /** Its direct chat with the account, waiting while it has yet to join. */
  direct?: { roomId: string; waiting: boolean };
  /**
   * Where a question to it goes: the room it last answered in, else its direct chat; undefined
   * while that chat has yet to be started.
   */
  defaultRoomId?: string;
  /** When it last answered in a room the client knows, 0 if never. */
  lastUsedTs: number;
};

/**
 * Whether a question to `agentId` can go to `room`: the account is in it and may send messages, as
 * its room's composer needs (RoomView), the room has not been replaced, and the agent is in it. An
 * agent whose membership is not loaded yet is in it while it publishes its state there.
 */
export const canAskIn = (room: Room, agentId: string): boolean => {
  if (room.getMyMembership() !== 'join' || getStateEvent(room, StateEvent.RoomTombstone)) {
    return false;
  }
  const agent = room.getMember(agentId);
  const joined = agent
    ? agent.membership === 'join'
    : agentRoomState(room, MINDROOM_SERVER_EVENT).some((event) => event.getSender() === agentId);
  const create = getStateEvent(room, StateEvent.RoomCreate);
  const levels = getPowersLevelFromMatrixEvent(getStateEvent(room, StateEvent.RoomPowerLevels));
  return (
    joined &&
    getRoomPermissionsAPI(create ? getRoomCreators(create) : new Set(), levels).event(
      'm.room.message',
      room.myUserId
    )
  );
};

/** The account's direct chat with `agentId`: a joined room `m.direct` lists, of the two alone. */
const readDirect = (mx: MatrixClient, agentId: string): HomeAgent['direct'] => {
  const listed = mx.getAccountData(EventType.Direct)?.getContent<MDirectContent>()[agentId] ?? [];
  const room = listed
    .map((roomId) => mx.getRoom(roomId))
    .find(
      (candidate) =>
        candidate?.getMyMembership() === 'join' &&
        candidate.getJoinedMemberCount() + candidate.getInvitedMemberCount() <= 2 &&
        ['join', 'invite'].includes(candidate.getMember(agentId)?.membership ?? '')
    );
  return room ? { roomId: room.roomId, waiting: !canAskIn(room, agentId) } : undefined;
};

/**
 * When `agentId` last answered in `room`: its newest message the client has loaded there, or the
 * reply the thread index says ends one of the room's threads. Someone else's later message in a
 * thread it answered in does not count.
 */
const lastAnswerTs = (room: Room, agentId: string, threads: CrossRoomThreadIndexEntry[]) => {
  let newest = 0;
  const read = (events: MatrixEvent[]) =>
    events.forEach((event) => {
      if (event.getSender() === agentId && !event.isState()) {
        newest = Math.max(newest, event.getTs());
      }
    });
  read(room.getLiveTimeline().getEvents());
  room.getThreads().forEach((thread) => read(thread.events));
  threads.forEach(({ roomId, threadRecord: { presentation } }) => {
    if (roomId === room.roomId && presentation.lastSenderId === agentId) {
      newest = Math.max(newest, presentation.latestReplyTs ?? 0);
    }
  });
  return newest;
};

/**
 * The agents of the account's rooms, who answer Home's questions: each agent that publishes its
 * server state in a joined room, except the router, the one that answered last first.
 */
export const readHomeAgents = (
  mx: MatrixClient,
  roomIds: readonly string[],
  threads: Iterable<CrossRoomThreadIndexEntry>
): HomeAgent[] => {
  const roomsByAgent = new Map<string, Room[]>();
  roomIds.forEach((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room || room.isSpaceRoom() || room.getMyMembership() !== 'join') return;
    agentRoomState(room, MINDROOM_SERVER_EVENT).forEach((event) => {
      const agentId = event.getSender()!;
      if (ROUTER.test(getMxIdLocalPart(agentId) ?? '')) return;
      roomsByAgent.set(agentId, [...(roomsByAgent.get(agentId) ?? []), room]);
    });
  });
  const entries = Array.from(threads);
  const agents = Array.from(roomsByAgent, ([userId, rooms]): HomeAgent => {
    const answered = new Map(
      rooms.map((room) => [room.roomId, lastAnswerTs(room, userId, entries)] as const)
    );
    // Sorted in place, so rooms never answered in keep the room list's order.
    const usable = rooms
      .filter((room) => canAskIn(room, userId))
      .map((room) => room.roomId)
      .sort((a, b) => answered.get(b)! - answered.get(a)!);
    const lastUsedTs = answered.get(usable[0]) ?? 0;
    const direct = readDirect(mx, userId);
    const localpart = getMxIdLocalPart(userId) ?? userId;
    return {
      userId,
      name: getMemberRawDisplayName(rooms[0], userId) || localpart.replace(/^mindroom_/, ''),
      avatarMxc: getMemberAvatarMxc(rooms[0], userId),
      roomIds: usable,
      direct,
      defaultRoomId: lastUsedTs > 0 ? usable[0] : direct?.roomId,
      lastUsedTs,
    };
  });
  return agents.sort((a, b) => b.lastUsedTs - a.lastUsedTs || a.userId.localeCompare(b.userId));
};

// Direct chats being started, and those made whose `m.direct` entry failed, by client and agent.
const directStarts = new WeakMap<
  MatrixClient,
  Map<string, { start?: Promise<string>; made?: string }>
>();

/**
 * Starts the account's direct chat with `agentId`, once: a second call while it starts gets the
 * same promise, and after a room was made but not listed in `m.direct`, a retry lists that room.
 */
export const startDirectChat = (mx: MatrixClient, agentId: string, version?: string) => {
  if (!directStarts.has(mx)) directStarts.set(mx, new Map());
  const known = directStarts.get(mx)!.get(agentId) ?? {};
  directStarts.get(mx)!.set(agentId, known);
  const { made } = known;
  known.start ??= (
    made
      ? addRoomIdToMDirect(mx, made, agentId).then(() => made)
      : createDirectRoom(mx, agentId, { version, onCreated: (roomId) => (known.made = roomId) })
  )
    .then((roomId) => {
      known.made = undefined;
      return roomId;
    })
    .finally(() => {
      known.start = undefined;
    });
  return known.start;
};

/**
 * `readHomeAgents` for the rooms the room list shows, read again as rooms, threads, `m.direct` or
 * a room's state (memberships, power levels, agents' state) change.
 */
export const useHomeAgents = (): HomeAgent[] => {
  const mx = useMatrixClient();
  const roomIds = useAtomValue(navigationRoomsAtom);
  const directs = useAtomValue(mDirectAtom);
  const { entries } = useAtomValue(crossRoomThreadIndexAtom);
  const [stateVersion, stateChanged] = useForceUpdate();
  useStateEventCallback(mx, stateChanged);
  return useMemo(() => {
    void directs;
    void stateVersion;
    return readHomeAgents(mx, roomIds, entries.values());
  }, [directs, entries, mx, roomIds, stateVersion]);
};
