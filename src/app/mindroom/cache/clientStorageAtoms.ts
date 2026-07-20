import { useLayoutEffect, useMemo } from 'react';
import { makeRecentThreadsAtom, registerRecentThreadsAtom } from '../recent-threads/recentThreads';
import { makeRecentThreadsPanelHeightAtom } from '../recent-threads/recentThreadsPanelHeight';
import { makeRecentThreadsPanelMobileExpandedAtom } from '../recent-threads/recentThreadsPanelMobileExpanded';

// Panel layout atoms need stable per-user instances but no active registration
// because only their React consumers write them. `bumpRecentThread` is an
// imperative writer, so recentThreadsAtom still registers below.

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
