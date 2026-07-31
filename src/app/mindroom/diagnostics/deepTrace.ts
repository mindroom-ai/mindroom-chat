import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { APP_BUILD_VERSION } from '../../../appVersion';
import {
  getSafeLocalStorage,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';
import {
  classifyFlightRecorderAction,
  classifyFlightRecorderRoute,
  setFlightRecorderLastAction,
} from './flightRecorder';

export const DEEP_TRACE_SCHEMA_VERSION = 1;
export const DEEP_TRACE_ENABLED_KEY = 'mindroom.diagnostics.deepTrace.enabled.v1';
export const DEEP_TRACE_DB_NAME = 'mindroom-diagnostics-deep-trace-v1';
export const DEEP_TRACE_MAX_EVENTS = 5_000;
export const DEEP_TRACE_MAX_BYTES = 2 * 1024 * 1024;
export const DEEP_TRACE_MAX_PENDING_EVENTS = 250;
export const DEEP_TRACE_MAX_PENDING_BYTES = 256 * 1024;

const DEEP_TRACE_DB_VERSION = 1;
const EVENT_STORE = 'events';
const META_STORE = 'meta';
const STATS_KEY = 'stats';
const FLUSH_INTERVAL_MS = 500;
const FLUSH_BATCH_SIZE = 50;
const LOOP_INTERVAL_MS = 1_000;
const LOOP_STALL_THRESHOLD_MS = 250;

export type DeepTraceData = Record<string, number | boolean | null>;

export type DeepTraceEvent = {
  schemaVersion: typeof DEEP_TRACE_SCHEMA_VERSION;
  sessionId: string;
  sequence: number;
  at: number;
  monotonicMs: number;
  name: string;
  data?: DeepTraceData;
};

type StoredDeepTraceEvent = DeepTraceEvent & {
  bytes: number;
};
type NetworkCategory =
  | 'matrix.sync'
  | 'matrix.relations'
  | 'matrix.messages'
  | 'matrix.media'
  | 'matrix.client'
  | 'app'
  | 'external';

export type DeepTraceStats = {
  eventCount: number;
  byteCount: number;
  droppedEventCount: number;
  oldestAt: number | null;
  newestAt: number | null;
};

export type DeepTraceSnapshot = {
  schemaVersion: typeof DEEP_TRACE_SCHEMA_VERSION;
  enabled: boolean;
  status: 'recording' | 'disabled' | 'unavailable';
  stats: DeepTraceStats;
  events: DeepTraceEvent[];
};

interface DeepTraceDB extends DBSchema {
  events: {
    key: number;
    value: StoredDeepTraceEvent;
  };
  meta: {
    key: typeof STATS_KEY;
    value: DeepTraceStats;
  };
}

type Runtime = {
  storage?: Storage;
  enabled: boolean;
  unavailable: boolean;
  disposed: boolean;
  sessionId: string;
  sequence: number;
  queue: DeepTraceEvent[];
  queueBytes: number;
  droppedQueueEvents: number;
  flushTimer?: number;
  flushPromise?: Promise<void>;
  activationPromise?: Promise<boolean>;
  activationSequence: number;
  starting: boolean;
  loopTimer?: number;
  lastLoopTick: number;
  lastRoute?: string;
  removeListeners: () => void;
};

const EMPTY_STATS: DeepTraceStats = {
  eventCount: 0,
  byteCount: 0,
  droppedEventCount: 0,
  oldestAt: null,
  newestAt: null,
};

let databasePromise: Promise<IDBPDatabase<DeepTraceDB>> | undefined;
let runtime: Runtime | undefined;
let requestSequence = 0;
const statusListeners = new Set<(status: DeepTraceRuntimeStatus) => void>();
const TRACED_FETCH = Symbol('mindroom.deepTrace.fetch');

type TracedFetch = typeof globalThis.fetch & {
  [TRACED_FETCH]?: boolean;
};

export type DeepTraceRuntimeStatus = 'starting' | 'recording' | 'disabled' | 'unavailable';

const createSessionId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

const nowMonotonic = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0;

const roundMetric = (value: number): number => Math.round(value * 10) / 10;

const STATIC_EVENT_NAMES = new Set([
  'error.global',
  'error.unhandled_rejection',
  'lifecycle.hidden',
  'lifecycle.pagehide',
  'lifecycle.pageshow',
  'lifecycle.visible',
  'network.offline',
  'network.online',
  'performance.event_loop_stall',
  'trace.build.known',
  'trace.build.unknown',
  'trace.session.start',
  'trace.session.stop',
]);

const SAFE_EVENT_PATTERNS = [
  /^interaction\.pointer\.(button|checkbox|control|input|link|menuitem|other|radio|range|select|surface|switch|tab|textarea)\.(app|dialog|document|form|navigation|timeline)$/,
  /^navigation\.(auth|direct|home|other|space|threads)\.(overview|thread)$/,
  /^network\.(app|external|matrix\.(client|media|messages|relations|sync))\.(delete|get|head|other|patch|post|put)\.(complete|error|start)$/,
];

const safeEventName = (value: string): string | undefined => {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(normalized)) return undefined;
  if (STATIC_EVENT_NAMES.has(normalized)) return normalized;
  if (SAFE_EVENT_PATTERNS.some((pattern) => pattern.test(normalized))) return normalized;
  if (import.meta.env.MODE === 'test' && /^test\.[a-z0-9._-]+$/.test(normalized)) {
    return normalized;
  }
  return undefined;
};

