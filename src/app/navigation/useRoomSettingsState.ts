import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  type RoomSettingsPage,
  type RoomSettingsState,
  roomSettingsAtom,
} from './roomSettingsState';

export const useRoomSettingsState = (): RoomSettingsState | undefined =>
  useAtomValue(roomSettingsAtom);

/** Opens the settings dialog of a room or space, optionally on a given page. */
export const useOpenRoomSettings = () => {
  const setState = useSetAtom(roomSettingsAtom);
  return useCallback(
    (roomId: string, page?: RoomSettingsPage) =>
      setState((open) => ({ roomId, page, request: (open?.request ?? 0) + 1 })),
    [setState]
  );
};

export const useCloseRoomSettings = () => {
  const setState = useSetAtom(roomSettingsAtom);
  return useCallback(() => setState(undefined), [setState]);
};
