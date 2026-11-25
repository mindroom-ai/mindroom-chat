import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { atom, useAtomValue, useStore } from 'jotai';
import {
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type RoomState,
} from 'matrix-js-sdk';
import { MINDROOM_SERVER_EVENT } from '../../computer/agentServer';

import { createDirectRoom } from '../../matrix/createRoom';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  useStateEventCallback,
  type StateEventCallback,
} from '../../matrix/hooks/useStateEventCallback';
import { getThreadSummaryReply } from '../../matrix/client/unopenedThreadEdits';
import { addRoomIdToMDirect, getMxIdLocalPart } from '../../matrix/matrix';
import { agentRoomState } from '../../matrix/protocol/agentRoomState';
import { isMindroomAgentUserId, isMindroomOwnerUserId } from '../../matrix/protocol/agentIdentity';
import { isThreadSummaryEvent } from '../../matrix/protocol/threadSummary';
import {
  canSendMessageInRoom,
  getDirectActiveMemberCount,
  getMemberAvatarMxc,
  getMemberRawDisplayName,
} from '../../matrix/room';
import { navigationRoomsAtom } from '../../matrix/state/archivedRooms';
import { mDirectAtom, readMDirectContent } from '../../matrix/state/mDirectList';
import { StateEvent } from '../../matrix/types/room';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { revealDirectionControls } from '../../ui/directional';

export type HomeAgent = {
  userId: string;
  name: string;
  avatarMxc?: string;
  roomIds: string[];
  direct?: { roomId: string; waiting: boolean };
  defaultRoomId?: string;
  lastUsedTs: number;
};

const canSendIn = (room: Room): boolean =>
  room.getMyMembership() === 'join' && canSendMessageInRoom(room, room.myUserId);

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
    getDirectActiveMemberCount(room) <= 2 &&
    !room.getMembers().some(isThird) &&
    memberships.includes(room.getMember(agentId)?.membership)
  );
};

const listedDirectRooms = (mx: MatrixClient, agentId: string): Room[] => {
  const raw: unknown = readMDirectContent(mx)?.[agentId];
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

const HOME_AGENT_STATE_EVENTS = new Set<string>([
  MINDROOM_SERVER_EVENT,
  StateEvent.RoomTombstone,
  StateEvent.RoomPowerLevels,
  StateEvent.RoomCreate,
]);

const isNonRouterAgent = (userId: string | undefined): userId is string =>
  !!userId && isMindroomAgentUserId(userId) && !isMindroomOwnerUserId(userId);

const agentThreadIndexSignatureAtom = atom((get) => {
  const parts: string[] = [];
  for (const { roomId, threadRootId, threadRecord } of get(
    crossRoomThreadIndexAtom
  ).entries.values()) {
    const p = threadRecord.presentation;
    if (
      isNonRouterAgent(p.lastSenderId) &&
      p.latestReplyPreviewLocalization?.kind !== 'encrypted'
    ) {
      parts.push(`${roomId}\0${threadRootId}\0${p.lastSenderId}\0${p.latestReplyTs ?? 0}`);
    }
  }
  return parts.sort().join('\n');
});

const sameHomeAgents = (a: readonly HomeAgent[], b: readonly HomeAgent[]): boolean =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i];
    return (
      !!y &&
      x.userId === y.userId &&
      x.name === y.name &&
      x.avatarMxc === y.avatarMxc &&
      x.defaultRoomId === y.defaultRoomId &&
      x.lastUsedTs === y.lastUsedTs &&
      x.direct?.roomId === y.direct?.roomId &&
      x.direct?.waiting === y.direct?.waiting &&
      x.roomIds.length === y.roomIds.length &&
      x.roomIds.every((id, j) => id === y.roomIds[j])
    );
  });

const isRelevantMember = (
  userId: string | undefined,
  roomId: string | undefined,
  viewerId: string | null | undefined,
  directs: ReadonlySet<string>
): boolean =>
  isMindroomAgentUserId(userId) ||
  (!!viewerId && userId === viewerId) ||
  (!!roomId && directs.has(roomId));

const isRelevantRedactionRoom = (
  room: Room,
  directs: ReadonlySet<string>,
  agents: readonly HomeAgent[]
): boolean =>
  directs.has(room.roomId) ||
  agents.some((a) => a.roomIds.includes(room.roomId) || a.direct?.roomId === room.roomId) ||
  agentRoomState(room, MINDROOM_SERVER_EVENT).length > 0;