const safeData = (value: DeepTraceData | undefined): DeepTraceData | undefined => {
  if (!value) return undefined;

  const entries = Object.entries(value)
    .filter(([key, item]) => {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return false;
      if (item === null || typeof item === 'boolean') return true;
      return typeof item === 'number' && Number.isFinite(item);
    })
    .slice(0, 16);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const getDatabase = (): Promise<IDBPDatabase<DeepTraceDB>> => {
  if (!databasePromise) {
    const opening = openDB<DeepTraceDB>(DEEP_TRACE_DB_NAME, DEEP_TRACE_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(EVENT_STORE)) {
          db.createObjectStore(EVENT_STORE, { autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      },
    });
    databasePromise = opening;
    void opening.catch(() => {
      if (databasePromise === opening) databasePromise = undefined;
    });
  }
  return databasePromise;
};

const appendStoredEvents = async (
  events: DeepTraceEvent[],
  droppedEventCount = 0
): Promise<void> => {
  if (events.length === 0 && droppedEventCount === 0) return;

  const db = await getDatabase();
  const tx = db.transaction([EVENT_STORE, META_STORE], 'readwrite');
  const eventStore = tx.objectStore(EVENT_STORE);
  const metaStore = tx.objectStore(META_STORE);
  const stats = { ...((await metaStore.get(STATS_KEY)) ?? EMPTY_STATS) };
  stats.droppedEventCount = (stats.droppedEventCount ?? 0) + droppedEventCount;

  for (const event of events) {
    const stored: StoredDeepTraceEvent = {
      ...event,
      bytes: JSON.stringify(event).length,
    };
    await eventStore.add(stored);
    stats.eventCount += 1;
    stats.byteCount += stored.bytes;
    stats.oldestAt ??= event.at;
    stats.newestAt = event.at;
  }

  let cursor = await eventStore.openCursor();
  while (
    cursor &&
    (stats.eventCount > DEEP_TRACE_MAX_EVENTS || stats.byteCount > DEEP_TRACE_MAX_BYTES)
  ) {
    stats.eventCount -= 1;
    stats.byteCount = Math.max(0, stats.byteCount - cursor.value.bytes);
    await cursor.delete();
    cursor = await cursor.continue();
  }
  stats.oldestAt = cursor?.value.at ?? (stats.eventCount > 0 ? stats.newestAt : null);
  if (stats.eventCount === 0) stats.newestAt = null;

  await metaStore.put(stats, STATS_KEY);
  await tx.done;
};

const readStoredEvents = async (): Promise<{
  stats: DeepTraceStats;
  events: DeepTraceEvent[];
}> => {
  const db = await getDatabase();
  const tx = db.transaction([EVENT_STORE, META_STORE], 'readonly');
  const stored = await tx.objectStore(EVENT_STORE).getAll();
  const storedStats = await tx.objectStore(META_STORE).get(STATS_KEY);
  await tx.done;
  return {
    stats: { ...EMPTY_STATS, ...storedStats },
    events: stored.map(({ bytes: _bytes, ...event }) => event),
  };
};

const flush = async (target: Runtime): Promise<void> => {
  if (target.flushTimer !== undefined) {
    window.clearTimeout(target.flushTimer);
    target.flushTimer = undefined;
  }
  while (target.flushPromise) {
    await target.flushPromise;
  }
  if ((target.queue.length === 0 && target.droppedQueueEvents === 0) || target.unavailable) {
    return;
  }

  const flushSequence = target.activationSequence;
  const drain = (async () => {
    while ((target.queue.length > 0 || target.droppedQueueEvents > 0) && !target.unavailable) {
      const batch = target.queue.splice(0, FLUSH_BATCH_SIZE);
      target.queueBytes = Math.max(
        0,
        target.queueBytes - batch.reduce((total, event) => total + JSON.stringify(event).length, 0)
      );
      const droppedEventCount = target.droppedQueueEvents;
      target.droppedQueueEvents = 0;
      await appendStoredEvents(batch, droppedEventCount);
    }
  })().catch(() => {
    if (runtime !== target || target.disposed || target.activationSequence !== flushSequence) {
      return;
    }
    markUnavailable(target);
  });
  target.flushPromise = drain;
  await drain;
  if (target.flushPromise === drain) target.flushPromise = undefined;
};

const scheduleFlush = (target: Runtime, immediate = false): void => {
  if (target.unavailable) return;
  if (immediate || target.queue.length >= FLUSH_BATCH_SIZE) {
    void flush(target);
    return;
  }
  if (target.flushTimer !== undefined) return;
  target.flushTimer = window.setTimeout(() => {
    target.flushTimer = undefined;
    void flush(target);
  }, FLUSH_INTERVAL_MS);
};

export const recordDeepTraceEvent = (
  name: string,
  data?: DeepTraceData,
  options: { flush?: boolean } = {}
): void => {
  const target = runtime;
  const normalizedName = safeEventName(name);
  if (!target || !target.enabled || target.disposed || target.unavailable || !normalizedName) {
    return;
  }

  target.sequence += 1;
  const normalizedData = safeData(data);
  const event: DeepTraceEvent = {
    schemaVersion: DEEP_TRACE_SCHEMA_VERSION,
    sessionId: target.sessionId,
    sequence: target.sequence,
    at: Date.now(),
    monotonicMs: roundMetric(nowMonotonic()),
    name: normalizedName,
    ...(normalizedData ? { data: normalizedData } : {}),
  };
  const eventBytes = JSON.stringify(event).length;
  while (
    target.queue.length > 0 &&
    (target.queue.length >= DEEP_TRACE_MAX_PENDING_EVENTS ||
      target.queueBytes + eventBytes > DEEP_TRACE_MAX_PENDING_BYTES)
  ) {
    const dropped = target.queue.shift();
    if (dropped) {
      target.queueBytes = Math.max(0, target.queueBytes - JSON.stringify(dropped).length);
      target.droppedQueueEvents += 1;
    }
  }
  if (
    target.queue.length >= DEEP_TRACE_MAX_PENDING_EVENTS ||
    target.queueBytes + eventBytes > DEEP_TRACE_MAX_PENDING_BYTES
  ) {
    target.droppedQueueEvents += 1;
  } else {
    target.queue.push(event);
    target.queueBytes += eventBytes;
  }
  scheduleFlush(target, options.flush);
};

export const getDeepTraceEnabled = (
  storage: Storage | undefined = getSafeLocalStorage()
): boolean => {
  try {
    return storage?.getItem(DEEP_TRACE_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
};

export const classifyDeepTraceNetworkRequest = (input: RequestInfo | URL): NetworkCategory => {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.origin);
    const path = url.pathname;
    if (path.includes('/_matrix/media/')) return 'matrix.media';
    if (path.includes('/_matrix/client/')) {
      if (/\/sync\/?$/.test(path)) return 'matrix.sync';
      if (path.includes('/relations/')) return 'matrix.relations';
      if (/\/messages\/?$/.test(path)) return 'matrix.messages';
      return 'matrix.client';
    }
    return url.origin === window.location.origin ? 'app' : 'external';
  } catch {
    return 'external';
  }
};

const getRequestMethod = (input: RequestInfo | URL, init?: RequestInit): string => {
  const value =
    init?.method ??
    (typeof Request === 'function' && input instanceof Request ? input.method : 'GET');
  const method = value.toUpperCase();
  return ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].includes(method)
    ? method.toLowerCase()
    : 'other';
};

