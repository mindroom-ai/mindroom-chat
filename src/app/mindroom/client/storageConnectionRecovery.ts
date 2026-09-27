/**
 * WebKit hosts IndexedDB in its networking process. When that process exits,
 * `IDBDatabase::connectionToServerLost` fires `close` on every open connection,
 * and the page keeps closed handles for the rest of its life. The Rust crypto
 * store then fails the SDK's /sync processing, new IndexedDB opens fail, and
 * existing Web Storage keys read stale or empty, so only a reload restores the
 * app. A dedicated sentinel connection detects the loss, and the app reloads
 * as soon as no unsaved in-memory work remains and the user is not interacting.
 */
import type { DeepTraceData } from '../diagnostics/deepTrace';

export const STORAGE_SENTINEL_DB_NAME = 'mindroom-storage-sentinel';
export const STORAGE_RECOVERY_RELOAD_KEY = 'mindroom.storageRecovery.reloadedAt';
/** A loss this soon after a recovery reload means reloading did not help. */
export const STORAGE_RECOVERY_REPEAT_WINDOW_MS = 2 * 60_000;
/** A visible page reloads only after this long without input. */
export const STORAGE_RECOVERY_IDLE_MS = 3_000;
/** A page hidden this soon after input is likely showing a picker, camera, or sign-in window. */
export const STORAGE_RECOVERY_HIDE_GRACE_MS = 2_000;
const RECOVERY_CHECK_INTERVAL_MS = 1_000;
const INPUT_EVENTS = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'beforeinput',
  'input',
  'focusin',
  'compositionstart',
  'compositionupdate',
  'compositionend',
] as const;

/** `manual`: automatic recovery is unavailable, so only the user can reload. */
export type StorageConnectionState = 'healthy' | 'lost' | 'manual';

type EventSource = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

type Options = {
  indexedDB?: IDBFactory;
  /** Holds the recovery marker; local because WebKit loses session storage with the process. */
  markerStorage?: Storage;
  document?: EventSource;
  now?: () => number;
  reload?: () => void;
  record?: (name: string, data?: DeepTraceData) => void;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
};

type RecoveryMarker = { at: number; automatic: boolean; lostAt?: number; recorded?: boolean };

type Runtime = Required<
  Pick<Options, 'now' | 'reload' | 'record' | 'setInterval' | 'clearInterval'>
> & {
  markerStorage?: Storage;
  document?: EventSource;
  previousReload?: RecoveryMarker;
  lostAt?: number;
  lastInputAt: number;
  composing: boolean;
  checkInterval?: unknown;
};

const listeners = new Set<() => void>();
const blockers = new Set<() => boolean>();
const preparations = new Set<(options: { automatic: boolean }) => void>();
let hosts = 0;
let state: StorageConnectionState = 'healthy';
let runtime: Runtime | undefined;
let reloading = false;

const setState = (next: StorageConnectionState): void => {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener());
};

const safeRecord = (current: Runtime, name: string, data?: DeepTraceData): void => {
  try {
    current.record(name, data);
  } catch {
    // Diagnostics must not affect recovery.
  }
};

