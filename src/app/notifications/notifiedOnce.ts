/**
 * Each notification is raised at most once on this device: by one tab of the browser, and not
 * again after a reload. The tabs share what was notified in localStorage, per account, until the
 * entry expires. A tab only reads another tab's write once the browser has passed it on, so the
 * tab that claims a notification also holds a Web Lock named after it for a few seconds; a tab
 * that asks for the lock meanwhile, as every tab does when they all receive the same sync, loses.
 */
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import { isRecord } from '../lib/isRecord';

/** How long a message stays notified: well past the age at which it could notify anyway. */
export const NOTIFIED_KEEP_MS = 24 * 60 * 60 * 1000;

const STORAGE_KEY_PREFIX = 'mindroom.notified:';
const MAX_ENTRIES = 500;
// Long enough for every tab's copy of localStorage to catch up with the claim.
const CLAIM_HOLD_MS = 10_000;

/** Notification ID to the time its entry expires. */
type Notified = Record<string, number>;

const storageKey = (userId: string): string => `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;

const readNotified = (raw: string | null, now: number): Notified => {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > now
      )
    );
  } catch {
    return {};
  }
};

// This tab's own claims, which count where localStorage is unavailable.
const claimedHere = new Map<string, number>();

/** Records `id` as notified unless it is already; true when this call recorded it. */
const claimInStorage = (userId: string, id: string, keepMs: number, now: number): boolean => {
  const localKey = `${userId} ${id}`;
  if ((claimedHere.get(localKey) ?? 0) > now) return false;
  const storage = getSafeLocalStorage();
  const key = storageKey(userId);
  const notified = readNotified(getStorageItemSafe(storage, key), now);
  if (notified[id] !== undefined) return false;
  claimedHere.forEach((expires, claimed) => {
    if (expires <= now) claimedHere.delete(claimed);
  });
  claimedHere.set(localKey, now + keepMs);
  notified[id] = now + keepMs;
  const newest = Object.entries(notified)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTRIES);
  setStorageItemSafe(storage, key, JSON.stringify(Object.fromEntries(newest)));
  return true;
};

// Claims `id` under its Web Lock, which the claiming tab keeps a while longer.
const claimWithLock = (
  locks: LockManager,
  userId: string,
  id: string,
  keepMs: number
): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const claim = () => claimInStorage(userId, id, keepMs, Date.now());
    locks
      .request(`mindroom-notified:${userId}:${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        const claimed = claim();
        resolve(claimed);
        return claimed
          ? new Promise<void>((done) => {
              setTimeout(done, CLAIM_HOLD_MS);
            })
          : undefined;
      })
      .catch(() => resolve(claim()));
  });

/**
 * Calls `raise` with the notifications of `ids` (event IDs, or keys of the caller's) that this
 * tab claims: those this device has not raised yet and no other tab is raising. Without Web Locks
 * the claim is made, and `raise` called, at once.
 */
export const raiseOnce = (
  userId: string,
  ids: string[],
  raise: (claimed: string[]) => void,
  keepMs: number = NOTIFIED_KEEP_MS
): void => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) {
    const claimed = ids.filter((id) => claimInStorage(userId, id, keepMs, Date.now()));
    if (claimed.length > 0) raise(claimed);
    return;
  }
  Promise.all(ids.map((id) => claimWithLock(locks, userId, id, keepMs)))
    .then((results) => {
      const claimed = ids.filter((_, index) => results[index]);
      if (claimed.length > 0) raise(claimed);
    })
    .catch(() => undefined);
};

/** Forgets what the account was notified of on this device, when it signs out. */
export const clearNotified = (userId: string): void => {
  removeStorageItemSafe(getSafeLocalStorage(), storageKey(userId));
};
