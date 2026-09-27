/**
 * WebKit hosts IndexedDB in its networking process. When that process exits,
 * `IDBDatabase::connectionToServerLost` fires `close` on every open connection,
 * and the page keeps closed handles for the rest of its life: the SDK sync
 * store, the Rust crypto store, and diagnostic storage stop working, and
 * WebKit also drops every existing MessagePort. Reloading recreates all of
 * them, so a dedicated sentinel connection detects the loss and the app
 * reloads at a safe moment.
 */
import type { DeepTraceData } from '../diagnostics/deepTrace';

export const STORAGE_SENTINEL_DB_NAME = 'mindroom-storage-sentinel';
export const STORAGE_RECOVERY_RELOAD_KEY = 'mindroom.storageRecovery.reloadedAt';
/** A loss this soon after a recovery reload means reloading did not help. */
export const STORAGE_RECOVERY_REPEAT_WINDOW_MS = 2 * 60_000;

/** `manual`: automatic recovery is unavailable, so only the user can reload. */
export type StorageConnectionState = 'healthy' | 'lost' | 'manual';

type VisibilitySource = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

type Options = {
  indexedDB?: IDBFactory;
  sessionStorage?: Storage;
  document?: VisibilitySource;
  now?: () => number;
  reload?: () => void;
  record?: (name: string, data?: DeepTraceData) => void;
};

type Runtime = Required<Pick<Options, 'now' | 'reload' | 'record'>> & {
  sessionStorage?: Storage;
  document?: VisibilitySource;
  recoveryReloadedAt?: number;
};

const listeners = new Set<() => void>();
const blockers = new Set<() => boolean>();
const preparations = new Set<() => void>();
let state: StorageConnectionState = 'healthy';
let runtime: Runtime | undefined;

const setState = (next: StorageConnectionState): void => {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener());
};

const readRecoveryReloadedAt = (storage: Storage | undefined): number | undefined => {
  try {
    const value = Number(storage?.getItem(STORAGE_RECOVERY_RELOAD_KEY));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
};

/** Hidden pages can reload unnoticed once no unsaved in-memory work remains. */
const attemptAutomaticReload = (current: Runtime): void => {
  if (runtime !== current || state !== 'lost') return;
  if (current.document?.visibilityState !== 'hidden') return;
  if (hasStorageRecoveryBlocker()) return;
  reloadAfterStorageLoss({ automatic: true });
};

const markLost = (current: Runtime): void => {
  if (runtime !== current || state !== 'healthy') return;
  const repeated =
    current.recoveryReloadedAt !== undefined &&
    current.now() - current.recoveryReloadedAt < STORAGE_RECOVERY_REPEAT_WINDOW_MS;
  current.record('lifecycle.storage_connection_lost', { automatic_recovery: !repeated });
  setState(repeated ? 'manual' : 'lost');
  attemptAutomaticReload(current);
};

export const getStorageConnectionState = (): StorageConnectionState => state;

export const subscribeStorageConnectionState = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** True while any registered check reports work that a reload would discard. */
export const hasStorageRecoveryBlocker = (): boolean =>
  Array.from(blockers).some((hasUnsavedWork) => hasUnsavedWork());

/** Registers work, such as saving unsent text, that must run before a recovery reload. */
export const registerStorageRecoveryPreparation = (prepare: () => void): (() => void) => {
  preparations.add(prepare);
  return () => {
    preparations.delete(prepare);
  };
};

/** Registers a check for work that exists only in memory, which a reload would discard. */
export const registerStorageRecoveryBlocker = (hasUnsavedWork: () => boolean): (() => void) => {
  blockers.add(hasUnsavedWork);
  return () => {
    blockers.delete(hasUnsavedWork);
  };
};

/** Opens the sentinel before client startup so a loss during bootstrap is seen too. */
export const startStorageConnectionSentinel = ({
  indexedDB = typeof window === 'undefined' ? undefined : window.indexedDB,
  sessionStorage = typeof window === 'undefined' ? undefined : window.sessionStorage,
  document: visibility = typeof document === 'undefined' ? undefined : document,
  now = Date.now,
  reload = () => window.location.reload(),
  record = () => undefined,
}: Options = {}): (() => void) => {
  if (!indexedDB) return () => undefined;
  const current: Runtime = {
    sessionStorage,
    document: visibility,
    now,
    reload,
    record,
    recoveryReloadedAt: readRecoveryReloadedAt(sessionStorage),
  };
  runtime = current;
  let database: IDBDatabase | undefined;
  const handleClose = () => markLost(current);
  // Native events keep recovery independent of React scheduling.
  const handleVisibilityChange = () => attemptAutomaticReload(current);
  visibility?.addEventListener('visibilitychange', handleVisibilityChange);
  // Another tab deleting or upgrading the sentinel must not look like a loss.
  const handleVersionChange = () => {
    database?.removeEventListener('close', handleClose);
    database?.close();
  };
  try {
    const request = indexedDB.open(STORAGE_SENTINEL_DB_NAME, 1);
    request.onsuccess = () => {
      if (runtime !== current) {
        request.result.close?.();
        return;
      }
      database = request.result;
      // Script-initiated close() does not fire `close`; only an abnormal loss does.
      database.addEventListener('close', handleClose);
      database.addEventListener('versionchange', handleVersionChange);
    };
  } catch {
    // Storage may be unavailable, for example in private browsing.
  }
  return () => {
    if (runtime === current) runtime = undefined;
    visibility?.removeEventListener('visibilitychange', handleVisibilityChange);
    database?.removeEventListener('close', handleClose);
    database?.removeEventListener('versionchange', handleVersionChange);
    database?.close?.();
  };
};

/**
 * Reloads to recreate every storage-backed runtime.
 * Automatic reloads first persist a guard so a loss that recurs right after
 * reloading stops automatic recovery instead of looping.
 */
export const reloadAfterStorageLoss = ({ automatic }: { automatic: boolean }): boolean => {
  const current = runtime;
  if (!current || state === 'healthy') return false;
  if (automatic && state !== 'lost') return false;
  try {
    current.sessionStorage?.setItem(STORAGE_RECOVERY_RELOAD_KEY, String(current.now()));
    if (!current.sessionStorage) throw new Error('Session storage unavailable');
  } catch {
    if (automatic) {
      setState('manual');
      return false;
    }
  }
  preparations.forEach((prepare) => {
    try {
      prepare();
    } catch {
      // A failed preparation must not keep broken storage alive.
    }
  });
  current.record('lifecycle.storage_recovery_reload', { automatic });
  current.reload();
  return true;
};

export const resetStorageConnectionRecoveryForTesting = (): void => {
  runtime = undefined;
  state = 'healthy';
  listeners.clear();
  blockers.clear();
  preparations.clear();
};
