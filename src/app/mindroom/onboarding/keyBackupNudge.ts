/**
 * Per-user dismissal state for the first-run key-backup onboarding nudge.
 *
 * The nudge steers a user into setting up secure (server-side) key backup so a
 * future login on a new device can still read their encrypted agent history.
 * Once dismissed we never show it again for that account; enabling backup also
 * suppresses it (checked by the caller). All access is localStorage-safe: a
 * blocked or unavailable store fails closed to "not dismissed".
 */

const DISMISS_KEY_PREFIX = 'mindroom.keyBackupNudgeDismissed:';
const DISMISSED_VALUE = '1';

const getStorage = (): Storage | undefined => {
  try {
    if (typeof globalThis.localStorage === 'undefined') return undefined;
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

export const getKeyBackupNudgeDismissStorageKey = (userId: string): string =>
  `${DISMISS_KEY_PREFIX}${userId}`;

export const readKeyBackupNudgeDismissed = (userId: string): boolean => {
  const storage = getStorage();
  if (typeof storage?.getItem !== 'function') return false;

  try {
    return storage.getItem(getKeyBackupNudgeDismissStorageKey(userId)) === DISMISSED_VALUE;
  } catch {
    return false;
  }
};

export const dismissKeyBackupNudge = (userId: string): void => {
  const storage = getStorage();
  if (typeof storage?.setItem !== 'function') return;

  try {
    storage.setItem(getKeyBackupNudgeDismissStorageKey(userId), DISMISSED_VALUE);
  } catch {
    // Fail closed if localStorage is unavailable or blocked.
  }
};
