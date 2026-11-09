import { createContext, useContext } from 'react';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import { getDesktopPageNavCollapsedStorageKey } from '../preferences/accountStorageKeys';

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

export type DesktopPageNav = {
  /** Whether the page navigation is hidden now. Never on phones, where it is the page itself. */
  collapsed: boolean;
  /** Whether the layout has a page navigation beside the content that can be collapsed. */
  canCollapse: boolean;
  setCollapsed: (collapsed: boolean) => void;
  /**
   * Opened from collapsed and not on screen since: the next page navigation to appear moves in,
   * also one that comes with a new page (a click on another space opens both at once).
   */
  opening: boolean;
  /** The opening page navigation is on screen. */
  opened: () => void;
};

const noPageNav: DesktopPageNav = {
  collapsed: false,
  canCollapse: false,
  setCollapsed: () => undefined,
  opening: false,
  opened: () => undefined,
};

export const DesktopPageNavContext = createContext<DesktopPageNav>(noPageNav);

/** The page navigation's collapse state, from the nearest `NavigationProvider`. */
export const useDesktopPageNav = (): DesktopPageNav => useContext(DesktopPageNavContext);
