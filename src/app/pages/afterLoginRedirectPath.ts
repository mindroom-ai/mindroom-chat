import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../utils/safeLocalStorage';

const AFTER_LOGIN_REDIRECT_PATH_KEY = 'after_login_redirect_url';

export const setAfterLoginRedirectPath = (url: string): void => {
  setStorageItemSafe(getSafeLocalStorage(), AFTER_LOGIN_REDIRECT_PATH_KEY, url);
};
export const getAfterLoginRedirectPath = (): string | undefined => {
  const url = getStorageItemSafe(getSafeLocalStorage(), AFTER_LOGIN_REDIRECT_PATH_KEY);
  return url ?? undefined;
};
export const deleteAfterLoginRedirectPath = (): void => {
  removeStorageItemSafe(getSafeLocalStorage(), AFTER_LOGIN_REDIRECT_PATH_KEY);
};
