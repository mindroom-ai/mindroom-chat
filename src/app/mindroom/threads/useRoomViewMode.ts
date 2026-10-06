import { useAtom, useAtomValue } from 'jotai';
import { RoomMemberEvent, type MatrixClient } from 'matrix-js-sdk';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { mDirectAtom } from '../../state/mDirectList';
import { createSessionId } from '../../state/sessions';
import { hasActiveMindroomAgent } from '../matrix/agentIdentity';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import {
  DEFAULT_ROOM_VIEW_MODE,
  getAvailableRoomViewModes,
  isRoomViewModeAvailable,
  roomViewModeAtomFamily,
  type RoomViewMode,
} from './roomViewMode';

export const resolveEffectiveRoomViewMode = (
  storedViewMode: RoomViewMode,
  simpleMode: boolean,
  humanDirectRoom: boolean
): RoomViewMode => {
  if (humanDirectRoom) return 'classic';
  return isRoomViewModeAvailable(storedViewMode, simpleMode, humanDirectRoom)
    ? storedViewMode
    : DEFAULT_ROOM_VIEW_MODE;
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

/** A direct room (in `m.direct`) with no MindRoom agent joined or invited. */
const useIsHumanDirectRoom = (roomId: string): boolean => {
  const mx = useMatrixClient();
  const direct = useAtomValue(mDirectAtom).has(roomId);
  const subscribe = useCallback(
    (onChange: () => void) =>
      direct ? subscribeRoomMembership(mx, roomId, onChange) : () => undefined,
    [direct, mx, roomId]
  );

  return useSyncExternalStore(
    subscribe,
    () => direct && !hasActiveMindroomAgent(mx.getRoom(roomId)?.getMembers() ?? [])
  );
};

/** One account-scoped source for persisted and effective room view modes. */
export const useRoomViewMode = (roomId: string) => {
  const mx = useMatrixClient();
  const simpleMode = useSimpleMode();
  const humanDirectRoom = useIsHumanDirectRoom(roomId);
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()), [mx]);
  const atom = useMemo(() => roomViewModeAtomFamily(sessionId, roomId), [roomId, sessionId]);
  const [storedViewMode, setViewMode] = useAtom(atom);
  const viewMode = resolveEffectiveRoomViewMode(storedViewMode, simpleMode, humanDirectRoom);
  const availableViewModes = getAvailableRoomViewModes(simpleMode, humanDirectRoom);

  return { availableViewModes, setViewMode, storedViewMode, viewMode };
};
