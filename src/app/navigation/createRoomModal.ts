import { atom } from 'jotai';

/** What the "create room" dialog opens with: `spaceId` is the Space the new room is added to. */
export type CreateRoomModalState = { spaceId?: string };

/** The open "create room" dialog, if any. */
export const createRoomModalAtom = atom<CreateRoomModalState | undefined>(undefined);
