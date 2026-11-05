import { ReactElement, ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import { PageRoot } from '../ui/page';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../ui/sidebar';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useNavToActivePathMapper } from '../routes/useNavToActivePathMapper';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useSpace } from '../matrix/hooks/useSpace';
import { MobileFriendlyClientNav } from './MobileFriendly';
import { SidebarNav } from './SidebarNav';
import {
  MindroomDesktopPageNav,
  MindroomDesktopPageNavContext,
  readDesktopPageNavCollapsed,
  useMindroomDesktopPageNav,
  writeDesktopPageNavCollapsed,
} from './desktopPageNavState';
import { usePanelSlot } from '../ui/panels/panelPresence';
import { shortcutAttributes } from '../shortcuts/ShortcutKeys';
import { useShortcut } from '../shortcuts/useShortcut';

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
  const { collapsed, setCollapsed } = useMindroomDesktopPageNav();
  const label = collapsed
    ? t('sharedUi.mindroomNavigation.expandNavigationPanel')
    : t('sharedUi.mindroomNavigation.collapseNavigationPanel');
  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={label} shortcut="roomList">
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={label}
            aria-expanded={!collapsed}
            {...shortcutAttributes('roomList')}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Icon src={collapsed ? Icons.ChevronRight : Icons.ChevronLeft} data-directional />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}

/**
 * The icon rail, with the page navigation's collapse toggle at its foot wherever the panel can
 * collapse. Choosing the section already shown toggles its navigation instead of navigating;
 * choosing another opens it.
 */
export function MindroomSidebarNav() {
  const { collapsed, canCollapse, setCollapsed } = useMindroomDesktopPageNav();
  useShortcut('roomList', () => {
    if (!canCollapse) return false;
    setCollapsed(!collapsed);
    return true;
  });

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
      <SidebarNav
        footer={canCollapse ? <PageNavToggle /> : undefined}
        onPageNavSelect={handlePageNavSelect}
      />
    </MobileFriendlyClientNav>
  );
}

type MindroomPageRootProps = {
  nav: ReactElement;
  children: ReactNode;
};

/** Remembers what a section shows, also while a phone hides the section's own list. */
function RememberSectionPath({ navId }: { navId: string }) {
  useNavToActivePathMapper(navId, true);
  return null;
}

/**
 * A page with its navigation, which is left out while collapsed and moves in and out when that
 * changes. With `navId` (`home`, `direct`) it remembers the content open in that section, so its
 * rail button returns there.
 */
export function MindroomPageRoot({
  nav,
  navId,
  children,
}: MindroomPageRootProps & { navId?: string }) {
  const { collapsed } = useMindroomDesktopPageNav();
  const shownNav = usePanelSlot(collapsed ? undefined : nav);
  return (
    <PageRoot main nav={shownNav}>
      {navId && <RememberSectionPath navId={navId} />}
      {children}
    </PageRoot>
  );
}

/** A space's page: also remembers the content open in the space, like the other sections. */
export function MindroomSpacePageRoot({ nav, children }: MindroomPageRootProps) {
  const space = useSpace();
  useNavToActivePathMapper(space.roomId, true);
  return <MindroomPageRoot nav={nav}>{children}</MindroomPageRoot>;
}
