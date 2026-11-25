import { atom } from 'jotai';

type RoomTriggersDialogState = {
  roomId: string;
  triggerId?: string;
  opener?: HTMLButtonElement;
};

export const roomTriggersDialogAtom = atom<RoomTriggersDialogState | undefined>(undefined);
