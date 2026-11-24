import { atom, type useStore } from 'jotai';

export type RoomTriggersDialogState = {
  roomId: string;
  triggerId?: string;
  opener?: HTMLButtonElement;
};

export const roomTriggersDialogAtom = atom<RoomTriggersDialogState | undefined>(undefined);

export const roomTriggersQueryKey = (roomId: string, apiUrl?: string) =>
  apiUrl === undefined
    ? (['room-triggers', roomId] as const)
    : (['room-triggers', roomId, apiUrl] as const);

export const openRoomTriggersDialog = (
  store: ReturnType<typeof useStore>,
  roomId: string,
  options?: { triggerId?: string; opener?: HTMLButtonElement }
): void => store.set(roomTriggersDialogAtom, { roomId, ...options });
