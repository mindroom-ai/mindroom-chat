import { useMemo } from 'react';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  getStorageKeysSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { listSessions } from '../matrix/session/sessions';
import { registeredPlugins } from './registry';

/** Strings a plugin keeps by key for the signed-in account, in this browser's localStorage. */
export type PluginStorage = {
  getItem: (key: string) => string | null;
  /**
   * Whether the browser kept the value: false when its storage is full or blocked, or when no login
   * of the account is left in this browser.
   */
  setItem: (key: string, value: string) => boolean;
  removeItem: (key: string) => void;
};

/** The start of the localStorage key of every plugin value kept for `userId`. */
const accountPrefix = (userId: string): string => `mindroom.plugin:${encodeURIComponent(userId)}/`;

/**
 * The storage of plugin `pluginId` for the signed-in account. The app deletes it with the rest of
 * the account's local data ({@link forgetAccountInPlugins}).
 */
export const usePluginStorage = (pluginId: string): PluginStorage => {
  const userId = useMatrixClient().getSafeUserId();
  return useMemo(() => {
    const prefix = `${accountPrefix(userId)}${pluginId}/`;
    return {
      getItem: (key) => getStorageItemSafe(getSafeLocalStorage(), prefix + key),
      // Sign-out removes the login before it deletes the storage, and the account's components, in
      // this tab and others, unmount after that: one that saves as it goes must not put values back.
      setItem: (key, value) =>
        listSessions().some((session) => session.userId === userId) &&
        setStorageItemSafe(getSafeLocalStorage(), prefix + key, value),
      removeItem: (key) => {
        removeStorageItemSafe(getSafeLocalStorage(), prefix + key);
      },
    };
  }, [pluginId, userId]);
};

/** How long forgetting an account waits for the plugins before the app goes on (and reloads). */
const FORGET_WAIT_MS = 5_000;

/**
 * Deletes every plugin's storage for `userId`, then asks each plugin to forget the account
 * (`forgetAccount`) and waits for them, five seconds at most. The app calls it when this browser
 * deletes the account's local data: on sign-out and account removal, once no other login of the
 * account stays.
 */
export const forgetAccountInPlugins = async (userId: string): Promise<void> => {
  const storage = getSafeLocalStorage();
  const prefix = accountPrefix(userId);
  getStorageKeysSafe(storage)
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => removeStorageItemSafe(storage, key));
  const forgetting = registeredPlugins.map(async ({ tag, forgetAccount }) => {
    try {
      await forgetAccount?.(userId);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[plugin ${tag}] forgetting an account failed`, error);
    }
  });
  await Promise.race([
    Promise.all(forgetting),
    new Promise((resolve) => {
      setTimeout(resolve, FORGET_WAIT_MS);
    }),
  ]);
};
