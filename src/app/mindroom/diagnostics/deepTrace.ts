import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { APP_BUILD_VERSION } from '../../../appVersion';
import {
  getSafeLocalStorage,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';
import { classifyFlightRecorderRoute } from './flightRecorder';

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
const SCROLL_SETTLE_MS = 250;

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

type ScrollState = {
  startedAt: number;
  startTop: number;
  lastTop: number;
  eventCount: number;
  surface: string;
  timer?: number;
};

type Runtime = {
  storage?: Storage;
  initialized: boolean;
  enabled: boolean;
  unavailable: boolean;
  disposed: boolean;
  sessionId: string;
  fingerprintSalt: number;
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
  sampleTick: number;
  counters: Map<string, number>;
  lastRoute?: string;
  observer?: PerformanceObserver;
  scroll?: ScrollState;
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
let operationSequence = 0;
const statusListeners = new Set<(status: DeepTraceRuntimeStatus) => void>();
const TRACED_FETCH = Symbol('mindroom.deepTrace.fetch');

type TracedFetch = typeof globalThis.fetch & {
  [TRACED_FETCH]?: boolean;
};

export type DeepTraceRuntimeStatus = 'starting' | 'recording' | 'disabled' | 'unavailable';

const createSessionId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

const createFingerprintSalt = (): number => {
  const values = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(values);
  return values[0] || Math.floor(Math.random() * 0xffffffff);
};

const nowMonotonic = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0;

const roundMetric = (value: number): number => Math.round(value * 10) / 10;

const STATIC_EVENT_NAMES = new Set([
  'error.console.error',
  'error.console.warn',
  'error.global',
  'error.unhandled_rejection',
  'lifecycle.blur',
  'lifecycle.focus',
  'lifecycle.hidden',
  'lifecycle.pagehide',
  'lifecycle.pageshow',
  'lifecycle.visible',
  'matrix_sync.state',
  'network.offline',
  'network.online',
  'performance.event_loop_stall',
  'performance.long_task',
  'performance.runtime_sample',
  'thread_index.bootstrap_chunk.complete',
  'thread_index.bootstrap_chunk.start',
  'thread_index.flush.complete',
  'thread_index.flush.start',
  'thread_list.fetch.complete',
  'thread_list.fetch.error',
  'thread_list.fetch.start',
  'thread_list.load.complete',
  'thread_list.load.start',
  'thread_list.page.complete',
  'thread_list.page.start',
  'thread_resume.cancelled',
  'thread_resume.complete',
  'thread_resume.error',
  'thread_resume.list.complete',
  'trace.build.known',
  'trace.build.unknown',
  'trace.session.start',
  'trace.session.stop',
]);

const SAFE_EVENT_PATTERNS = [
  /^counter\.(matrix_timeline\.live\.(encrypted|plain)|thread_index\.receipt\.(room|thread))$/,
  /^interaction\.key\.(activate|escape|navigate|shortcut)\.(app|dialog|document|form|navigation|settings|timeline)$/,
  /^interaction\.pointer\.(button|checkbox|control|input|link|menuitem|other|radio|range|select|surface|switch|tab|textarea)\.(app|dialog|document|form|navigation|settings|timeline)$/,
  /^interaction\.scroll\.(start|end)\.(app|dialog|document|form|navigation|settings|timeline)$/,
  /^navigation\.(auth|direct|home|other|space|threads)\.(overview|thread)$/,
  /^network\.(app|external|matrix\.(client|media|messages|relations|sync))\.(delete|get|head|other|patch|post|put)\.(complete|error|start)$/,
  /^thread_resume\.(focus|online|pageshow|visibility)\.start$/,
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
  const stats = {
    ...EMPTY_STATS,
    ...storedStats,
  };
  await tx.done;

  return {
    stats,
    events: stored.map(({ bytes: _bytes, ...event }) => event),
  };
};

const flush = async (target: Runtime): Promise<void> => {
  if (target.flushTimer !== undefined) {
    window.clearTimeout(target.flushTimer);
    target.flushTimer = undefined;
  }
  if (target.flushPromise) {
    await target.flushPromise;
    if ((target.queue.length > 0 || target.droppedQueueEvents > 0) && !target.unavailable) {
      await flush(target);
    }
    return;
  }
  if ((target.queue.length === 0 && target.droppedQueueEvents === 0) || target.unavailable) {
    return;
  }

  const batch = target.queue.splice(0, FLUSH_BATCH_SIZE);
  target.queueBytes = Math.max(
    0,
    target.queueBytes - batch.reduce((total, event) => total + JSON.stringify(event).length, 0)
  );
  const droppedEventCount = target.droppedQueueEvents;
  target.droppedQueueEvents = 0;
  const flushSequence = target.activationSequence;
  target.flushPromise = appendStoredEvents(batch, droppedEventCount)
    .catch(() => {
      if (runtime !== target || target.disposed || target.activationSequence !== flushSequence) {
        return;
      }
      markUnavailable(target);
    })
    .finally(() => {
      target.flushPromise = undefined;
    });
  await target.flushPromise;
  if ((target.queue.length > 0 || target.droppedQueueEvents > 0) && !target.unavailable) {
    await flush(target);
  }
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

export const createDeepTraceOperationId = (): number => {
  operationSequence = (operationSequence + 1) % Number.MAX_SAFE_INTEGER;
  return operationSequence;
};

export const incrementDeepTraceCounter = (name: string, amount = 1): void => {
  const target = runtime;
  const normalizedName = name.trim().toLowerCase();
  if (
    !target ||
    !target.enabled ||
    target.disposed ||
    target.unavailable ||
    !safeEventName(`counter.${normalizedName}`) ||
    !Number.isFinite(amount)
  ) {
    return;
  }
  target.counters.set(normalizedName, (target.counters.get(normalizedName) ?? 0) + amount);
};

const flushCounters = (target: Runtime): void => {
  target.counters.forEach((count, name) => {
    recordDeepTraceEvent(`counter.${name}`, { count });
  });
  target.counters.clear();
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

const getElementSurface = (target: EventTarget | null): string => {
  if (!(target instanceof Element)) return 'document';
  if (target.closest('[role="dialog"]')) return 'dialog';
  if (target.closest('[data-setting-title]')) return 'settings';
  if (target.closest('[data-message-id]')) return 'timeline';
  if (target.closest('nav,[role="navigation"]')) return 'navigation';
  if (target.closest('form')) return 'form';
  return 'app';
};

const getControlKind = (target: EventTarget | null): string => {
  if (!(target instanceof Element)) return 'other';
  const control = target.closest('button,a,input,textarea,select,[role]');
  if (!control) return 'surface';
  if (control instanceof HTMLAnchorElement) return 'link';
  if (control instanceof HTMLButtonElement) return 'button';
  if (control instanceof HTMLInputElement) {
    return ['checkbox', 'radio', 'range'].includes(control.type) ? control.type : 'input';
  }
  if (control instanceof HTMLTextAreaElement) return 'textarea';
  if (control instanceof HTMLSelectElement) return 'select';
  const role = control.getAttribute('role');
  return ['button', 'menuitem', 'tab', 'switch'].includes(role ?? '') ? role! : 'control';
};

const getScrollTop = (target: EventTarget | null): number => {
  if (target === document) return document.scrollingElement?.scrollTop ?? 0;
  return target instanceof Element ? target.scrollTop : 0;
};

export const classifyDeepTraceNetworkRequest = (
  input: RequestInfo | URL
):
  | 'matrix.sync'
  | 'matrix.relations'
  | 'matrix.messages'
  | 'matrix.media'
  | 'matrix.client'
  | 'app'
  | 'external' => {
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

const hashText = (value: string, salt: number): number => {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

const getStackLocation = (stack: string | undefined, skipFrames = 0): DeepTraceData => {
  if (!stack) return {};
  const frames = stack.split('\n').slice(1 + skipFrames);
  for (const frame of frames) {
    const match = frame.match(/(?:\(|\s)(.+):(\d+):(\d+)\)?$/);
    if (!match) continue;
    return {
      source_code: getSourceCode(match[1]),
      line: Number(match[2]),
      column: Number(match[3]),
    };
  }
  return {};
};

const getValueKindCode = (value: unknown): number => {
  if (value instanceof Error) return 100 + getErrorCode(value);
  return (
    {
      bigint: 1,
      boolean: 2,
      function: 3,
      number: 4,
      object: 5,
      string: 6,
      symbol: 7,
      undefined: 8,
    }[typeof value] ?? 0
  );
};

const getErrorFingerprint = (value: unknown, salt: number): number => {
  const location = value instanceof Error ? getStackLocation(value.stack) : {};
  return hashText(
    `${getErrorCode(value)}:${location.source_code ?? 0}:${location.line ?? 0}:${
      location.column ?? 0
    }`,
    salt
  );
};

const getConsoleFingerprint = (values: unknown[], salt: number): number =>
  hashText(
    values
      .map((value) => {
        const location = value instanceof Error ? getStackLocation(value.stack) : {};
        return `${getValueKindCode(value)}:${location.source_code ?? 0}:${location.line ?? 0}:${
          location.column ?? 0
        }`;
      })
      .join('|'),
    salt
  );

const startGlobalCapture = (target: Runtime): void => {
  const visibility = () => {
    const state = document.visibilityState === 'visible' ? 'visible' : 'hidden';
    target.lastLoopTick = nowMonotonic();
    if (state === 'hidden') flushCounters(target);
    recordDeepTraceEvent(`lifecycle.${state}`, undefined, { flush: state === 'hidden' });
  };
  const pageHide = () => recordDeepTraceEvent('lifecycle.pagehide', undefined, { flush: true });
  const pageShow = () => {
    target.lastLoopTick = nowMonotonic();
    recordDeepTraceEvent('lifecycle.pageshow', undefined, { flush: true });
  };
  const focus = () => recordDeepTraceEvent('lifecycle.focus');
  const blur = () => recordDeepTraceEvent('lifecycle.blur');
  const online = () => recordDeepTraceEvent('network.online');
  const offline = () => recordDeepTraceEvent('network.offline', undefined, { flush: true });
  const error = (event: ErrorEvent) =>
    recordDeepTraceEvent(
      'error.global',
      {
        error_code: getErrorCode(event.error),
        fingerprint: getErrorFingerprint(event.error, target.fingerprintSalt),
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
        fingerprint: getErrorFingerprint(event.reason, target.fingerprintSalt),
        ...getStackLocation(event.reason instanceof Error ? event.reason.stack : undefined),
      },
      { flush: true }
    );
  const pointerDown = (event: PointerEvent) =>
    recordDeepTraceEvent(
      `interaction.pointer.${getControlKind(event.target)}.${getElementSurface(event.target)}`,
      {
        primary: event.isPrimary,
        pointer_count: event.pointerType === 'touch' ? 1 : 0,
      }
    );
  const keyDown = (event: KeyboardEvent) => {
    let kind: string | undefined;
    if (event.key === 'Enter' || event.key === ' ') kind = 'activate';
    else if (event.key === 'Escape') kind = 'escape';
    else if (event.key === 'Tab' || event.key.startsWith('Arrow')) kind = 'navigate';
    else if (event.metaKey || event.ctrlKey || event.altKey) kind = 'shortcut';
    if (!kind) return;
    recordDeepTraceEvent(`interaction.key.${kind}.${getElementSurface(event.target)}`, {
      repeat: event.repeat,
    });
  };
  const scroll = (event: Event) => {
    const at = nowMonotonic();
    const top = getScrollTop(event.target);
    const surface = getElementSurface(event.target);
    if (!target.scroll || target.scroll.surface !== surface) {
      if (target.scroll?.timer !== undefined) window.clearTimeout(target.scroll.timer);
      target.scroll = {
        startedAt: at,
        startTop: top,
        lastTop: top,
        eventCount: 0,
        surface,
      };
      recordDeepTraceEvent(`interaction.scroll.start.${surface}`);
    }
    target.scroll.lastTop = top;
    target.scroll.eventCount += 1;
    if (target.scroll.timer !== undefined) window.clearTimeout(target.scroll.timer);
    target.scroll.timer = window.setTimeout(() => {
      const current = target.scroll;
      if (!current) return;
      recordDeepTraceEvent(`interaction.scroll.end.${current.surface}`, {
        duration_ms: roundMetric(nowMonotonic() - current.startedAt),
        distance_px: roundMetric(Math.abs(current.lastTop - current.startTop)),
        event_count: current.eventCount,
      });
      target.scroll = undefined;
    }, SCROLL_SETTLE_MS);
  };

  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  window.addEventListener('focus', focus);
  window.addEventListener('blur', blur);
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  document.addEventListener('pointerdown', pointerDown, { capture: true, passive: true });
  document.addEventListener('keydown', keyDown, { capture: true });
  document.addEventListener('scroll', scroll, { capture: true, passive: true });

  /* eslint-disable no-console -- Opt-in tracing delegates to the original console methods. */
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const tracedConsoleError = (...values: unknown[]) => {
    recordDeepTraceEvent('error.console.error', {
      argument_count: values.length,
      fingerprint: getConsoleFingerprint(values, target.fingerprintSalt),
      ...getStackLocation(new Error().stack, 1),
    });
    originalConsoleError.apply(console, values);
  };
  const tracedConsoleWarn = (...values: unknown[]) => {
    recordDeepTraceEvent('error.console.warn', {
      argument_count: values.length,
      fingerprint: getConsoleFingerprint(values, target.fingerprintSalt),
      ...getStackLocation(new Error().stack, 1),
    });
    originalConsoleWarn.apply(console, values);
  };
  console.error = tracedConsoleError;
  console.warn = tracedConsoleWarn;

  target.removeListeners = () => {
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    window.removeEventListener('focus', focus);
    window.removeEventListener('blur', blur);
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.removeEventListener('error', error);
    window.removeEventListener('unhandledrejection', rejection);
    document.removeEventListener('pointerdown', pointerDown, { capture: true });
    document.removeEventListener('keydown', keyDown, { capture: true });
    document.removeEventListener('scroll', scroll, { capture: true });
    if (console.error === tracedConsoleError) console.error = originalConsoleError;
    if (console.warn === tracedConsoleWarn) console.warn = originalConsoleWarn;
  };
  /* eslint-enable no-console */
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
  const operationId = createDeepTraceOperationId();
  const startedAt = nowMonotonic();
  recordDeepTraceEvent(`network.${category}.${method}.start`, {
    operation_id: operationId,
  });
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
      target.sampleTick += 1;
      if (target.sampleTick % 10 === 0) {
        const memory = performance as Performance & {
          memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number };
        };
        recordDeepTraceEvent('performance.runtime_sample', {
          heap_used_bytes: memory.memory?.usedJSHeapSize ?? 0,
          heap_total_bytes: memory.memory?.totalJSHeapSize ?? 0,
          queued_trace_events: target.queue.length,
        });
      }
    }
    flushCounters(target);
    target.lastLoopTick = tick;
  }, LOOP_INTERVAL_MS);

  if (typeof PerformanceObserver !== 'function') return;
  try {
    target.observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        recordDeepTraceEvent(
          'performance.long_task',
          {
            duration_ms: roundMetric(entry.duration),
            start_ms: roundMetric(entry.startTime),
          },
          { flush: entry.duration >= LOOP_STALL_THRESHOLD_MS }
        );
      });
    });
    target.observer.observe({ type: 'longtask' });
  } catch {
    target.observer = undefined;
  }
};