const getErrorCode = (value: unknown): number => {
  const name = value instanceof Error ? value.name : typeof value;
  return (
    {
      AbortError: 1,
      AggregateError: 2,
      EvalError: 3,
      RangeError: 4,
      ReferenceError: 5,
      SyntaxError: 6,
      TypeError: 7,
      URIError: 8,
      object: 9,
      string: 10,
    }[name] ?? 0
  );
};

const getSourceCode = (filename: string): number => {
  if (!filename) return 0;
  try {
    return new URL(filename, window.location.origin).origin === window.location.origin ? 1 : 2;
  } catch {
    return 3;
  }
};

const parseStackFrame = (frame: string): RegExpMatchArray | null =>
  frame.match(/^\s*at\s+.*\((.+):(\d+):(\d+)\)\s*$/) ??
  frame.match(/^\s*at\s+(?:async\s+)?(.+):(\d+):(\d+)\s*$/) ??
  frame.match(/^(?:[^@\s:]+|(?:global|module|eval) code)?@(.+):(\d+):(\d+)\s*$/);

const getStackLocation = (stack: string | undefined, skipFrames = 0): DeepTraceData => {
  if (!stack) return {};
  let framesToSkip = skipFrames;
  for (const frame of stack.split('\n')) {
    const match = parseStackFrame(frame);
    if (!match) continue;
    if (framesToSkip > 0) {
      framesToSkip -= 1;
      continue;
    }
    return {
      source_code: getSourceCode(match[1]),
      line: Number(match[2]),
      column: Number(match[3]),
    };
  }
  return {};
};

