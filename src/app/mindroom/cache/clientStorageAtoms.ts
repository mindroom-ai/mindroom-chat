import { useLayoutEffect, useMemo } from 'react';
import { makeRecentThreadsAtom, registerRecentThreadsAtom } from '../recent-threads/recentThreads';
import {
  makeRecentThreadsPanelHeightAtom,
  registerRecentThreadsPanelHeightAtom,
} from '../recent-threads/recentThreadsPanelHeight';
import {
  makeRecentThreadsPanelMobileExpandedAtom,
  registerRecentThreadsPanelMobileExpandedAtom,
} from '../recent-threads/recentThreadsPanelMobileExpanded';

// The cross-room thread filters atom is NOT registered here: its registry has
// no imperative writers (nothing resolves an "active" atom for it), so
// consumers create it directly via `makeCrossRoomThreadFiltersAtom` and
// session cleanup clears the registry without needing a registration.

export type MindroomClientStorageAtoms = {
  userId: string;
  recentThreadsAtom: ReturnType<typeof makeRecentThreadsAtom>;
  recentThreadsPanelHeightAtom: ReturnType<typeof makeRecentThreadsPanelHeightAtom>;
  recentThreadsPanelMobileExpandedAtom: ReturnType<typeof makeRecentThreadsPanelMobileExpandedAtom>;
};

export const makeMindroomClientStorageAtoms = (userId: string): MindroomClientStorageAtoms => ({
  userId,
  recentThreadsAtom: makeRecentThreadsAtom(userId),
  recentThreadsPanelHeightAtom: makeRecentThreadsPanelHeightAtom(userId),
  recentThreadsPanelMobileExpandedAtom: makeRecentThreadsPanelMobileExpandedAtom(userId),
});

export const registerMindroomClientStorageAtoms = ({
  userId,
  recentThreadsAtom,
  recentThreadsPanelHeightAtom,
  recentThreadsPanelMobileExpandedAtom,
}: MindroomClientStorageAtoms): (() => void) => {
  const unregisterRecentThreadsAtom = registerRecentThreadsAtom(userId, recentThreadsAtom);
  const unregisterRecentThreadsPanelHeightAtom = registerRecentThreadsPanelHeightAtom(
    userId,
    recentThreadsPanelHeightAtom
  );
  const unregisterRecentThreadsPanelMobileExpandedAtom =
    registerRecentThreadsPanelMobileExpandedAtom(userId, recentThreadsPanelMobileExpandedAtom);

  return () => {
    unregisterRecentThreadsPanelMobileExpandedAtom();
    unregisterRecentThreadsPanelHeightAtom();
    unregisterRecentThreadsAtom();
  };
};

export const useMindroomClientStorageAtoms = (userId: string): void => {
  const storageAtoms = useMemo(() => makeMindroomClientStorageAtoms(userId), [userId]);

  useLayoutEffect(() => registerMindroomClientStorageAtoms(storageAtoms), [storageAtoms]);
};
