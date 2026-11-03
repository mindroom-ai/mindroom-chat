import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { type RoomSettingsPage, type RoomSettingsState, roomSettingsAtom } from '../roomSettings';

export const useRoomSettingsState = (): RoomSettingsState | undefined =>
  useAtomValue(roomSettingsAtom);

/** Opens the room settings dialog for a room, optionally on a given page. */
export const useOpenRoomSettings = () => {
  const setState = useSetAtom(roomSettingsAtom);
  return useCallback(
    (roomId: string, spaceId?: string, page?: RoomSettingsPage) =>
      setState({ roomId, spaceId, page }),
    [setState]
  );
};

export const useCloseRoomSettings = () => {
  const setState = useSetAtom(roomSettingsAtom);
  return useCallback(() => setState(undefined), [setState]);
};
