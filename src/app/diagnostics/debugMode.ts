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
 * Debug mode, a device-local switch on every platform. On, it records a deep trace with the app's
 * memory figures and adds "Attach app logs" to the composer's plus menu. In a browser it also
 * starts the flight recorder and shows the diagnostics tiles, which the iOS app always has on:
 * there the recorder writes to local storage every two seconds, and two tabs would each take the
 * other's live session for one that ended unexpectedly, so a browser keeps them off by default.
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
 * Calls the listener after each change of debug mode, in this page or another tab of the app.
 * Returns the unsubscribe function.
 */
export const subscribeDebugMode = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEBUG_MODE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

/** Starts the flight recorder, kept so that debug mode can stop it again. */
export const startFlightRecorder = (): void => {
  stopFlightRecorder = installFlightRecorder();
};

type DebugModeOptions = {
  storage?: Storage;
  /**
   * The recorders run whatever debug mode says (the iOS app): on starts no second flight recorder,
   * and off keeps the flight recorder and what it recorded.
   */
  keepRecorders?: boolean;
};

/**
 * Turns debug mode on or off on this device and starts or stops its recorders at once. On also
 * turns the deep trace on, so attached logs hold it; its own switch can still turn it off. Off
 * turns the deep trace off and deletes it, and in a browser stops the flight recorder and deletes
 * its records too. Returns whether the choice was saved.
 */
export const setDebugModeEnabled = async (
  enabled: boolean,
  { storage = getSafeLocalStorage(), keepRecorders = false }: DebugModeOptions = {}
): Promise<boolean> => {
  if (enabled) {
    // Unsaved, the choice would be off again on the next start, the recorder's session with it.
    if (!setStorageItemSafe(storage, DEBUG_MODE_KEY, '1')) return false;
    if (!keepRecorders) startFlightRecorder();
    initializeDeepTraceRecorder();
    startMemorySampler();
    notifyListeners();
    try {
      await setDeepTraceEnabled(true);
    } catch {
      // Debug mode stays on; the deep trace's own tile shows that it does not record.
    }
    return true;
  }
  const saved = removeStorageItemSafe(storage, DEBUG_MODE_KEY);
  notifyListeners();
  if (!keepRecorders) {
    stopFlightRecorder?.();
    stopFlightRecorder = undefined;
    // Off clears what debug mode recorded: its Clear button goes with it, and a bug report would
    // still attach the trace. A stopped session never ends cleanly either; left behind, it would
    // read as a crash once debug mode is back on. The flight recorder's keys go first, so a trace
    // store that fails to clear cannot keep them.
    removeStorageItemSafe(storage, FLIGHT_RECORDER_CURRENT_KEY);
    removeStorageItemSafe(storage, FLIGHT_RECORDER_ABNORMAL_KEY);
  }
  await setDeepTraceEnabled(false);
  await clearDeepTrace();
  return saved;
};
