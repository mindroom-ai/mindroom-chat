import { useAtom, useAtomValue } from 'jotai';
import { RoomMemberEvent } from 'matrix-js-sdk';
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
  if (isRoomViewModeAvailable(storedViewMode, simpleMode, humanDirectRoom)) return storedViewMode;
  return humanDirectRoom ? 'classic' : DEFAULT_ROOM_VIEW_MODE;
};

/** A direct room (in `m.direct`) with no MindRoom agent joined or invited. */
const useIsHumanDirectRoom = (roomId: string): boolean => {
  const mx = useMatrixClient();
  const direct = useAtomValue(mDirectAtom).has(roomId);
  // Only direct rooms follow membership, so other rooms add no client listener.
  const subscribe = useCallback(
    (onMembershipChange: () => void) => {
      if (!direct) return () => undefined;
      mx.on(RoomMemberEvent.Membership, onMembershipChange);
      return () => {
        mx.removeListener(RoomMemberEvent.Membership, onMembershipChange);
      };
    },
    [direct, mx]
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