const readMarker = (storage: Storage | undefined): RecoveryMarker | undefined => {
  try {
    const value: unknown = JSON.parse(storage?.getItem(STORAGE_RECOVERY_RELOAD_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return undefined;
    const { at, automatic, lostAt, recorded } = value as Partial<RecoveryMarker>;
    if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
    return {
      at,
      automatic: automatic === true,
      lostAt: typeof lostAt === 'number' ? lostAt : undefined,
      recorded: recorded === true,
    };
  } catch {
    return undefined;
  }
};

const writeMarker = (storage: Storage | undefined, marker: RecoveryMarker): void => {
  if (!storage) throw new Error('Marker storage unavailable');
  storage.setItem(STORAGE_RECOVERY_RELOAD_KEY, JSON.stringify(marker));
};

const stopRecoveryChecks = (current: Runtime): void => {
  if (current.checkInterval === undefined) return;
  current.clearInterval(current.checkInterval);
  current.checkInterval = undefined;
};

/**
 * Reloads once no unsaved in-memory work remains, after a pause in input.
 * Only a mounted client session hosts automatic recovery, so sign-in,
 * registration, and SSO flows never reload on their own.
 */
const attemptAutomaticReload = (current: Runtime): void => {
  if (runtime !== current || state !== 'lost') {
    stopRecoveryChecks(current);
    return;
  }
  if (hosts === 0 || current.composing || hasStorageRecoveryBlocker()) return;
  const sinceInput = current.now() - current.lastInputAt;
  const hidden = current.document?.visibilityState === 'hidden';
  if (sinceInput < (hidden ? STORAGE_RECOVERY_HIDE_GRACE_MS : STORAGE_RECOVERY_IDLE_MS)) return;
  if (reloadAfterStorageLoss({ automatic: true })) stopRecoveryChecks(current);
};

const markLost = (current: Runtime): void => {
  if (runtime !== current || state !== 'healthy') return;
  const repeated =
    current.previousReload !== undefined &&
    current.now() - current.previousReload.at < STORAGE_RECOVERY_REPEAT_WINDOW_MS;
  current.lostAt = current.now();
  setState(repeated ? 'manual' : 'lost');
  safeRecord(current, 'lifecycle.storage_connection_lost', { automatic_recovery: !repeated });
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

/** Marks a mounted client session, which may reload itself to recover. */
export const registerStorageRecoveryHost = (): (() => void) => {
  hosts += 1;
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    hosts -= 1;
  };
};

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
  document: events = typeof document === 'undefined' ? undefined : document,
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
    document: events,
    now,
    reload,
    record,
    setInterval: startInterval,
    clearInterval: stopInterval,
    previousReload: readMarker(markerStorage),
    lastInputAt: now(),
    composing: false,
  };
  runtime = current;
  const previous = current.previousReload;
  if (previous && !previous.recorded && now() - previous.at < STORAGE_RECOVERY_REPEAT_WINDOW_MS) {
    // Events recorded before the reload died with the lost diagnostic store.
    safeRecord(current, 'lifecycle.storage_recovery_reloaded', {
      automatic: previous.automatic,
      reload_age_ms: now() - previous.at,
      ...(previous.lostAt !== undefined
        ? { loss_to_reload_ms: previous.at - previous.lostAt }
        : {}),
    });
    try {
      writeMarker(markerStorage, { ...previous, recorded: true });
    } catch {
      // The marker still guards against loops if it cannot be updated.
    }
  }
  let database: IDBDatabase | undefined;
  const handleClose = () => markLost(current);
  // Native events keep recovery independent of React scheduling.
  const handleVisibilityChange = () => attemptAutomaticReload(current);
  const handleInput = (event: Event) => {
    current.lastInputAt = current.now();
    if (event.type === 'compositionstart' || event.type === 'compositionupdate') {
      current.composing = true;
    } else if (event.type === 'compositionend') {
      current.composing = false;
    }
  };
  events?.addEventListener('visibilitychange', handleVisibilityChange);
  INPUT_EVENTS.forEach((type) => events?.addEventListener(type, handleInput, true));
  // Another tab deleting or upgrading the sentinel must not look like a loss.
  const handleVersionChange = () => {
    database?.removeEventListener('close', handleClose);
    database?.close();
  };
  try {
    const request = indexedDB.open(STORAGE_SENTINEL_DB_NAME, 1);
    // WebKit fails an open with UnknownError when its networking process is already gone;
    // other failures (for example storage disabled in private browsing) are not a loss.
    request.onerror = () => {
      if (request.error?.name === 'UnknownError') markLost(current);
    };
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
    events?.removeEventListener('visibilitychange', handleVisibilityChange);
    INPUT_EVENTS.forEach((type) => events?.removeEventListener(type, handleInput, true));
    database?.removeEventListener('close', handleClose);
    database?.removeEventListener('versionchange', handleVersionChange);
    database?.close?.();
  };
};

/**
 * Reloads to recreate every storage-backed runtime. Every recovery reload
 * first persists a marker, so a loss that recurs right after reloading stops
 * automatic recovery instead of looping.
 */
export const reloadAfterStorageLoss = ({ automatic }: { automatic: boolean }): boolean => {
  const current = runtime;
  if (!current || state === 'healthy' || reloading) return false;
  if (automatic && state !== 'lost') return false;
  try {
    writeMarker(current.markerStorage, { at: current.now(), automatic, lostAt: current.lostAt });
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
  safeRecord(current, 'lifecycle.storage_recovery_reload', { automatic });
  try {
    current.reload();
  } catch {
    reloading = false;
    return false;
  }
  return true;
};

export const resetStorageConnectionRecoveryForTesting = (): void => {
  runtime = undefined;
  state = 'healthy';
  reloading = false;
  hosts = 0;
  listeners.clear();
  blockers.clear();
  preparations.clear();
};
