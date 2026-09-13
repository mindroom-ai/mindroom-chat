import { useLayoutEffect, useMemo } from 'react';
import { makeRecentThreadsAtom, registerRecentThreadsAtom } from '../recent-threads/recentThreads';
import { makeRecentThreadsPanelHeightAtom } from '../recent-threads/recentThreadsPanelHeight';
import { makeRecentThreadsPanelMobileExpandedAtom } from '../recent-threads/recentThreadsPanelMobileExpanded';

// The panel-height, panel-mobile-expanded, and cross-room thread filters
// atoms are NOT registered here: nothing outside their React hooks writes to
// them, so the registry only needs to hand out the stable per-user atom and
// clear it on logout. `bumpRecentThread` (imperative write from
// `noteThreadOpened`) is the only remaining writer that resolves the active
// atom, so recentThreadsAtom still registers below.

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
}: MindroomClientStorageAtoms): (() => void) =>
  registerRecentThreadsAtom(userId, recentThreadsAtom);

export const useMindroomClientStorageAtoms = (userId: string): void => {
  const storageAtoms = useMemo(() => makeMindroomClientStorageAtoms(userId), [userId]);

  useLayoutEffect(() => registerMindroomClientStorageAtoms(storageAtoms), [storageAtoms]);
};
