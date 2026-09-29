import {
  getSafeSessionStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';

export const INDEXED_DB_LOSS_SENTINEL_DB_NAME = 'mindroom-indexeddb-sentinel-v1';
/** sessionStorage: time of this tab's last recovery reload, to avoid reload loops. */
export const INDEXED_DB_LOSS_RELOAD_KEY = 'mindroom.indexedDbLoss.reloadAt.v1';
const RELOAD_GUARD_MS = 60_000;

type Options = {
  factory?: IDBFactory;
  reload?: () => void;
  now?: () => number;
  sessionStorage?: Storage;
};

/**
 * WebKit hosts IndexedDB in its networking process. When that process exits
 * (on iOS, typically while the app is suspended), the browser closes every
 * connection in the page and each fires `close`. The Matrix sync store
 * reconnects by itself, but the Rust crypto store cannot be reopened, so a
 * sentinel connection detects the loss and reloads the page once it is visible.
 */
export const installIndexedDbLossRecovery = ({
  factory = globalThis.indexedDB,
  reload = () => window.location.reload(),
  now = Date.now,
  sessionStorage = getSafeSessionStorage(),
}: Options = {}): (() => void) => {
  if (!factory) return () => undefined;
  let disposed = false;
  let lost = false;
  let connection: IDBDatabase | undefined;
  let guardTimer: number | undefined;

  const stopWaiting = () => {
    document.removeEventListener('visibilitychange', recover);
    window.removeEventListener('pageshow', recover);
  };

  function recover() {
    if (disposed || !lost) return;
    if (document.visibilityState !== 'visible') {
      document.addEventListener('visibilitychange', recover);
      window.addEventListener('pageshow', recover);
      return;
    }
    stopWaiting();
    const at = now();
    const lastReload = Number(getStorageItemSafe(sessionStorage, INDEXED_DB_LOSS_RELOAD_KEY));
    // A loss right after a recovery reload waits out the rest of the interval.
    if (lastReload > 0 && lastReload <= at && at - lastReload < RELOAD_GUARD_MS) {
      guardTimer ??= window.setTimeout(() => {
        guardTimer = undefined;
        recover();
      }, lastReload + RELOAD_GUARD_MS - at);
      return;
    }
    // Without a stored guard a failing reload could loop; stay on this page.
    if (!setStorageItemSafe(sessionStorage, INDEXED_DB_LOSS_RELOAD_KEY, String(at))) return;
    reload();
  }

  function arm() {
    if (disposed) return;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(INDEXED_DB_LOSS_SENTINEL_DB_NAME, 1);
    } catch {
      return;
    }
    request.onerror = (event) => {
      // Without a sentinel there is no detection; the page keeps working.
      event.preventDefault();
    };
    request.onsuccess = () => {
      const opened = request.result;
      if (disposed) {
        opened.close();
        return;
      }
      connection = opened;
      // `close` fires only when the browser closes the connection itself.
      opened.onclose = () => {
        lost = true;
        recover();
      };
      // Another context deleting the database is not a loss; do not block it,
      // and reopen afterwards (the open waits for the deletion).
      opened.onversionchange = () => {
        opened.close();
        arm();
      };
    };
  }

  arm();

  return () => {
    disposed = true;
    stopWaiting();
    if (guardTimer !== undefined) window.clearTimeout(guardTimer);
    connection?.close();
  };
};
