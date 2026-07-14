import { useAtom } from 'jotai';
import { useMemo } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { createSessionId } from '../../state/sessions';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import { DEFAULT_ROOM_VIEW_MODE, roomViewModeAtomFamily, type RoomViewMode } from './roomViewMode';

export const resolveEffectiveRoomViewMode = (
  storedViewMode: RoomViewMode,
  simpleMode: boolean,
  isHumanDirectMessage = false
): RoomViewMode => {
  if (isHumanDirectMessage) return 'classic';
  return simpleMode ? DEFAULT_ROOM_VIEW_MODE : storedViewMode;
};

type UseRoomViewModeOptions = {
  hasMindroomAgents?: boolean;
};

/** One account-scoped source for persisted and effective room view modes. */
export const useRoomViewMode = (
  roomId: string,
  { hasMindroomAgents = true }: UseRoomViewModeOptions = {}
) => {
  const mx = useMatrixClient();
  const direct = useIsDirectRoom();
  const simpleMode = useSimpleMode();
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()), [mx]);
  const atom = useMemo(() => roomViewModeAtomFamily(sessionId, roomId), [roomId, sessionId]);
  const [storedViewMode, setViewMode] = useAtom(atom);
  const isHumanDirectMessage = direct && !hasMindroomAgents;
  const viewMode = resolveEffectiveRoomViewMode(storedViewMode, simpleMode, isHumanDirectMessage);

  return { isHumanDirectMessage, setViewMode, storedViewMode, viewMode };
};