const startGlobalCapture = (target: Runtime): void => {
  const removers: Array<() => void> = [];
  const listen = (
    source: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean
  ) => {
    source.addEventListener(type, listener, options);
    removers.push(() => source.removeEventListener(type, listener, options));
  };
  const visibility = () => {
    const state = document.visibilityState === 'visible' ? 'visible' : 'hidden';
    target.lastLoopTick = nowMonotonic();
    recordDeepTraceEvent(`lifecycle.${state}`, undefined, { flush: state === 'hidden' });
  };
  const pageHide = () => recordDeepTraceEvent('lifecycle.pagehide', undefined, { flush: true });
  const pageShow = () => {
    target.lastLoopTick = nowMonotonic();
    recordDeepTraceEvent('lifecycle.pageshow', undefined, { flush: true });
  };
  const online = () => recordDeepTraceEvent('network.online');
  const offline = () => recordDeepTraceEvent('network.offline', undefined, { flush: true });
  const error = (event: ErrorEvent) =>
    recordDeepTraceEvent(
      'error.global',
      {
        error_code: getErrorCode(event.error),
        source_code: getSourceCode(event.filename),
        line: event.lineno || 0,
        column: event.colno || 0,
      },
      { flush: true }
    );
  const rejection = (event: PromiseRejectionEvent) =>
    recordDeepTraceEvent(
      'error.unhandled_rejection',
      {
        error_code: getErrorCode(event.reason),
        ...getStackLocation(event.reason instanceof Error ? event.reason.stack : undefined),
      },
      { flush: true }
    );
  const pointerDown = (event: PointerEvent) => {
    const action = classifyFlightRecorderAction(event.target);
    setFlightRecorderLastAction(action);
    recordDeepTraceEvent(`interaction.pointer.${action.kind}.${action.surface}`, {
      primary: event.isPrimary,
      pointer_count: event.pointerType === 'touch' ? 1 : 0,
    });
  };

  listen(document, 'visibilitychange', visibility);
  listen(window, 'pagehide', pageHide);
  listen(window, 'pageshow', pageShow);
  listen(window, 'online', online);
  listen(window, 'offline', offline);
  listen(window, 'error', error as EventListener);
  listen(window, 'unhandledrejection', rejection as EventListener);
  listen(document, 'pointerdown', pointerDown as EventListener, { capture: true, passive: true });
  target.removeListeners = () => removers.forEach((remove) => remove());
};

