import { atom } from 'jotai';

/** What the "create Space" dialog opens with; `spaceId` is the Space that gets the new subspace. */
export type CreateSpaceModalState = { spaceId?: string };

/** The open "create Space" dialog, if any. */
export const createSpaceModalAtom = atom<CreateSpaceModalState | undefined>(undefined);
