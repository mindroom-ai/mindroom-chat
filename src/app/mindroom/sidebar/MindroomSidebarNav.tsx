import React, { ReactNode, createContext, useCallback, useContext, useMemo } from 'react';
import { Icon, IconButton, Icons, Text, Tooltip, TooltipProvider, config } from 'folds';
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

function HideSidebarButton({ onClick }: { onClick: () => void }) {
  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip="Hide sidebar">
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            onClick={onClick}
            aria-label="Hide sidebar"
          >
            <Icon src={Icons.ChevronLeft} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}

function ShowSidebarButton({ onClick }: { onClick: () => void }) {
  return (
    <TooltipProvider
      position="Right"
      offset={4}
      tooltip={
        <Tooltip>
          <Text>Show sidebar</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          size="300"
          variant="Surface"
          outlined
          radii="300"
          onClick={onClick}
          aria-label="Show sidebar"
          style={{
            position: 'fixed',
            top: '50%',
            left: 0,
            zIndex: config.zIndex.Z100,
            transform: 'translateY(-50%)',
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
          }}
        >
          <Icon src={Icons.ChevronRight} />
        </IconButton>
      )}
    </TooltipProvider>
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

  if (hidden) {
    return <ShowSidebarButton onClick={show} />;
  }

  return (
    <MobileFriendlyClientNav>
      <SidebarNav footer={canToggle ? <HideSidebarButton onClick={hide} /> : undefined} />
    </MobileFriendlyClientNav>
  );
}

export function MindroomPageRoot({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const { hidden } = useContext(MindroomDesktopSidebarContext);

  return <PageRoot nav={hidden ? null : nav}>{children}</PageRoot>;
}