export const traceDeepDiagnosticFetch = async (
  baseFetch: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  if ((baseFetch as TracedFetch)[TRACED_FETCH]) {
    return baseFetch(input, init);
  }
  const target = runtime;
  if (!target?.enabled || target.disposed || target.unavailable) {
    return baseFetch(input, init);
  }

  const category = classifyDeepTraceNetworkRequest(input);
  const method = getRequestMethod(input, init);
  requestSequence = (requestSequence + 1) % Number.MAX_SAFE_INTEGER;
  const operationId = requestSequence;
  const startedAt = nowMonotonic();
  recordDeepTraceEvent(
    `network.${category}.${method}.start`,
    { operation_id: operationId },
    { flush: category.startsWith('matrix.') }
  );
  try {
    const response = await baseFetch(input, init);
    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
    recordDeepTraceEvent(`network.${category}.${method}.complete`, {
      operation_id: operationId,
      duration_ms: roundMetric(nowMonotonic() - startedAt),
      status: response.status,
      content_bytes:
        contentLength !== null && Number.isFinite(contentLength) ? contentLength : null,
    });
    return response;
  } catch (requestError) {
    recordDeepTraceEvent(
      `network.${category}.${method}.error`,
      {
        operation_id: operationId,
        duration_ms: roundMetric(nowMonotonic() - startedAt),
      },
      { flush: true }
    );
    throw requestError;
  }
};

const installGlobalFetchCapture = (): void => {
  if (typeof window.fetch !== 'function') return;
  const currentFetch = window.fetch as TracedFetch;
  if (currentFetch[TRACED_FETCH]) return;

  const tracedFetch: TracedFetch = (input, init) =>
    traceDeepDiagnosticFetch(currentFetch, input, init);
  Object.defineProperty(tracedFetch, TRACED_FETCH, { value: true });
  window.fetch = tracedFetch;
};

const startPerformanceCapture = (target: Runtime): void => {
  target.lastLoopTick = nowMonotonic();
  target.loopTimer = window.setInterval(() => {
    const tick = nowMonotonic();
    if (document.visibilityState === 'visible') {
      const delay = tick - target.lastLoopTick - LOOP_INTERVAL_MS;
      if (delay >= LOOP_STALL_THRESHOLD_MS) {
        recordDeepTraceEvent(
          'performance.event_loop_stall',
          {
            delay_ms: roundMetric(delay),
          },
          { flush: true }
        );
      }
      const route = classifyFlightRecorderRoute();
      const routeKey = `${route.route}.${route.hasThreadId ? 'thread' : 'overview'}`;
      if (routeKey !== target.lastRoute) {
        target.lastRoute = routeKey;
        recordDeepTraceEvent(`navigation.${routeKey}`, undefined, { flush: true });
      }
    }
    target.lastLoopTick = tick;
  }, LOOP_INTERVAL_MS);
};

