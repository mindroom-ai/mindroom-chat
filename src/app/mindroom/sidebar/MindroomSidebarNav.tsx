import React, { ReactNode, createContext, useCallback, useContext, useMemo } from 'react';
import { Icon, Icons } from 'folds';
import { useAtom } from 'jotai';
import { PageRoot } from '../../components/page';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../components/sidebar';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useActiveSession } from '../../hooks/useSessionStore';
import { MobileFriendlyClientNav } from '../../pages/MobileFriendly';
import { SidebarNav } from '../../pages/client/SidebarNav';
import { makeDesktopSidebarHiddenAtom } from './desktopSidebarState';

type MindroomDesktopSidebarState = {
  canToggle: boolean;
  hidden: boolean;
  hide: () => void;
  show: () => void;
};

const defaultDesktopSidebarState: MindroomDesktopSidebarState = {
  canToggle: false,
  hidden: false,
  hide: () => undefined,
  show: () => undefined,
};

const MindroomDesktopSidebarContext = createContext(defaultDesktopSidebarState);

function SidebarToggleButton({ hidden, onClick }: { hidden: boolean; onClick: () => void }) {
  const label = hidden ? 'Show sidebar' : 'Hide sidebar';

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={label}>
        {(triggerRef) => (
          <SidebarAvatar as="button" ref={triggerRef} outlined onClick={onClick} aria-label={label}>
            <Icon src={hidden ? Icons.ChevronRight : Icons.ChevronLeft} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}

function PersistedMindroomSidebarProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const screenSize = useScreenSizeContext();
  const hiddenAtom = useMemo(() => makeDesktopSidebarHiddenAtom(userId), [userId]);
  const [hidden, setHidden] = useAtom(hiddenAtom);
  const desktop = screenSize === ScreenSize.Desktop;

  const hideSidebar = useCallback(() => setHidden(true), [setHidden]);
  const showSidebar = useCallback(() => setHidden(false), [setHidden]);
  const value = useMemo(
    () => ({
      canToggle: desktop,
      hidden: desktop && hidden,
      hide: hideSidebar,
      show: showSidebar,
    }),
    [desktop, hidden, hideSidebar, showSidebar]
  );

  return (
    <MindroomDesktopSidebarContext.Provider value={value}>
      {children}
    </MindroomDesktopSidebarContext.Provider>
  );
}

export function MindroomSidebarProvider({ children }: { children: ReactNode }) {
  const activeSession = useActiveSession();

  if (!activeSession) {
    return (
      <MindroomDesktopSidebarContext.Provider value={defaultDesktopSidebarState}>
        {children}
      </MindroomDesktopSidebarContext.Provider>
    );
  }

  return (
    <PersistedMindroomSidebarProvider userId={activeSession.userId}>
      {children}
    </PersistedMindroomSidebarProvider>
  );
}

export function MindroomSidebarNav() {
  const { canToggle, hidden, hide, show } = useContext(MindroomDesktopSidebarContext);

  return (
    <MobileFriendlyClientNav>
      <SidebarNav
        footer={
          canToggle ? (
            <SidebarToggleButton hidden={hidden} onClick={hidden ? show : hide} />
          ) : undefined
        }
      />
    </MobileFriendlyClientNav>
  );
}

export function MindroomPageRoot({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const { hidden } = useContext(MindroomDesktopSidebarContext);

  return <PageRoot nav={hidden ? null : nav}>{children}</PageRoot>;
}
