import { atom, type useStore } from 'jotai';

export type RoomTriggersDialogState = {
  roomId: string;
  triggerId?: string;
  opener?: HTMLButtonElement;
};

export const roomTriggersDialogAtom = atom<RoomTriggersDialogState | undefined>(undefined);

export const openRoomTriggersDialog = (
  store: ReturnType<typeof useStore>,
  roomId: string,
  options?: { triggerId?: string; opener?: HTMLButtonElement }
): void => store.set(roomTriggersDialogAtom, { roomId, ...options });

export const closeRoomTriggersDialog = (
  store: ReturnType<typeof useStore>,
  roomId: string
): void => {
  if (store.get(roomTriggersDialogAtom)?.roomId === roomId) {
    store.set(roomTriggersDialogAtom, undefined);
  }
};
