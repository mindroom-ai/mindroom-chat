import { useEffect, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import {
  EventType,
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { MINDROOM_SERVER_EVENT } from '../computer/agentServer';
import { getPowersLevelFromMatrixEvent } from '../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../matrix/hooks/useRoomPermissions';
import { createDirectRoom } from '../matrix/createRoom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useStateEventCallback } from '../matrix/hooks/useStateEventCallback';
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import { getThreadSummaryReply } from '../matrix/client/unopenedThreadEdits';
import { addRoomIdToMDirect, getMxIdLocalPart } from '../matrix/matrix';
import { agentRoomState } from '../matrix/protocol/agentRoomState';
import { isMindroomAgentUserId, isMindroomOwnerUserId } from '../matrix/protocol/agentIdentity';
import { isThreadSummaryEvent } from '../matrix/protocol/threadSummary';
import { getMemberAvatarMxc, getMemberRawDisplayName, getStateEvent } from '../matrix/room';
import { navigationRoomsAtom } from '../matrix/state/archivedRooms';
import { mDirectAtom } from '../matrix/state/mDirectList';
import type { MDirectContent } from '../matrix/types/accountData';
import { StateEvent } from '../matrix/types/room';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import { revealDirectionControls } from '../ui/directional';

export type HomeAgent = {
  userId: string;
  /**
   * Its display name and avatar as the first of its rooms knows them, the name's direction
   * controls written out.
   */
  name: string;
  avatarMxc?: string;
  /** The rooms a question to it can go to (`canAskIn`), the one it last answered in first. */
  roomIds: string[];
  /**
   * Its direct chat with the account, waiting while it has yet to join: of several it has joined,
   * the one it last answered in.
   */
  direct?: { roomId: string; waiting: boolean };
  /**
   * Where a question to it goes: the room it last answered in, else its direct chat; undefined
   * while that chat has yet to be started.
   */
  defaultRoomId?: string;
  /** When it last answered in one of those rooms or in its direct chat, 0 if never. */
  lastUsedTs: number;
};

/** Whether the account is in `room`, it has not been replaced, and the account may post in it. */
const canSendIn = (room: Room): boolean => {
  if (room.getMyMembership() !== 'join' || getStateEvent(room, StateEvent.RoomTombstone)) {
    return false;
  }
  const create = getStateEvent(room, StateEvent.RoomCreate);
  const levels = getPowersLevelFromMatrixEvent(getStateEvent(room, StateEvent.RoomPowerLevels));
  return getRoomPermissionsAPI(create ? getRoomCreators(create) : new Set(), levels).event(
    'm.room.message',
    room.myUserId
  );
};

/**
 * Whether a question to `agentId` can go to `room`: the account is in it and may send messages, as
 * its room's composer needs (RoomView), the room has not been replaced, and the agent is in it. An
 * agent whose membership is not loaded yet is in it while it publishes its state there.
 */
export const canAskIn = (room: Room, agentId: string): boolean => {
  if (!canSendIn(room)) return false;
  const agent = room.getMember(agentId);
  return agent
    ? agent.membership === 'join'
    : agentRoomState(room, MINDROOM_SERVER_EVENT).some((event) => event.getSender() === agentId);
};

/**
 * Whether `room` is a direct chat with `agentId`: the account may post in it, the two are alone in
 * it, and the agent is known to have joined it, or has another of `memberships` (undefined: not
 * known yet). A third member the client knows of counts before the room's counts do. The state an
 * agent publishes says nothing here: one that left a chat of two leaves its state.
 */
export const isDirectRoomWith = (
  room: Room,
  agentId: string,
  memberships: readonly (string | undefined)[] = ['join']
): boolean =>
  canSendIn(room) &&
  room.getJoinedMemberCount() + room.getInvitedMemberCount() <= 2 &&
  !room
    .getMembers()
    .some(
      (member) =>
        (member.membership === 'join' || member.membership === 'invite') &&
        member.userId !== room.myUserId &&
        member.userId !== agentId
    ) &&
  memberships.includes(room.getMember(agentId)?.membership);

/** The rooms `m.direct` lists for `agentId` that the client has. */
const listedDirectRooms = (mx: MatrixClient, agentId: string): Room[] => {
  // Account data holds whatever a client wrote: anything but a list of room IDs lists no room.
  const content = mx.getAccountData(EventType.Direct)?.getContent<MDirectContent>();
  const listed: unknown = content?.[agentId];
  return (Array.isArray(listed) ? listed : []).flatMap((roomId: unknown) => {
    const room = typeof roomId === 'string' ? mx.getRoom(roomId) : null;
    return room ? [room] : [];
  });
};

/**
 * The account's direct chats with `agentId`, in `m.direct`'s order: the rooms it lists that are
 * one (`isDirectRoomWith`) the agent has joined, and the first it is invited to.
 */
const readDirects = (mx: MatrixClient, agentId: string): { joined: Room[]; invited?: Room } => {
  const rooms = listedDirectRooms(mx, agentId);
  return {
    joined: rooms.filter((room) => isDirectRoomWith(room, agentId)),
    invited: rooms.find((room) => isDirectRoomWith(room, agentId, ['invite'])),
  };
};

/** A message that answers: no reaction, edit, redacted message or thread's title notice. */
const isAnswer = (event: MatrixEvent): boolean =>
  event.getType() === 'm.room.message' &&
  !event.isRedacted() &&
  event.getRelation()?.rel_type !== RelationType.Replace &&
  !isThreadSummaryEvent(event);

const answerKey = (roomId: string, senderId: string): string => `${roomId}\0${senderId}`;

/**
 * When each sender last answered in each of `rooms`, by `answerKey`, read in one pass: its newest
 * message the client has loaded there, the newest reply the server told of in one of the room's
 * threads (also before the thread's events are loaded, so an older reply that is loaded hides no
 * newer one; a title notice that followed it is not it, the reply kept from before is), or the
 * reply the thread index says ends a thread. Someone else's later message in a thread it answered
 * in does not count. The index's time moves with an edit of that reply, so it counts only for a
 * sender none of whose answers in the thread the client has: those count by when they were sent.
 */
const readLastAnswers = (
  rooms: Iterable<Room>,
  threads: Iterable<CrossRoomThreadIndexEntry>
): Map<string, number> => {
  const newest = new Map<string, number>();
  const note = (roomId: string, senderId: string, ts: number) => {
    const key = answerKey(roomId, senderId);
    if (ts > (newest.get(key) ?? 0)) newest.set(key, ts);
  };
  const byId = new Map<string, Room>();
  for (const room of rooms) {
    byId.set(room.roomId, room);
    const read = (events: MatrixEvent[]) =>
      events.forEach((event) => {
        const senderId = event.getSender();
        if (senderId && isAnswer(event)) note(room.roomId, senderId, event.getTs());
      });
    read(room.getLiveTimeline().getEvents());
    room.getThreads().forEach((thread) => read(thread.events));
  }
  for (const { roomId, threadRootId, threadRecord } of threads) {
    const { lastSenderId, latestReplyTs } = threadRecord.presentation;
    const room = byId.get(roomId);
    if (room) {
      const thread = room.getThread(threadRootId);
      const reply = getThreadSummaryReply(thread);
      const replySender = reply && isAnswer(reply) ? reply.getSender() : undefined;
      if (reply && replySender) note(roomId, replySender, reply.getTs());
      const known =
        replySender === lastSenderId ||
        thread?.events.some((event) => event.getSender() === lastSenderId && isAnswer(event));
      if (lastSenderId && !known) note(roomId, lastSenderId, latestReplyTs ?? 0);
    }
  }
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
      if (isMindroomOwnerUserId(agentId)) return;
      roomsByAgent.set(agentId, [...(roomsByAgent.get(agentId) ?? []), room]);
    });
  });
  const directs = new Map(
    Array.from(roomsByAgent.keys(), (agentId) => [agentId, readDirects(mx, agentId)] as const)
  );
  // An agent's answers in its direct chats count too, also in one where it publishes no state.
  const answerRooms = new Set(Array.from(roomsByAgent.values()).flat());
  directs.forEach(({ joined }) => joined.forEach((room) => answerRooms.add(room)));
  const answers = readLastAnswers(answerRooms, threads);
  const agents = Array.from(roomsByAgent, ([userId, rooms]): HomeAgent => {
    const answered = (roomId: string) => answers.get(answerKey(roomId, userId)) ?? 0;
    // Sorted in place, so rooms never answered in keep the room list's order.
    const usable = rooms
      .filter((room) => canAskIn(room, userId))
      .map((room) => room.roomId)
      .sort((a, b) => answered(b) - answered(a));
    // Of several direct chats, the one it last answered in, else the first `m.direct` lists.
    const { joined, invited } = directs.get(userId)!;
    const [chat] = [...joined].sort((a, b) => answered(b.roomId) - answered(a.roomId));
    let direct: HomeAgent['direct'];
    if (chat) direct = { roomId: chat.roomId, waiting: false };
    else if (invited) direct = { roomId: invited.roomId, waiting: true };
    let [lastRoomId] = usable;
    let lastUsedTs = lastRoomId ? answered(lastRoomId) : 0;
    if (direct && !direct.waiting && answered(direct.roomId) > lastUsedTs) {
      lastRoomId = direct.roomId;
      lastUsedTs = answered(direct.roomId);
    }
    const localpart = getMxIdLocalPart(userId) ?? userId;
    const [firstRoom] = rooms;
    return {
      userId,
      name: revealDirectionControls(
        (firstRoom ? getMemberRawDisplayName(firstRoom, userId) : undefined) ||
          localpart.replace(/^mindroom_/, '')
      ),
      avatarMxc: firstRoom ? getMemberAvatarMxc(firstRoom, userId) : undefined,
      roomIds: usable,
      direct,
      defaultRoomId: lastUsedTs > 0 ? lastRoomId : direct?.roomId,
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
 * The direct chat `m.direct` lists with `agentId`, read once the members of each listed room of
 * two whose members the client has yet to load are loaded: the agent may be in one. It fails when
 * none is found and the members of one did not load: that one may be the chat.
 */
const loadDirect = async (mx: MatrixClient, agentId: string): Promise<string | undefined> => {
  const unloaded = listedDirectRooms(mx, agentId).filter((room) =>
    isDirectRoomWith(room, agentId, [undefined])
  );
  let failed = false;
  const fail = () => {
    failed = true;
  };
  await Promise.all(unloaded.map((room) => room.loadMembersIfNeeded().catch(fail)));
  const { joined, invited } = readDirects(mx, agentId);
  const direct = (joined[0] ?? invited)?.roomId;
  if (!direct && failed) throw new Error('The members of a listed direct chat did not load.');
  return direct;
};

/**
 * Starts the account's direct chat with `agentId`, once: a second call while it starts gets the
 * same promise, and after a room was made but not listed in `m.direct`, a retry lists that room.
 * It makes no second chat beside one `m.direct` lists whose members were not loaded yet, nor
 * beside one whose members do not load: it fails then, to be tried again.
 */
export const startDirectChat = (mx: MatrixClient, agentId: string, version?: string) => {
  if (!directStarts.has(mx)) directStarts.set(mx, new Map());
  const known = directStarts.get(mx)!.get(agentId) ?? {};
  directStarts.get(mx)!.set(agentId, known);
  const { made } = known;
  known.start ??= (
    made
      ? addRoomIdToMDirect(mx, made, agentId).then(() => made)
      : loadDirect(mx, agentId).then(
          (existing) =>
            existing ??
            createDirectRoom(mx, agentId, { version, onCreated: (roomId) => (known.made = roomId) })
        )
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
 * a room's state (memberships, power levels, agents' state) change, as a room's members load,
 * and as an agent answers or a message is redacted.
 */
export const useHomeAgents = (): HomeAgent[] => {
  const mx = useMatrixClient();
  const roomIds = useAtomValue(navigationRoomsAtom);
  const directs = useAtomValue(mDirectAtom);
  const { entries } = useAtomValue(crossRoomThreadIndexAtom);
  const [stateVersion, stateChanged] = useForceUpdate();
  useStateEventCallback(mx, stateChanged);
  useEffect(() => {
    // An agent's answer moves the order, in a room's main timeline too, which the thread index
    // does not follow; an encrypted one counts once it is read. People's messages move nothing.
    const onMessage = (event: MatrixEvent) => {
      if (!event.isState() && isAnswer(event) && isMindroomAgentUserId(event.getSender())) {
        stateChanged();
      }
    };
    mx.on(RoomEvent.Timeline, onMessage);
    mx.on(MatrixEventEvent.Decrypted, onMessage);
    // Members loaded after the room are no state events, and say whether a chat is a direct
    // one; a redacted answer no longer counts.
    mx.on(RoomStateEvent.Members, stateChanged);
    mx.on(RoomEvent.Redaction, stateChanged);
    return () => {
      mx.removeListener(RoomEvent.Timeline, onMessage);
      mx.removeListener(MatrixEventEvent.Decrypted, onMessage);
      mx.removeListener(RoomStateEvent.Members, stateChanged);
      mx.removeListener(RoomEvent.Redaction, stateChanged);
    };
  }, [mx, stateChanged]);
  return useMemo(() => {
    void directs;
    void stateVersion;
    return readHomeAgents(mx, roomIds, entries.values());
  }, [directs, entries, mx, roomIds, stateVersion]);
};
