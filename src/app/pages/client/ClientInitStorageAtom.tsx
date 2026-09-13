import React, { ReactNode, useLayoutEffect, useMemo } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { makeClosedNavCategoriesAtom } from '../../state/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../state/hooks/closedNavCategories';
import { makeClosedLobbyCategoriesAtom } from '../../state/closedLobbyCategories';
import { ClosedLobbyCategoriesProvider } from '../../state/hooks/closedLobbyCategories';
import { makeLastOpenThreadAtom, registerLastOpenThreadAtom } from '../../state/lastOpenThread';
import { makeNavToActivePathAtom } from '../../state/navToActivePath';
import { NavToActivePathProvider } from '../../state/hooks/navToActivePath';
import { makeOpenedSidebarFolderAtom } from '../../state/openedSidebarFolder';
import { OpenedSidebarFolderProvider } from '../../state/hooks/openedSidebarFolder';
import { makeCallPreferencesAtom } from '../../state/callPreferences';
import { CallPreferencesProvider } from '../../state/hooks/callPreferences';
import { makeRecentThreadsAtom, registerRecentThreadsAtom } from '../../state/recentThreads';
import {
  makeRecentThreadsPanelHeightAtom,
  registerRecentThreadsPanelHeightAtom,
} from '../../state/recentThreadsPanelHeight';

type ClientInitStorageAtomProps = {
  children: ReactNode;
};
export function ClientInitStorageAtom({ children }: ClientInitStorageAtomProps) {
  const mx = useMatrixClient();
  const userId = mx.getUserId()!;

  const closedNavCategoriesAtom = useMemo(() => makeClosedNavCategoriesAtom(userId), [userId]);

  const closedLobbyCategoriesAtom = useMemo(() => makeClosedLobbyCategoriesAtom(userId), [userId]);

  const navToActivePathAtom = useMemo(() => makeNavToActivePathAtom(userId), [userId]);

  const lastOpenThreadAtom = useMemo(() => makeLastOpenThreadAtom(userId), [userId]);

  const openedSidebarFolderAtom = useMemo(() => makeOpenedSidebarFolderAtom(userId), [userId]);

  const callPreferencesAtom = useMemo(() => makeCallPreferencesAtom(userId), [userId]);

  const recentThreadsAtom = useMemo(() => makeRecentThreadsAtom(userId), [userId]);

  const recentThreadsPanelHeightAtom = useMemo(
    () => makeRecentThreadsPanelHeightAtom(userId),
    [userId]
  );

  useLayoutEffect(() => {
    const unregisterLastOpenThreadAtom = registerLastOpenThreadAtom(lastOpenThreadAtom);
    const unregisterRecentThreadsAtom = registerRecentThreadsAtom(recentThreadsAtom);
    const unregisterRecentThreadsPanelHeightAtom = registerRecentThreadsPanelHeightAtom(
      recentThreadsPanelHeightAtom
    );

    return () => {
      unregisterRecentThreadsPanelHeightAtom();
      unregisterRecentThreadsAtom();
      unregisterLastOpenThreadAtom();
    };
  }, [lastOpenThreadAtom, recentThreadsAtom, recentThreadsPanelHeightAtom]);

  return (
    <ClosedNavCategoriesProvider value={closedNavCategoriesAtom}>
      <ClosedLobbyCategoriesProvider value={closedLobbyCategoriesAtom}>
        <NavToActivePathProvider value={navToActivePathAtom}>
          <OpenedSidebarFolderProvider value={openedSidebarFolderAtom}>
            <CallPreferencesProvider value={callPreferencesAtom}>
              {children}
            </CallPreferencesProvider>
          </OpenedSidebarFolderProvider>
        </NavToActivePathProvider>
      </ClosedLobbyCategoriesProvider>
    </ClosedNavCategoriesProvider>
  );
}
