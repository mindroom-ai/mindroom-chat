import { useLayoutEffect, useMemo } from 'react';
import {
  makeRecentThreadsAtom,
  registerRecentThreadsAtom,
} from '../recent-threads/recentThreads';
import {
  makeRecentThreadsPanelHeightAtom,
  registerRecentThreadsPanelHeightAtom,
} from '../recent-threads/recentThreadsPanelHeight';
import {
  makeRecentThreadsPanelMobileExpandedAtom,
  registerRecentThreadsPanelMobileExpandedAtom,
} from '../recent-threads/recentThreadsPanelMobileExpanded';
import { makeLastOpenThreadAtom, registerLastOpenThreadAtom } from '../threads/lastOpenThread';

export type MindroomClientStorageAtoms = {
  lastOpenThreadAtom: ReturnType<typeof makeLastOpenThreadAtom>;
  recentThreadsAtom: ReturnType<typeof makeRecentThreadsAtom>;
  recentThreadsPanelHeightAtom: ReturnType<typeof makeRecentThreadsPanelHeightAtom>;
  recentThreadsPanelMobileExpandedAtom: ReturnType<
    typeof makeRecentThreadsPanelMobileExpandedAtom
  >;
};

export const makeMindroomClientStorageAtoms = (userId: string): MindroomClientStorageAtoms => ({
  lastOpenThreadAtom: makeLastOpenThreadAtom(userId),
  recentThreadsAtom: makeRecentThreadsAtom(userId),
  recentThreadsPanelHeightAtom: makeRecentThreadsPanelHeightAtom(userId),
  recentThreadsPanelMobileExpandedAtom: makeRecentThreadsPanelMobileExpandedAtom(userId),
});

export const registerMindroomClientStorageAtoms = ({
  lastOpenThreadAtom,
  recentThreadsAtom,
  recentThreadsPanelHeightAtom,
  recentThreadsPanelMobileExpandedAtom,
}: MindroomClientStorageAtoms): (() => void) => {
  const unregisterLastOpenThreadAtom = registerLastOpenThreadAtom(lastOpenThreadAtom);
  const unregisterRecentThreadsAtom = registerRecentThreadsAtom(recentThreadsAtom);
  const unregisterRecentThreadsPanelHeightAtom = registerRecentThreadsPanelHeightAtom(
    recentThreadsPanelHeightAtom
  );
  const unregisterRecentThreadsPanelMobileExpandedAtom =
    registerRecentThreadsPanelMobileExpandedAtom(recentThreadsPanelMobileExpandedAtom);

  return () => {
    unregisterRecentThreadsPanelMobileExpandedAtom();
    unregisterRecentThreadsPanelHeightAtom();
    unregisterRecentThreadsAtom();
    unregisterLastOpenThreadAtom();
  };
};

export const useMindroomClientStorageAtoms = (userId: string): void => {
  const storageAtoms = useMemo(() => makeMindroomClientStorageAtoms(userId), [userId]);

  useLayoutEffect(() => registerMindroomClientStorageAtoms(storageAtoms), [storageAtoms]);
};
