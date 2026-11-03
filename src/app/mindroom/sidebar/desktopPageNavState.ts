import { createContext, useContext } from 'react';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';

/** Where an account's choice to collapse the page navigation (room list) panel is kept. */
export const getDesktopPageNavCollapsedStorageKey = (userId: string): string =>
  `mindroom.pageNav.collapsed:${userId}`;

/** The saved choice; anything but the exact strings written below counts as expanded. */
export const readDesktopPageNavCollapsed = (userId: string): boolean =>
  getStorageItemSafe(getSafeLocalStorage(), getDesktopPageNavCollapsedStorageKey(userId)) ===
  'true';

export const writeDesktopPageNavCollapsed = (userId: string, collapsed: boolean): void => {
  setStorageItemSafe(
    getSafeLocalStorage(),
    getDesktopPageNavCollapsedStorageKey(userId),
    collapsed ? 'true' : 'false'
  );
};

export type MindroomDesktopPageNav = {
  /** Whether the page navigation is hidden now. Never on phones, where it is the page itself. */
  collapsed: boolean;
  /** Whether the layout has a page navigation beside the content that can be collapsed. */
  canCollapse: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

const noPageNav: MindroomDesktopPageNav = {
  collapsed: false,
  canCollapse: false,
  setCollapsed: () => undefined,
};

export const MindroomDesktopPageNavContext = createContext<MindroomDesktopPageNav>(noPageNav);

/** The page navigation's collapse state, from the nearest `MindroomNavigationProvider`. */
export const useMindroomDesktopPageNav = (): MindroomDesktopPageNav =>
  useContext(MindroomDesktopPageNavContext);
