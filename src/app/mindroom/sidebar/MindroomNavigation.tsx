import React, { ReactNode, createContext, useContext, useMemo } from 'react';
import { Icon, Icons } from 'folds';
import { useAtom } from 'jotai';
import { PageRoot } from '../../components/page';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../components/sidebar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { MobileFriendlyClientNav } from '../../pages/MobileFriendly';
import { SidebarNav } from '../../pages/client/SidebarNav';
import { makeDesktopPageNavCollapsedAtom } from './desktopPageNavState';
import { useNavToActivePathMapper } from '../../hooks/useNavToActivePathMapper';
import { useSelectedSpace } from '../../hooks/router/useSelectedSpace';

type MindroomDesktopPageNavState = {
  canCollapse: boolean;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

const MindroomDesktopPageNavContext = createContext<MindroomDesktopPageNavState | undefined>(
  undefined
);

function useMindroomDesktopPageNav(): MindroomDesktopPageNavState {
  const value = useContext(MindroomDesktopPageNavContext);
  if (!value) throw new Error('Mindroom desktop page navigation provider is missing.');
  return value;
}

function PageNavToggleButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const label = collapsed ? 'Expand navigation panel' : 'Collapse navigation panel';

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={label}>
        {(triggerRef) => (
          <SidebarAvatar as="button" ref={triggerRef} outlined onClick={onClick} aria-label={label}>
            <Icon src={collapsed ? Icons.ChevronRight : Icons.ChevronLeft} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}

function PersistedMindroomPageNavProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const screenSize = useScreenSizeContext();
  const collapsedAtom = useMemo(() => makeDesktopPageNavCollapsedAtom(userId), [userId]);
  const [storedCollapsed, setCollapsed] = useAtom(collapsedAtom);
  const canCollapse = screenSize !== ScreenSize.Mobile;
  const value = useMemo(
    () => ({
      canCollapse,
      collapsed: canCollapse && storedCollapsed,
      setCollapsed,
    }),
    [canCollapse, storedCollapsed, setCollapsed]
  );

  return (
    <MindroomDesktopPageNavContext.Provider value={value}>
      {children}
    </MindroomDesktopPageNavContext.Provider>
  );
}

export function MindroomNavigationProvider({ children }: { children: ReactNode }) {
  const userId = useMatrixClient().getUserId();
  if (!userId) throw new Error('Matrix client user ID is unavailable.');

  return (
    <PersistedMindroomPageNavProvider userId={userId}>{children}</PersistedMindroomPageNavProvider>
  );
}

export function MindroomSidebarNav() {
  const { canCollapse, collapsed, setCollapsed } = useMindroomDesktopPageNav();

  return (
    <MobileFriendlyClientNav>
      <SidebarNav
        onPageNavSelect={
          canCollapse
            ? (selected) => {
                setCollapsed(selected ? !collapsed : false);
                return selected;
              }
            : undefined
        }
        footer={
          canCollapse ? (
            <PageNavToggleButton collapsed={collapsed} onClick={() => setCollapsed(!collapsed)} />
          ) : undefined
        }
      />
    </MobileFriendlyClientNav>
  );
}

type MindroomPageRootProps = { nav: ReactNode; children: ReactNode; navId?: string };

export function MindroomPageRoot({ nav, children, navId }: MindroomPageRootProps) {
  const { collapsed } = useMindroomDesktopPageNav();
  useNavToActivePathMapper(navId, true);

  return <PageRoot nav={collapsed ? null : nav}>{children}</PageRoot>;
}

export function MindroomSpacePageRoot(props: Omit<MindroomPageRootProps, 'navId'>) {
  const spaceId = useSelectedSpace();
  return <MindroomPageRoot {...props} navId={spaceId} />;
}
