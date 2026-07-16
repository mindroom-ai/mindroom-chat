import React, { useCallback, useMemo } from 'react';
import { Icon, IconButton, Icons, Text, Tooltip, TooltipProvider, config } from 'folds';
import { useAtom } from 'jotai';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../components/sidebar';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useActiveSession } from '../../hooks/useSessionStore';
import { MobileFriendlyClientNav } from '../../pages/MobileFriendly';
import { SidebarNav } from '../../pages/client/SidebarNav';
import { makeDesktopSidebarHiddenAtom } from './desktopSidebarState';

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

function PersistedMindroomSidebarNav({ userId }: { userId: string }) {
  const screenSize = useScreenSizeContext();
  const hiddenAtom = useMemo(() => makeDesktopSidebarHiddenAtom(userId), [userId]);
  const [hidden, setHidden] = useAtom(hiddenAtom);
  const desktop = screenSize === ScreenSize.Desktop;

  const hideSidebar = useCallback(() => setHidden(true), [setHidden]);
  const showSidebar = useCallback(() => setHidden(false), [setHidden]);

  if (desktop && hidden) {
    return <ShowSidebarButton onClick={showSidebar} />;
  }

  return (
    <MobileFriendlyClientNav>
      <SidebarNav footer={desktop ? <HideSidebarButton onClick={hideSidebar} /> : undefined} />
    </MobileFriendlyClientNav>
  );
}

export function MindroomSidebarNav() {
  const activeSession = useActiveSession();

  if (!activeSession) {
    return (
      <MobileFriendlyClientNav>
        <SidebarNav />
      </MobileFriendlyClientNav>
    );
  }

  return <PersistedMindroomSidebarNav userId={activeSession.userId} />;
}
