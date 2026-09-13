import { useAtom } from 'jotai';
import { useMemo } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { createSessionId } from '../../state/sessions';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import {
  DEFAULT_ROOM_VIEW_MODE,
  roomViewModeAtomFamily,
  type RoomViewMode,
} from './roomViewMode';

export const resolveEffectiveRoomViewMode = (
  storedViewMode: RoomViewMode,
  simpleMode: boolean
): RoomViewMode => (simpleMode ? DEFAULT_ROOM_VIEW_MODE : storedViewMode);

/** One account-scoped source for persisted and effective room view modes. */
export const useRoomViewMode = (roomId: string) => {
  const mx = useMatrixClient();
  const simpleMode = useSimpleMode();
  const sessionId = useMemo(
    () => createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()),
    [mx]
  );
  const atom = useMemo(() => roomViewModeAtomFamily(sessionId, roomId), [roomId, sessionId]);
  const [storedViewMode, setViewMode] = useAtom(atom);
  const viewMode = resolveEffectiveRoomViewMode(storedViewMode, simpleMode);

  return { setViewMode, storedViewMode, viewMode };
};
