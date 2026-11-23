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
  name: string;
  avatarMxc?: string;
  roomIds: string[];
  direct?: { roomId: string; waiting: boolean };
  defaultRoomId?: string;
  lastUsedTs: number;
};

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

/** Whether the account can send a question to `agentId` in `room`. */
export const canAskIn = (room: Room, agentId: string): boolean => {
  if (!canSendIn(room)) return false;
  const agent = room.getMember(agentId);
  return agent
    ? agent.membership === 'join'
    : agentRoomState(room, MINDROOM_SERVER_EVENT).some((e) => e.getSender() === agentId);
};

/** Whether `room` is a writable 1:1 direct chat with `agentId` matching one of `memberships`. */
export const isDirectRoomWith = (
  room: Room,
  agentId: string,
  memberships: readonly (string | undefined)[] = ['join']
): boolean => {
  const isThird = (m: { userId: string; membership?: string }) =>
    (m.membership === 'join' || m.membership === 'invite') &&
    m.userId !== room.myUserId &&
    m.userId !== agentId;
  return (
    canSendIn(room) &&
    room.getJoinedMemberCount() + room.getInvitedMemberCount() <= 2 &&
    !room.getMembers().some(isThird) &&
    memberships.includes(room.getMember(agentId)?.membership)
  );
};

const listedDirectRooms = (mx: MatrixClient, agentId: string): Room[] => {
  const raw: unknown = mx.getAccountData(EventType.Direct)?.getContent<MDirectContent>()?.[agentId];
  return Array.isArray(raw)
    ? raw
        .map((id) => (typeof id === 'string' ? mx.getRoom(id) : null))
        .filter((r): r is Room => !!r)
    : [];
};

const isAnswer = (e: MatrixEvent): boolean =>
  e.getType() === 'm.room.message' &&
  !e.isRedacted() &&
  !e.isDecryptionFailure() &&
  e.getRelation()?.rel_type !== RelationType.Replace &&
  !isThreadSummaryEvent(e);

const answerKey = (roomId: string, senderId: string): string => `${roomId}\0${senderId}`;

const readLastAnswers = (rooms: Iterable<Room>, threads: Iterable<CrossRoomThreadIndexEntry>) => {
  const newest = new Map<string, number>();
  const note = (roomId: string, senderId: string, ts: number) => {
    const key = answerKey(roomId, senderId);
    if (ts > (newest.get(key) ?? 0)) newest.set(key, ts);
  };
  const roomIds = new Set<string>();
  const inThread = new Set<string>();
  for (const room of rooms) {
    roomIds.add(room.roomId);
    const read = (events: MatrixEvent[], threadId?: string) =>
      events.forEach((event) => {
        const sender = event.getSender();
        if (!sender || !isAnswer(event)) return;
        note(room.roomId, sender, event.getTs());
        if (threadId) inThread.add(answerKey(threadId, sender));
      });
    read(room.getLiveTimeline().getEvents());
    room.getThreads().forEach((t) => {
      const reply = getThreadSummaryReply(t);
      read(reply ? [...t.events, reply] : t.events, t.id);
    });
  }
  for (const { roomId, threadRootId, threadRecord } of threads) {
    const p = threadRecord.presentation;
    if (
      roomIds.has(roomId) &&
      p.lastSenderId &&
      !inThread.has(answerKey(threadRootId, p.lastSenderId)) &&
      p.latestReplyPreviewLocalization?.kind !== 'encrypted'
    ) {
      note(roomId, p.lastSenderId, p.latestReplyTs ?? 0);
    }
  }
  return newest;
};

const readDirect = (mx: MatrixClient, agentId: string, answers: Map<string, number>) => {
  const rooms = listedDirectRooms(mx, agentId);
  const ts = (r: Room) => answers.get(answerKey(r.roomId, agentId)) ?? 0;
  const [joined] = rooms.filter((r) => isDirectRoomWith(r, agentId)).sort((a, b) => ts(b) - ts(a));
  if (joined) return { roomId: joined.roomId, waiting: false };
  const invited = rooms.find((r) => isDirectRoomWith(r, agentId, ['invite']));
  return invited ? { roomId: invited.roomId, waiting: true } : undefined;
};

/** Agent display name from `room`, falling back to localpart without `mindroom_`. */
export const agentNameIn = (room: Room | undefined, userId: string): string =>
  revealDirectionControls(
    (room ? getMemberRawDisplayName(room, userId) : undefined) ||
      (getMxIdLocalPart(userId) ?? userId).replace(/^mindroom_/, '')
  );