const start = (target: Runtime): void => {
  if (target.enabled || target.disposed) return;
  target.starting = false;
  target.enabled = true;
  target.unavailable = false;
  target.sessionId = createSessionId();
  target.fingerprintSalt = createFingerprintSalt();
  target.sequence = 0;
  target.lastRoute = undefined;
  target.sampleTick = 0;
  target.counters.clear();
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
  target.observer?.disconnect();
  target.observer = undefined;
  if (target.loopTimer !== undefined) window.clearInterval(target.loopTimer);
  target.loopTimer = undefined;
  if (target.scroll?.timer !== undefined) window.clearTimeout(target.scroll.timer);
  target.scroll = undefined;
  target.counters.clear();
};

const stop = (target: Runtime, clearUnavailable = false): void => {
  target.activationSequence += 1;
  if (target.enabled) {
    flushCounters(target);
    recordDeepTraceEvent('trace.session.stop', undefined, { flush: true });
  }
  stopCapture(target);
  if (!target.unavailable) void flush(target);
  if (clearUnavailable) target.unavailable = false;
  notifyStatus(target);
};

const markUnavailable = (target: Runtime): void => {
  target.activationSequence += 1;
  target.unavailable = true;
  const failedDatabase = databasePromise;
  databasePromise = undefined;
  void failedDatabase?.then((database) => database.close()).catch(() => undefined);
  stopCapture(target);
  target.queue.length = 0;
  target.queueBytes = 0;
  target.droppedQueueEvents = 0;
  if (target.flushTimer !== undefined) window.clearTimeout(target.flushTimer);
  target.flushTimer = undefined;
  removeStorageItemSafe(target.storage, DEEP_TRACE_ENABLED_KEY);
  notifyStatus(target);
};

