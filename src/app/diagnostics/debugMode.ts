import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import {
  FLIGHT_RECORDER_ABNORMAL_KEY,
  FLIGHT_RECORDER_CURRENT_KEY,
  installFlightRecorder,
} from './flightRecorder';
import { clearDeepTrace, initializeDeepTraceRecorder, setDeepTraceEnabled } from './deepTrace';
import { startMemorySampler } from './memorySampler';

/**
 * Debug mode turns on the iOS app's diagnostics, the flight recorder and the deep trace switch,
 * in a browser. It is off by default there: the recorder writes to local storage every two
 * seconds, and two tabs would each take the other's live session for one that ended unexpectedly.
 * On every platform, the iOS app included, it also adds "Attach app logs" to the composer.
 */
export const DEBUG_MODE_KEY = 'mindroom.diagnostics.debugMode.v1';

let stopFlightRecorder: (() => void) | undefined;
const listeners = new Set<() => void>();

const notifyListeners = (): void => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // One subscriber failing must not keep the others from the change.
    }
  });
};

/** Whether debug mode is on in this browser. */
export const getDebugModeEnabled = (
  storage: Storage | undefined = getSafeLocalStorage()
): boolean => getStorageItemSafe(storage, DEBUG_MODE_KEY) === '1';

/**
 * Calls the listener after each change of debug mode, in this page or another tab of the app, so
 * the interface follows the saved choice; another tab's change starts no recorder here. Returns
 * the unsubscribe function.
 */
export const subscribeDebugMode = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEBUG_MODE_KEY || event.key === null) listener();
  };
  // Without a window (a worker, a test in Node) only this page's changes arrive.
  const target = typeof window === 'undefined' ? undefined : window;
  target?.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    target?.removeEventListener('storage', onStorage);
  };
};

/** Starts the flight recorder, kept so that debug mode can stop it again. */
export const startFlightRecorder = (): void => {
  stopFlightRecorder = installFlightRecorder();
};

type DebugModeOptions = {
  storage?: Storage;
  /** The recorders run whatever debug mode says (the iOS app): only the choice is saved. */
  keepRecorders?: boolean;
};

/**
 * Turns debug mode on or off in this browser and starts or stops its recorders at once; off also
 * deletes what they recorded. Returns whether the choice was saved.
 */
export const setDebugModeEnabled = async (
  enabled: boolean,
  { storage = getSafeLocalStorage(), keepRecorders = false }: DebugModeOptions = {}
): Promise<boolean> => {
  if (enabled) {
    // Unsaved, the choice would be off again on the next start, the recorder's session with it.
    if (!setStorageItemSafe(storage, DEBUG_MODE_KEY, '1')) return false;
    notifyListeners();
    if (keepRecorders) return true;
    startFlightRecorder();
    // Deep tracing records only once its own switch is on.
    initializeDeepTraceRecorder();
    startMemorySampler();
    return true;
  }
  const saved = removeStorageItemSafe(storage, DEBUG_MODE_KEY);
  notifyListeners();
  if (keepRecorders) return saved;
  stopFlightRecorder?.();
  stopFlightRecorder = undefined;
  // Off clears what debug mode recorded: its Clear button goes with it, and a bug report would
  // still attach the trace. A stopped session never ends cleanly either; left behind, it would
  // read as a crash once debug mode is back on. The flight recorder's keys go first, so a trace
  // store that fails to clear cannot keep them.
  removeStorageItemSafe(storage, FLIGHT_RECORDER_CURRENT_KEY);
  removeStorageItemSafe(storage, FLIGHT_RECORDER_ABNORMAL_KEY);
  await setDeepTraceEnabled(false);
  await clearDeepTrace();
  return saved;
};
