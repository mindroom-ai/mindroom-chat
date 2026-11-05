// What Retry does in the view of a part of the app that could not load (src/app/lib/lazyPart.tsx).
// It loads the part again first. Chrome 145 and Safari 26 (so also the iOS app) remember a dynamic
// import that failed and fail every later one of the same file without asking the network, until
// the page reloads; Chromium 156 asks again. So when the second load fails while the device is
// online, the page reloads, unless that would lose something only this page holds: then the view
// says a reload is needed and leaves the choice to the person.

/** Where a Retry ended: the part loaded, the device is offline, a reload started, or one is needed. */
export type PartRetryOutcome = 'loaded' | 'offline' | 'reloading' | 'reloadNeeded';

export type PartRetry = {
  retryLoad: () => Promise<void>;
  online: () => boolean;
  wouldLoseWork: () => boolean;
  reload: () => void;
};

/** Loads the part again; when that fails online, reloads the page if nothing would be lost. */
export const retryPart = async ({
  retryLoad,
  online,
  wouldLoseWork,
  reload,
}: PartRetry): Promise<PartRetryOutcome> => {
  try {
    await retryLoad();
    return 'loaded';
  } catch {
    // The browser kept the failure, or the network is still down.
  }
  if (!online()) return 'offline';
  if (wouldLoseWork()) return 'reloadNeeded';
  reload();
  return 'reloading';
};
