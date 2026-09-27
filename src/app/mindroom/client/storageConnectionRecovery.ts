/**
 * WebKit hosts IndexedDB in its networking process. When that process exits,
 * `IDBDatabase::connectionToServerLost` fires `close` on every open connection,
 * and the page keeps closed handles for the rest of its life. The Rust crypto
 * store then fails the SDK's /sync processing, new IndexedDB opens fail, and
 * existing Web Storage keys read as null, so only a reload restores the app.
 * A dedicated sentinel connection detects the loss, and the app reloads as
 * soon as no unsaved in-memory work remains and the user is not interacting.
 */
import type { DeepTraceData } from '../diagnostics/deepTrace';

export const STORAGE_SENTINEL_DB_NAME = 'mindroom-storage-sentinel';
export const STORAGE_RECOVERY_RELOAD_KEY = 'mindroom.storageRecovery.reloadedAt';
/** A loss this soon after a recovery reload means reloading did not help. */
export const STORAGE_RECOVERY_REPEAT_WINDOW_MS = 2 * 60_000;
/** A visible page reloads only after this long without pointer or keyboard input. */
export const STORAGE_RECOVERY_IDLE_MS = 3_000;
const RECOVERY_CHECK_INTERVAL_MS = 1_000;
const INPUT_EVENTS = ['pointerdown', 'keydown'] as const;

/** `manual`: automatic recovery is unavailable, so only the user can reload. */
export type StorageConnectionState = 'healthy' | 'lost' | 'manual';

type VisibilitySource = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

type Options = {
  indexedDB?: IDBFactory;
  /** Holds the recovery marker; local because WebKit loses session storage with the process. */
  markerStorage?: Storage;
  document?: VisibilitySource;
  now?: () => number;
  reload?: () => void;
  record?: (name: string, data?: DeepTraceData) => void;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
};

type Runtime = Required<
  Pick<Options, 'now' | 'reload' | 'record' | 'setInterval' | 'clearInterval'>
> & {
  markerStorage?: Storage;
  document?: VisibilitySource;
  recoveryReloadedAt?: number;
  lastInputAt: number;
  checkInterval?: unknown;
};

const listeners = new Set<() => void>();
const blockers = new Set<() => boolean>();
const preparations = new Set<(options: { automatic: boolean }) => void>();
let state: StorageConnectionState = 'healthy';
let runtime: Runtime | undefined;
let reloading = false;

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

const stopRecoveryChecks = (current: Runtime): void => {
  if (current.checkInterval === undefined) return;
  current.clearInterval(current.checkInterval);
  current.checkInterval = undefined;
};

/**
 * Reloads once no unsaved in-memory work remains, right away when hidden and
 * otherwise after a pause in input. Without a registered check (no client
 * mounted, for example during sign-in), only the user can reload.
 */
const attemptAutomaticReload = (current: Runtime): void => {
  if (runtime !== current || state !== 'lost') {
    stopRecoveryChecks(current);
    return;
  }
  if (blockers.size === 0 || hasStorageRecoveryBlocker()) return;
  const hidden = current.document?.visibilityState === 'hidden';
  if (!hidden && current.now() - current.lastInputAt < STORAGE_RECOVERY_IDLE_MS) return;
  if (reloadAfterStorageLoss({ automatic: true })) stopRecoveryChecks(current);
};

const markLost = (current: Runtime): void => {
  if (runtime !== current || state !== 'healthy') return;
  const repeated =
    current.recoveryReloadedAt !== undefined &&
    current.now() - current.recoveryReloadedAt < STORAGE_RECOVERY_REPEAT_WINDOW_MS;
  current.record('lifecycle.storage_connection_lost', { automatic_recovery: !repeated });
  setState(repeated ? 'manual' : 'lost');
  if (repeated) return;
  // Blockers and input pauses have no events of their own, so check periodically.
  current.checkInterval = current.setInterval(
    () => attemptAutomaticReload(current),
    RECOVERY_CHECK_INTERVAL_MS
  );
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
  Array.from(blockers).some((hasUnsavedWork) => {
    try {
      return hasUnsavedWork();
    } catch {
      return true;
    }
  });

/** Registers work, such as saving unsent text, that must run before a recovery reload. */
export const registerStorageRecoveryPreparation = (
  prepare: (options: { automatic: boolean }) => void
): (() => void) => {
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
  markerStorage = typeof window === 'undefined' ? undefined : window.localStorage,
  document: visibility = typeof document === 'undefined' ? undefined : document,
  now = Date.now,
  reload = () => window.location.reload(),
  record = () => undefined,
  setInterval: startInterval = (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: stopInterval = (id) =>
    globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>),
}: Options = {}): (() => void) => {
  if (!indexedDB) return () => undefined;
  const current: Runtime = {
    markerStorage,
    document: visibility,
    now,
    reload,
    record,
    setInterval: startInterval,
    clearInterval: stopInterval,
    recoveryReloadedAt: readRecoveryReloadedAt(markerStorage),
    lastInputAt: now(),
  };
  runtime = current;
  if (
    current.recoveryReloadedAt !== undefined &&
    now() - current.recoveryReloadedAt < STORAGE_RECOVERY_REPEAT_WINDOW_MS
  ) {
    // Events recorded before the reload died with the lost diagnostic store.
    record('lifecycle.storage_recovery_reloaded', {
      reload_age_ms: now() - current.recoveryReloadedAt,
    });
  }
  let database: IDBDatabase | undefined;
  const handleClose = () => markLost(current);
  // Native events keep recovery independent of React scheduling.
  const handleVisibilityChange = () => attemptAutomaticReload(current);
  const handleInput = () => {
    current.lastInputAt = current.now();
  };
  visibility?.addEventListener('visibilitychange', handleVisibilityChange);
  INPUT_EVENTS.forEach((type) => visibility?.addEventListener(type, handleInput, true));
  // Another tab deleting or upgrading the sentinel must not look like a loss.
  const handleVersionChange = () => {
    database?.removeEventListener('close', handleClose);
    database?.close();
  };
  try {
    const request = indexedDB.open(STORAGE_SENTINEL_DB_NAME, 1);
    request.onerror = () => undefined;
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
    stopRecoveryChecks(current);
    visibility?.removeEventListener('visibilitychange', handleVisibilityChange);
    INPUT_EVENTS.forEach((type) => visibility?.removeEventListener(type, handleInput, true));
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
  if (!current || state === 'healthy' || reloading) return false;
  if (automatic && state !== 'lost') return false;
  try {
    current.markerStorage?.setItem(STORAGE_RECOVERY_RELOAD_KEY, String(current.now()));
    if (!current.markerStorage) throw new Error('Marker storage unavailable');
  } catch {
    if (automatic) {
      setState('manual');
      return false;
    }
  }
  reloading = true;
  preparations.forEach((prepare) => {
    try {
      prepare({ automatic });
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
  reloading = false;
  listeners.clear();
  blockers.clear();
  preparations.clear();
};
