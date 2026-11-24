import { atom, type useStore } from 'jotai';

export type RoomTriggersDialogState = {
  roomId: string;
  triggerId?: string;
  opener?: HTMLButtonElement;
};

export const ROOM_TRIGGERS_QUERY_KEY = 'room-triggers';
export const roomTriggersQueryKey = (roomId: string, apiUrl: string) =>
  [ROOM_TRIGGERS_QUERY_KEY, roomId, apiUrl] as const;

export const roomTriggersDialogAtom = atom<RoomTriggersDialogState | undefined>(undefined);

export const openRoomTriggersDialog = (
  store: ReturnType<typeof useStore>,
  roomId: string,
  options?: { triggerId?: string; opener?: HTMLButtonElement }
): void => store.set(roomTriggersDialogAtom, { roomId, ...options });
