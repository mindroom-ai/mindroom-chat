import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { KnownMembership, RoomMemberEvent, type MatrixClient } from 'matrix-js-sdk';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AccountDataEvent, type MDirectContent } from '../matrix/types/accountData';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { createSessionId } from '../matrix/session/sessions';
import { getAccountData } from '../matrix/room';
import { hasActiveMindroomAgent, isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import { useRoomThreadMode } from '../matrix/hooks/useRoomThreadMode';
import {
  getAvailableRoomViewModes,
  getDefaultRoomViewMode,
  hasStoredRoomViewMode,
  roomViewModeAtomFamily,
  type RoomViewMode,
} from './roomViewMode';

export const resolveEffectiveRoomViewMode = (
  storedViewMode: RoomViewMode,
  humanDirectRoom: boolean
): RoomViewMode => {
  if (humanDirectRoom) return 'threaded';
  return storedViewMode;
};

// Thread lists render a card per thread, so one client listener serves every room's hooks.
type RoomMembershipWatch = {
  listeners: Map<string, Set<() => void>>;
  /** The last agent lookup per room, valid while its room, state and `m.direct` stay the same. */
  agents: Map<string, { room: unknown; state: unknown; directs: unknown; value: boolean }>;
};
const membershipWatches = new WeakMap<MatrixClient, RoomMembershipWatch>();

const getMembershipWatch = (mx: MatrixClient): RoomMembershipWatch => {
  let watch = membershipWatches.get(mx);
  if (!watch) {
    const created: RoomMembershipWatch = { listeners: new Map(), agents: new Map() };
    mx.on(RoomMemberEvent.Membership, (_event, member) => {
      created.agents.delete(member.roomId);
      created.listeners.get(member.roomId)?.forEach((listener) => listener());
    });
    membershipWatches.set(mx, created);
    watch = created;
  }
  return watch;
};

const subscribeRoomMembership = (mx: MatrixClient, roomId: string, onChange: () => void) => {
  const rooms = getMembershipWatch(mx).listeners;
  const listeners = rooms.get(roomId) ?? new Set();
  rooms.set(roomId, listeners);
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) rooms.delete(roomId);
  };
};

/**
 * Whether a MindRoom agent is in the room: joined or invited, or named as the room's partner in `m.direct`.
 * Members are lazy loaded, so an agent direct room may not have its agent loaded yet; only a loaded `leave` or `ban` ends the partner.
 */
const findMindroomAgent = (mx: MatrixClient, roomId: string): boolean => {
  const room = mx.getRoom(roomId);
  if (hasActiveMindroomAgent(room?.getMembers() ?? [])) return true;
  const directs = getAccountData(mx, AccountDataEvent.Direct)?.getContent<MDirectContent>() ?? {};
  return Object.entries(directs).some(([userId, roomIds]) => {
    if (!isMindroomAgentUserId(userId) || !Array.isArray(roomIds) || !roomIds.includes(roomId)) {
      return false;
    }
    const membership = room?.getMember(userId)?.membership;
    return membership !== KnownMembership.Leave && membership !== KnownMembership.Ban;
  });
};

/**
 * `findMindroomAgent`, scanned again only after a membership change in the room or a new room,
 * room state or `m.direct` event: every thread entry of the sidebar asks on each render.
 */
const hasMindroomAgent = (mx: MatrixClient, roomId: string): boolean => {
  const { agents } = getMembershipWatch(mx);
  const room = mx.getRoom(roomId);
  const state = room?.currentState;
  const directs = getAccountData(mx, AccountDataEvent.Direct);
  const cached = agents.get(roomId);
  if (cached && cached.room === room && cached.state === state && cached.directs === directs) {
    return cached.value;
  }
  const value = findMindroomAgent(mx, roomId);
  agents.set(roomId, { room, state, directs, value });
  return value;
};

/**
 * Whether a MindRoom agent is in the room, watched only while `watch` holds: in a direct room
 * (a direct room of people shows Threads), and while a room without a chosen view needs it for
 * its default and the caller does not know.
 */
const useRoomHasMindroomAgent = (roomId: string, watch: boolean): boolean => {
  const mx = useMatrixClient();
  const subscribe = useCallback(
    (onChange: () => void) =>
      watch ? subscribeRoomMembership(mx, roomId, onChange) : () => undefined,
    [mx, roomId, watch]
  );

  // `mDirectAtom` changes on every `m.direct` update, which re-reads the partners.
  return useSyncExternalStore(subscribe, () => watch && hasMindroomAgent(mx, roomId));
};

/**
 * Counts the reader's view choices per room, here and (through `storage` events) in other tabs, so
 * every hook of the room re-reads whether it has one: choosing the view a room already shows by
 * default leaves the stored value as it was.
 */
const roomViewChoicesAtom = atomFamily((roomId: string) => {
  const choices = atom(0);
  choices.onMount = (setChoices) => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    const handleStorage = (event: StorageEvent) => {
      const { key } = event;
      if (key !== null && !(key.startsWith('roomViewMode:') && key.endsWith(`:${roomId}`))) return;
      setChoices((count) => count + 1);
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('storage', handleStorage);
      }
    };
  };
  return choices;
});

/**
 * One account-scoped source for persisted and effective room view modes. A room without a chosen
 * view opens in its default, which follows `hasMindroomAgents` when the caller knows it, or in
 * Threads while the room's `io.mindroom.thread_mode` is `room`.
 */
export const useRoomViewMode = (roomId: string, hasMindroomAgents?: boolean) => {
  const mx = useMatrixClient();
  const direct = useAtomValue(mDirectAtom).has(roomId);
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()), [mx]);
  const viewModeAtom = useMemo(
    () => roomViewModeAtomFamily(sessionId, roomId),
    [roomId, sessionId]
  );
  const [storedViewMode, setStoredViewMode] = useAtom(viewModeAtom);
  const choices = useAtomValue(roomViewChoicesAtom(roomId));
  const countChoice = useSetAtom(roomViewChoicesAtom(roomId));
  const setViewMode = useCallback(
    (mode: RoomViewMode) => {
      setStoredViewMode(mode);
      countChoice((count) => count + 1);
    },
    [countChoice, setStoredViewMode]
  );
  // Read again only when the stored value or the room's choices change.
  const chosen = useMemo(
    () => hasStoredRoomViewMode(sessionId, roomId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [choices, roomId, sessionId, storedViewMode]
  );
  const detected = useRoomHasMindroomAgent(
    roomId,
    direct || (!chosen && hasMindroomAgents === undefined)
  );
  const humanDirectRoom = direct && !detected;
  // A room whose agents answer in the main timeline opens in Threads, where watching a reply reads it.
  const answersInRoom = useRoomThreadMode(roomId, !chosen) === 'room';
  const defaultViewMode = answersInRoom
    ? 'threaded'
    : getDefaultRoomViewMode(hasMindroomAgents ?? detected);
  const roomViewMode = chosen ? storedViewMode : defaultViewMode;
  const viewMode = resolveEffectiveRoomViewMode(roomViewMode, humanDirectRoom);
  const availableViewModes = getAvailableRoomViewModes(humanDirectRoom);

  return { availableViewModes, setViewMode, storedViewMode, viewMode };
};