const start = (target: Runtime): void => {
  if (target.enabled || target.disposed) return;
  target.starting = false;
  target.enabled = true;
  target.unavailable = false;
  target.sessionId = createSessionId();
  target.sequence = 0;
  target.lastRoute = undefined;
  startGlobalCapture(target);
  startPerformanceCapture(target);
  recordDeepTraceEvent('trace.session.start', undefined, { flush: true });
  recordDeepTraceEvent(`trace.build.${APP_BUILD_VERSION === 'unknown' ? 'unknown' : 'known'}`);
};

const getRuntimeStatus = (target: Runtime | undefined): DeepTraceRuntimeStatus => {
  if (target?.unavailable) return 'unavailable';
  if (target?.enabled) return 'recording';
  if (target?.starting) return 'starting';
  return 'disabled';
};

const notifyStatus = (target: Runtime): void => {
  if (runtime !== target) return;
  const status = getRuntimeStatus(target);
  statusListeners.forEach((listener) => {
    try {
      listener(status);
    } catch {
      // A settings subscriber must not disable diagnostic persistence.
    }
  });
};

export const getDeepTraceRuntimeStatus = (): DeepTraceRuntimeStatus => getRuntimeStatus(runtime);

export const subscribeDeepTraceStatus = (
  listener: (status: DeepTraceRuntimeStatus) => void
): (() => void) => {
  statusListeners.add(listener);
  listener(getRuntimeStatus(runtime));
  return () => statusListeners.delete(listener);
};

const stopCapture = (target: Runtime): void => {
  target.enabled = false;
  target.starting = false;
  target.removeListeners();
  target.removeListeners = () => undefined;
  if (target.loopTimer !== undefined) window.clearInterval(target.loopTimer);
  target.loopTimer = undefined;
};

const releaseDatabase = (): void => {
  const released = databasePromise;
  databasePromise = undefined;
  void released?.then((database) => database.close()).catch(() => undefined);
};

const stop = (target: Runtime, clearUnavailable = false): void => {
  const wasStarting = target.starting;
  target.activationSequence += 1;
  if (target.enabled) {
    recordDeepTraceEvent('trace.session.stop', undefined, { flush: true });
  }
  stopCapture(target);
  if (wasStarting) releaseDatabase();
  if (!target.unavailable) void flush(target);
  if (clearUnavailable) target.unavailable = false;
  notifyStatus(target);
};

const markUnavailable = (target: Runtime): void => {
  target.activationSequence += 1;
  target.unavailable = true;
  releaseDatabase();
  stopCapture(target);
  target.queue.length = 0;
  target.queueBytes = 0;
  target.droppedQueueEvents = 0;
  if (target.flushTimer !== undefined) window.clearTimeout(target.flushTimer);
  target.flushTimer = undefined;
  notifyStatus(target);
};

const verifyDatabaseWritable = async (): Promise<void> => {
  const db = await getDatabase();
  const current = (await db.get(META_STORE, STATS_KEY)) ?? EMPTY_STATS;
  await db.put(
    META_STORE,
    { ...current, droppedEventCount: current.droppedEventCount ?? 0 },
    STATS_KEY
  );
};

const ownsActivation = (target: Runtime, generation: number): boolean =>
  runtime === target && !target.disposed && target.activationSequence === generation;