type HomeAgentsState = {
  store: ReturnType<typeof useStore>;
  mx: MatrixClient;
  roomIds: readonly string[];
  directs: ReadonlySet<string>;
  threadSig: string;
  agents: HomeAgent[];
};

const readAgentsFromStore = (
  store: HomeAgentsState['store'],
  mx: MatrixClient,
  roomIds: readonly string[]
): HomeAgent[] => readHomeAgents(mx, roomIds, store.get(crossRoomThreadIndexAtom).entries.values());

/** Live list of Home agents, refreshed on relevant state, membership, answer, and redaction updates. */
export const useHomeAgents = (): HomeAgent[] => {
  const store = useStore();
  const mx = useMatrixClient();
  const roomIds = useAtomValue(navigationRoomsAtom);
  const directs = useAtomValue(mDirectAtom);
  const threadSig = useAtomValue(agentThreadIndexSignatureAtom);

  const [state, setState] = useState<HomeAgentsState>(() => ({
    store,
    mx,
    roomIds,
    directs,
    threadSig,
    agents: readAgentsFromStore(store, mx, roomIds),
  }));

  let { agents } = state;
  if (
    state.store !== store ||
    state.mx !== mx ||
    state.roomIds !== roomIds ||
    state.directs !== directs ||
    state.threadSig !== threadSig
  ) {
    const next = readAgentsFromStore(store, mx, roomIds);
    agents = sameHomeAgents(state.agents, next) ? state.agents : next;
    setState({ store, mx, roomIds, directs, threadSig, agents });
  }

  const latestRef = useRef<HomeAgentsState>({ store, mx, roomIds, directs, threadSig, agents });
  useLayoutEffect(() => {
    latestRef.current = { store, mx, roomIds, directs, threadSig, agents };
  }, [store, mx, roomIds, directs, threadSig, agents]);

  const refresh = useCallback(() => {
    const cur = latestRef.current;
    const next = readAgentsFromStore(cur.store, cur.mx, cur.roomIds);
    if (sameHomeAgents(cur.agents, next)) return;
    const updated: HomeAgentsState = { ...cur, agents: next };
    latestRef.current = updated;
    setState(updated);
  }, []);

  const onStateEvent = useCallback<StateEventCallback>(
    (event, roomState) => {
      const type = event.getType();
      if (HOME_AGENT_STATE_EVENTS.has(type)) {
        refresh();
        return;
      }
      if (type !== (StateEvent.RoomMember as string)) return;
      const { mx: client, directs: directRooms } = latestRef.current;
      const roomId = roomState?.roomId ?? event.getRoomId?.();
      if (isRelevantMember(event.getStateKey(), roomId, client.getUserId?.(), directRooms)) {
        refresh();
      }
    },
    [refresh]
  );
  useStateEventCallback(mx, onStateEvent);

  useEffect(() => {
    const onMessage = (e: MatrixEvent) => {
      if (!e.isState() && isAnswer(e) && isNonRouterAgent(e.getSender())) refresh();
    };
    const onMembers = (_event?: MatrixEvent, roomState?: RoomState, member?: RoomMember) => {
      const { mx: client, directs: directRooms } = latestRef.current;
      if (
        !member ||
        isRelevantMember(member.userId, roomState?.roomId, client.getUserId?.(), directRooms)
      ) {
        refresh();
      }
    };
    const onRedaction = (_event?: MatrixEvent, room?: Room) => {
      const { directs: directRooms, agents: currentAgents } = latestRef.current;
      if (!room || isRelevantRedactionRoom(room, directRooms, currentAgents)) refresh();
    };
    mx.on(RoomEvent.Timeline, onMessage);
    mx.on(MatrixEventEvent.Decrypted, onMessage);
    mx.on(RoomStateEvent.Members, onMembers);
    mx.on(RoomEvent.Redaction, onRedaction);
    refresh();
    return () => {
      mx.removeListener(RoomEvent.Timeline, onMessage);
      mx.removeListener(MatrixEventEvent.Decrypted, onMessage);
      mx.removeListener(RoomStateEvent.Members, onMembers);
      mx.removeListener(RoomEvent.Redaction, onRedaction);
    };
  }, [mx, refresh]);

  return agents;
};