/** Agents publishing server state in joined rooms (excluding router), ranked by last answer. */
export const readHomeAgents = (
  mx: MatrixClient,
  roomIds: readonly string[],
  threads: Iterable<CrossRoomThreadIndexEntry>
): HomeAgent[] => {
  const roomsByAgent = new Map<string, Room[]>();
  const answerRooms = new Set<Room>();
  roomIds.forEach((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room || room.isSpaceRoom() || room.getMyMembership() !== 'join') return;
    agentRoomState(room, MINDROOM_SERVER_EVENT).forEach((event) => {
      const id = event.getSender()!;
      if (isMindroomOwnerUserId(id)) return;
      roomsByAgent.set(id, [...(roomsByAgent.get(id) ?? []), room]);
      answerRooms.add(room);
    });
  });
  roomsByAgent.forEach((_, id) =>
    listedDirectRooms(mx, id).forEach((r) => isDirectRoomWith(r, id) && answerRooms.add(r))
  );
  const answers = readLastAnswers(answerRooms, threads);
  return Array.from(roomsByAgent, ([userId, rooms]): HomeAgent => {
    const ts = (id: string) => answers.get(answerKey(id, userId)) ?? 0;
    const usable = rooms
      .filter((r) => canAskIn(r, userId))
      .map((r) => r.roomId)
      .sort((a, b) => ts(b) - ts(a));
    const direct = readDirect(mx, userId, answers);
    const roomTs = usable[0] ? ts(usable[0]) : 0;
    const directTs = direct && !direct.waiting ? ts(direct.roomId) : 0;
    const lastUsedTs = Math.max(roomTs, directTs);
    return {
      userId,
      name: agentNameIn(
        rooms.find((r) => getMemberRawDisplayName(r, userId)),
        userId
      ),
      avatarMxc: rooms.map((r) => getMemberAvatarMxc(r, userId)).find(Boolean),
      roomIds: usable,
      direct,
      defaultRoomId: directTs > roomTs ? direct?.roomId : roomTs > 0 ? usable[0] : direct?.roomId,
      lastUsedTs,
    };
  }).sort((a, b) => b.lastUsedTs - a.lastUsedTs || a.userId.localeCompare(b.userId));
};

type DirectStart = { start?: Promise<string>; made?: string };
const directStarts = new WeakMap<MatrixClient, Map<string, DirectStart>>();

/** Starts or reuses a 1:1 direct chat with `agentId`, deduping concurrent calls and retries. */
export const startDirectChat = (mx: MatrixClient, agentId: string, version?: string) => {
  const byAgent = directStarts.get(mx) ?? new Map<string, DirectStart>();
  directStarts.set(mx, byAgent);
  const known = byAgent.get(agentId) ?? {};
  byAgent.set(agentId, known);
  known.start ??= (async () => {
    try {
      let roomId = known.made;
      if (roomId) {
        await addRoomIdToMDirect(mx, roomId, agentId);
      } else {
        let failed = false;
        const unloaded = listedDirectRooms(mx, agentId).filter((r) =>
          isDirectRoomWith(r, agentId, [undefined])
        );
        await Promise.all(
          unloaded.map((r) => r.loadMembersIfNeeded().catch(() => (failed = true)))
        );
        const joined = listedDirectRooms(mx, agentId).filter((r) => isDirectRoomWith(r, agentId));
        const existing = readDirect(mx, agentId, readLastAnswers(joined, []))?.roomId;
        if (!existing && failed)
          throw new Error('The members of a listed direct chat did not load.');
        roomId =
          existing ??
          (await createDirectRoom(mx, agentId, { version, onCreated: (id) => (known.made = id) }));
      }
      known.made = undefined;
      return roomId;
    } finally {
      known.start = undefined;
      if (!known.made) byAgent.delete(agentId);
    }
  })();
  return known.start;
};

/** Live list of Home agents, refreshed on state, membership, answer, and redaction updates. */
export const useHomeAgents = (): HomeAgent[] => {
  const mx = useMatrixClient();
  const roomIds = useAtomValue(navigationRoomsAtom);
  const directs = useAtomValue(mDirectAtom);
  const { entries } = useAtomValue(crossRoomThreadIndexAtom);
  const [stateVersion, stateChanged] = useForceUpdate();
  useStateEventCallback(mx, stateChanged);
  useEffect(() => {
    const onMessage = (e: MatrixEvent) => {
      if (!e.isState() && isAnswer(e) && isMindroomAgentUserId(e.getSender())) stateChanged();
    };
    mx.on(RoomEvent.Timeline, onMessage);
    mx.on(MatrixEventEvent.Decrypted, onMessage);
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
    void [directs, stateVersion];
    return readHomeAgents(mx, roomIds, entries.values());
  }, [directs, entries, mx, roomIds, stateVersion]);
};
