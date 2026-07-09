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
import {
  makeCrossRoomThreadFiltersAtom,
  registerCrossRoomThreadFiltersAtom,
} from '../cross-room-threads/crossRoomThreadFilters';

export type MindroomClientStorageAtoms = {
  recentThreadsAtom: ReturnType<typeof makeRecentThreadsAtom>;
  recentThreadsPanelHeightAtom: ReturnType<typeof makeRecentThreadsPanelHeightAtom>;
  recentThreadsPanelMobileExpandedAtom: ReturnType<typeof makeRecentThreadsPanelMobileExpandedAtom>;
  crossRoomThreadFiltersAtom: ReturnType<typeof makeCrossRoomThreadFiltersAtom>;
};

export const makeMindroomClientStorageAtoms = (userId: string): MindroomClientStorageAtoms => ({
  recentThreadsAtom: makeRecentThreadsAtom(userId),
  recentThreadsPanelHeightAtom: makeRecentThreadsPanelHeightAtom(userId),
  recentThreadsPanelMobileExpandedAtom: makeRecentThreadsPanelMobileExpandedAtom(userId),
  crossRoomThreadFiltersAtom: makeCrossRoomThreadFiltersAtom(userId),
});

export const registerMindroomClientStorageAtoms = ({
  recentThreadsAtom,
  recentThreadsPanelHeightAtom,
  recentThreadsPanelMobileExpandedAtom,
  crossRoomThreadFiltersAtom,
}: MindroomClientStorageAtoms): (() => void) => {
  const unregisterRecentThreadsAtom = registerRecentThreadsAtom(recentThreadsAtom);
  const unregisterRecentThreadsPanelHeightAtom = registerRecentThreadsPanelHeightAtom(
    recentThreadsPanelHeightAtom
  );
  const unregisterRecentThreadsPanelMobileExpandedAtom =
    registerRecentThreadsPanelMobileExpandedAtom(recentThreadsPanelMobileExpandedAtom);
  const unregisterCrossRoomThreadFiltersAtom = registerCrossRoomThreadFiltersAtom(
    crossRoomThreadFiltersAtom
  );

  return () => {
    unregisterCrossRoomThreadFiltersAtom();
    unregisterRecentThreadsPanelMobileExpandedAtom();
    unregisterRecentThreadsPanelHeightAtom();
    unregisterRecentThreadsAtom();
  };
};

export const useMindroomClientStorageAtoms = (userId: string): void => {
  const storageAtoms = useMemo(() => makeMindroomClientStorageAtoms(userId), [userId]);

  useLayoutEffect(() => registerMindroomClientStorageAtoms(storageAtoms), [storageAtoms]);
};
