import { WritableAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';

export const DESKTOP_SIDEBAR_HIDDEN_STORAGE_KEY_PREFIX = 'mindroom.sidebar.desktopHidden:';

export const getDesktopSidebarHiddenStorageKey = (userId: string): string =>
  `${DESKTOP_SIDEBAR_HIDDEN_STORAGE_KEY_PREFIX}${userId}`;

const readDesktopSidebarHidden = (key: string): boolean =>
  getLocalStorageItem<unknown>(key, false) === true;

const writeDesktopSidebarHidden = (key: string, hidden: boolean): void => {
  setLocalStorageItem(key, hidden);
};

export const makeDesktopSidebarHiddenAtom = (
  userId: string
): WritableAtom<boolean, [boolean], undefined> =>
  atomWithLocalStorage(
    getDesktopSidebarHiddenStorageKey(userId),
    readDesktopSidebarHidden,
    writeDesktopSidebarHidden
  );