const activate = (target: Runtime): Promise<boolean> => {
  if (target.enabled) return Promise.resolve(true);
  if (target.activationPromise && target.starting) return target.activationPromise;
  if (typeof indexedDB === 'undefined') {
    markUnavailable(target);
    return Promise.resolve(false);
  }

  target.unavailable = false;
  target.starting = true;
  const activationSequence = target.activationSequence + 1;
  target.activationSequence = activationSequence;
  notifyStatus(target);

  const activationPromise = (async () => {
    try {
      await verifyDatabaseWritable();
      if (!ownsActivation(target, activationSequence) || !getDeepTraceEnabled(target.storage)) {
        return false;
      }
      start(target);
      await flush(target);
      if (
        !ownsActivation(target, activationSequence) ||
        target.unavailable ||
        !target.enabled ||
        !getDeepTraceEnabled(target.storage)
      ) {
        return false;
      }
      notifyStatus(target);
      return true;
    } catch {
      if (!ownsActivation(target, activationSequence)) {
        return false;
      }
      markUnavailable(target);
      return false;
    }
  })();
  target.activationPromise = activationPromise;
  void activationPromise.finally(() => {
    if (target.activationPromise === activationPromise) target.activationPromise = undefined;
  });
  return activationPromise;
};

export const initializeDeepTraceRecorder = (
  storage: Storage | undefined = getSafeLocalStorage()
): (() => void) => {
  if (runtime && !runtime.disposed && runtime.storage === storage) {
    const existing = runtime;
    return () => {
      if (runtime !== existing || existing.disposed) return;
      stop(existing);
      existing.disposed = true;
    };
  }
  if (runtime) {
    stop(runtime);
    runtime.disposed = true;
  }

  const target: Runtime = {
    storage,
    enabled: false,
    unavailable: typeof indexedDB === 'undefined',
    starting: false,
    disposed: false,
    sessionId: createSessionId(),
    sequence: 0,
    queue: [],
    queueBytes: 0,
    droppedQueueEvents: 0,
    activationSequence: 0,
    lastLoopTick: 0,
    removeListeners: () => undefined,
  };
  runtime = target;
  installGlobalFetchCapture();
  if (getDeepTraceEnabled(storage)) void activate(target);

  return () => {
    if (runtime !== target || target.disposed) return;
    stop(target);
    target.disposed = true;
  };
};

export const setDeepTraceEnabled = async (
  enabled: boolean,
  storage: Storage | undefined = runtime?.storage ?? getSafeLocalStorage()
): Promise<boolean> => {
  if (!runtime || runtime.disposed) initializeDeepTraceRecorder(storage);
  const target = runtime;
  if (!target) return false;

  if (!enabled) {
    const persisted = removeStorageItemSafe(storage, DEEP_TRACE_ENABLED_KEY);
    stop(target, true);
    return persisted;
  }

  if (!setStorageItemSafe(storage, DEEP_TRACE_ENABLED_KEY, '1')) return false;
  return activate(target);
};

const resetPendingState = (target: Runtime): void => {
  target.queue.length = 0;
  target.queueBytes = 0;
  target.droppedQueueEvents = 0;
  if (target.flushTimer !== undefined) window.clearTimeout(target.flushTimer);
  target.flushTimer = undefined;
};

export const clearDeepTrace = async (): Promise<void> => {
  const target = runtime;
  if (target) {
    resetPendingState(target);
    if (target.flushPromise) await target.flushPromise;
    resetPendingState(target);
  }
  const db = await getDatabase();
  const tx = db.transaction([EVENT_STORE, META_STORE], 'readwrite');
  await tx.objectStore(EVENT_STORE).clear();
  await tx.objectStore(META_STORE).put({ ...EMPTY_STATS }, STATS_KEY);
  await tx.done;
};

export const readDeepTraceSnapshot = async (): Promise<DeepTraceSnapshot> => {
  const target = runtime;
  if (target) await flush(target);
  const { stats, events } = await readStoredEvents();
  return {
    schemaVersion: DEEP_TRACE_SCHEMA_VERSION,
    enabled: target?.enabled ?? getDeepTraceEnabled(),
    status: target?.unavailable ? 'unavailable' : target?.enabled ? 'recording' : 'disabled',
    stats,
    events,
  };
};