const verifyDatabaseWritable = async (): Promise<void> => {
  const db = await getDatabase();
  const tx = db.transaction(META_STORE, 'readwrite');
  const store = tx.objectStore(META_STORE);
  const current = (await store.get(STATS_KEY)) ?? EMPTY_STATS;
  await store.put(
    {
      ...current,
      droppedEventCount: current.droppedEventCount ?? 0,
    },
    STATS_KEY
  );
  await tx.done;
};

const activate = (target: Runtime): Promise<boolean> => {
  if (target.enabled) return Promise.resolve(true);
  if (target.activationPromise) {
    const pendingActivation = target.activationPromise;
    return pendingActivation.then((activated) => {
      if (activated || target.enabled) return true;
      if (
        runtime !== target ||
        target.disposed ||
        target.unavailable ||
        !getDeepTraceEnabled(target.storage)
      ) {
        return false;
      }
      if (target.activationPromise === pendingActivation) {
        target.activationPromise = undefined;
      }
      return activate(target);
    });
  }
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
      if (
        runtime !== target ||
        target.disposed ||
        target.activationSequence !== activationSequence ||
        !getDeepTraceEnabled(target.storage)
      ) {
        return false;
      }
      start(target);
      await flush(target);
      if (
        runtime !== target ||
        target.disposed ||
        target.activationSequence !== activationSequence ||
        target.unavailable ||
        !target.enabled ||
        !getDeepTraceEnabled(target.storage)
      ) {
        return false;
      }
      notifyStatus(target);
      return true;
    } catch {
      if (
        runtime !== target ||
        target.disposed ||
        target.activationSequence !== activationSequence
      ) {
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
      existing.disposed = true;
      stop(existing);
    };
  }
  if (runtime) {
    runtime.disposed = true;
    stop(runtime);
  }

  const target: Runtime = {
    storage,
    initialized: true,
    enabled: false,
    unavailable: typeof indexedDB === 'undefined',
    starting: false,
    disposed: false,
    sessionId: createSessionId(),
    fingerprintSalt: createFingerprintSalt(),
    sequence: 0,
    queue: [],
    queueBytes: 0,
    droppedQueueEvents: 0,
    activationSequence: 0,
    lastLoopTick: 0,
    sampleTick: 0,
    counters: new Map(),
    removeListeners: () => undefined,
  };
  runtime = target;
  installGlobalFetchCapture();
  if (getDeepTraceEnabled(storage)) void activate(target);

  return () => {
    if (runtime !== target || target.disposed) return;
    target.disposed = true;
    stop(target);
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

const clearPendingAggregates = (target: Runtime): void => {
  target.counters.clear();
  const scrollTimer = target.scroll?.timer;
  if (scrollTimer !== undefined) window.clearTimeout(scrollTimer);
  target.scroll = undefined;
};

export const clearDeepTrace = async (): Promise<void> => {
  const target = runtime;
  if (target) {
    target.queue.length = 0;
    target.queueBytes = 0;
    target.droppedQueueEvents = 0;
    clearPendingAggregates(target);
    if (target.flushTimer !== undefined) window.clearTimeout(target.flushTimer);
    target.flushTimer = undefined;
    if (target.flushPromise) await target.flushPromise;
    target.queue.length = 0;
    target.queueBytes = 0;
    target.droppedQueueEvents = 0;
    clearPendingAggregates(target);
    if (target.flushTimer !== undefined) window.clearTimeout(target.flushTimer);
    target.flushTimer = undefined;
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
