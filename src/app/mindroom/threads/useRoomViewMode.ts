import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { KnownMembership, RoomMemberEvent, type MatrixClient } from 'matrix-js-sdk';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AccountDataEvent, type MDirectContent } from '../../../types/matrix/accountData';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { mDirectAtom } from '../../state/mDirectList';
import { createSessionId } from '../../state/sessions';
import { getAccountData } from '../../utils/room';
import { hasActiveMindroomAgent, isMindroomAgentUserId } from '../matrix/agentIdentity';
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
  if (humanDirectRoom) return 'classic';
  return storedViewMode;
};

// Thread lists render a card per thread, so one client listener serves every direct room's hooks.
const membershipListeners = new WeakMap<MatrixClient, Map<string, Set<() => void>>>();

const subscribeRoomMembership = (mx: MatrixClient, roomId: string, onChange: () => void) => {
  let rooms = membershipListeners.get(mx);
  if (!rooms) {
    const created = new Map<string, Set<() => void>>();
    mx.on(RoomMemberEvent.Membership, (_event, member) => {
      created.get(member.roomId)?.forEach((listener) => listener());
    });
    membershipListeners.set(mx, created);
    rooms = created;
  }
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
const hasMindroomAgent = (mx: MatrixClient, roomId: string): boolean => {
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
 * Whether a MindRoom agent is in the room, watched only while `watch` holds: in a direct room
 * (a direct room of people shows Classic), and while a room without a chosen view needs it for
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
 * Counts the reader's view choices, so every hook re-reads whether its room has one: choosing the
 * view a room already shows by default leaves the stored value as it was.
 */
const roomViewChoicesAtom = atom(0);

/**
 * One account-scoped source for persisted and effective room view modes. A room without a chosen
 * view opens in its default, which follows `hasMindroomAgents` when the caller knows it.
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
  useAtomValue(roomViewChoicesAtom);
  const countChoice = useSetAtom(roomViewChoicesAtom);
  const setViewMode = useCallback(
    (mode: RoomViewMode) => {
      setStoredViewMode(mode);
      countChoice((count) => count + 1);
    },
    [countChoice, setStoredViewMode]
  );
  const chosen = hasStoredRoomViewMode(sessionId, roomId);
  const detected = useRoomHasMindroomAgent(
    roomId,
    direct || (!chosen && hasMindroomAgents === undefined)
  );
  const humanDirectRoom = direct && !detected;
  const roomViewMode = chosen
    ? storedViewMode
    : getDefaultRoomViewMode(hasMindroomAgents ?? detected);
  const viewMode = resolveEffectiveRoomViewMode(roomViewMode, humanDirectRoom);
  const availableViewModes = getAvailableRoomViewModes(humanDirectRoom);

  return { availableViewModes, setViewMode, storedViewMode, viewMode };
};
