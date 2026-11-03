import React, { ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import { PageRoot } from '../../components/page';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../components/sidebar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useNavToActivePathMapper } from '../../hooks/useNavToActivePathMapper';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSpace } from '../../hooks/useSpace';
import { MobileFriendlyClientNav } from '../../pages/MobileFriendly';
import { SidebarNav } from '../../pages/client/SidebarNav';
import {
  MindroomDesktopPageNav,
  MindroomDesktopPageNavContext,
  readDesktopPageNavCollapsed,
  useMindroomDesktopPageNav,
  writeDesktopPageNavCollapsed,
} from './desktopPageNavState';

/**
 * Owns whether the page navigation (the room list beside the content) is collapsed. The choice
 * is saved per account and applies wherever navigation and content share the screen; phones
 * always show the navigation as its own page and keep the saved choice for later.
 */
export function MindroomNavigationProvider({ children }: { children: ReactNode }) {
  const userId = useMatrixClient().getUserId() ?? '';
  const canCollapse = useScreenSizeContext() !== ScreenSize.Mobile;
  const [saved, setSaved] = useState(() => ({
    userId,
    collapsed: readDesktopPageNavCollapsed(userId),
  }));
  const savedCollapsed =
    saved.userId === userId ? saved.collapsed : readDesktopPageNavCollapsed(userId);

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      writeDesktopPageNavCollapsed(userId, collapsed);
      setSaved({ userId, collapsed });
    },
    [userId]
  );

  const value = useMemo<MindroomDesktopPageNav>(
    () => ({ collapsed: canCollapse && savedCollapsed, canCollapse, setCollapsed }),
    [canCollapse, savedCollapsed, setCollapsed]
  );

  return (
    <MindroomDesktopPageNavContext.Provider value={value}>
      {children}
    </MindroomDesktopPageNavContext.Provider>
  );
}

function PageNavToggle() {
  const { t } = useTranslation();
  const { collapsed, canCollapse, setCollapsed } = useMindroomDesktopPageNav();
  if (!canCollapse) return null;
  const label = collapsed
    ? t('sharedUi.mindroomNavigation.expandNavigationPanel')
    : t('sharedUi.mindroomNavigation.collapseNavigationPanel');
  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={label}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={label}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Icon src={collapsed ? Icons.ChevronRight : Icons.ChevronLeft} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}

/**
 * The icon rail, with the page navigation's collapse toggle at its foot. Choosing the section
 * already shown toggles its navigation instead of navigating; choosing another opens it.
 */
export function MindroomSidebarNav() {
  const { collapsed, canCollapse, setCollapsed } = useMindroomDesktopPageNav();

  const handlePageNavSelect = useCallback(
    (selected: boolean): boolean => {
      if (!canCollapse) return false;
      if (selected) {
        setCollapsed(!collapsed);
        return true;
      }
      if (collapsed) setCollapsed(false);
      return false;
    },
    [canCollapse, collapsed, setCollapsed]
  );

  return (
    <MobileFriendlyClientNav>
      <SidebarNav footer={<PageNavToggle />} onPageNavSelect={handlePageNavSelect} />
    </MobileFriendlyClientNav>
  );
}

type MindroomPageRootProps = {
  nav: ReactNode;
  children: ReactNode;
};

/** A page with its navigation, which is left out while collapsed. */
export function MindroomPageRoot({ nav, children }: MindroomPageRootProps) {
  const { collapsed } = useMindroomDesktopPageNav();
  return <PageRoot nav={collapsed ? undefined : nav}>{children}</PageRoot>;
}

/** A space's page: also remembers the content open in the space, like the other sections. */
export function MindroomSpacePageRoot({ nav, children }: MindroomPageRootProps) {
  const space = useSpace();
  useNavToActivePathMapper(space.roomId, true);
  return <MindroomPageRoot nav={nav}>{children}</MindroomPageRoot>;
}
