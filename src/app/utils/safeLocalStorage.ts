/**
 * localStorage access that fails closed: a blocked or unavailable store
 * (Safari private mode, sandboxed iframes, storage-restricted embeds) returns
 * `undefined` instead of throwing, so callers degrade to their no-storage
 * behavior.
 */
export const getSafeLocalStorage = (): Storage | undefined => {
  try {
    if (typeof globalThis.localStorage === 'undefined') return undefined;
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};
