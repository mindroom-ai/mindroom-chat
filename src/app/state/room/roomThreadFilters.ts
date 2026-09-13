import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { ThreadFilter, ThreadSort } from '../../features/room/roomThreadOverviewModel';

export type ThreadFilterState = {
  threadFilter: ThreadFilter;
  threadSort: ThreadSort;
};

const createThreadFilterAtom = () =>
  atom<ThreadFilterState>({
    threadFilter: 'all',
    threadSort: 'default',
  });

export const roomIdToThreadFilterAtomFamily = atomFamily<
  string,
  ReturnType<typeof createThreadFilterAtom>
>(() => createThreadFilterAtom());
