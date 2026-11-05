import { useCallback } from 'react';
import { useAtomCallback } from 'jotai/utils';
import { useNavigate } from 'react-router-dom';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { stepRoom, stepUnreadRoom } from '../shortcuts/roomSteps';
import { useShortcut } from '../shortcuts/useShortcut';

/**
 * Alt with the up or down arrow opens the room above or below the open one in the section's
 * list, and with Shift too the nearest unread room that way.
 */
export const useRoomListShortcuts = (
  roomIds: readonly string[],
  selectedRoomId: string | undefined,
  pathOf: (roomId: string) => string
): void => {
  const navigate = useNavigate();
  // Read when a key asks, so the list does not render again for every unread change.
  const readUnread = useAtomCallback(useCallback((get) => get(roomToUnreadAtom), []));
  const open = (roomId: string | undefined): boolean => {
    if (roomId === undefined) return false;
    navigate(pathOf(roomId));
    return true;
  };
  const isUnread = (roomId: string) => readUnread().has(roomId);

  useShortcut('previousRoom', () => open(stepRoom(roomIds, selectedRoomId, -1)));
  useShortcut('nextRoom', () => open(stepRoom(roomIds, selectedRoomId, 1)));
  useShortcut('previousUnread', () => open(stepUnreadRoom(roomIds, selectedRoomId, -1, isUnread)));
  useShortcut('nextUnread', () => open(stepUnreadRoom(roomIds, selectedRoomId, 1, isUnread)));
};
