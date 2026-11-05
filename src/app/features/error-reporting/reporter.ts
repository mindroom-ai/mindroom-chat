/**
 * The error reporter, loaded as its own chunk only when the deployment configured a collector and
 * this device lets it send (errorReporting.ts). It turns uncaught errors, error boundary catches,
 * sync failures, messages that stay undecryptable, failed sends, long main-thread blocks and slow
 * room opens into reports in the Sentry event format, and posts them to the collector's store
 * endpoint after `scrubEvent` (scrub.ts) has removed what must not leave the device.
 *
 * It reads codes only: error names, `errcode`s, HTTP statuses, decryption failure codes, event
 * types, durations and route templates. It never reads a message's content, a room's name or a
 * person's name, and it keeps the IDs it compares (event IDs of failed decryptions, the open
 * room) in memory only.
 */
import {
  ClientEvent,
  EventStatus,
  MatrixEventEvent,
  RoomEvent,
  SyncState,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type SyncStateData,
} from 'matrix-js-sdk';
import { APP_BUILD_VERSION, APP_RELEASE_VERSION } from '../../../appVersion';
import { getSettings } from '../../state/settings';
import type { Mechanism } from './errorReporting';
import { matchRoute, type RouteMatch } from './routeTemplate';
import {
  type ReportBreadcrumb,
  type ReportEvent,
  type ReportFrame,
  type ReportLevel,
  scrubEvent,
} from './scrub';

/** Reports one page load may send at most. */
const MAX_REPORTS_PER_PAGE = 50;
const MAX_REPORTS_PER_MINUTE = 10;
/** The same failure is reported again only after this long. */
const REPEAT_AFTER_MS = 5 * 60_000;
const MAX_BREADCRUMBS = 40;
// Keepalive requests may carry 64 KiB at most, all of them together.
const MAX_BODY_LENGTH = 60_000;

/** Main-thread blocks this long become breadcrumbs, and the longer ones reports. */
const LONG_TASK_BREADCRUMB_MS = 200;
const LONG_TASK_REPORT_MS = 2_000;
/** A room that takes this long to show its messages is reported. */
const SLOW_ROOM_OPEN_MS = 3_000;
const ROOM_OPEN_TIMEOUT_MS = 30_000;
// At startup the room waits for the client, so it gets longer.
const STARTUP_ROOM_OPEN_TIMEOUT_MS = 60_000;
/** A message counts as undecryptable once its keys have not arrived for this long. */
const DECRYPTION_GRACE_MS = 60_000;
const DECRYPTION_CHECK_MS = 30_000;
/** Each decryption failure code is reported at most this often, with the count since. */
const DECRYPTION_REPORT_EVERY_MS = 10 * 60_000;
const MAX_TRACKED_DECRYPTIONS = 2_000;

// The room timeline, or a thread's, and its message tiles.
const TIMELINE = '[data-testid="room-virtual-inner"], [data-thread-count]';
const TILE = '[data-message-id]';

let endpoint: string | undefined;
let pausedUntil = 0;
let reportsThisPage = 0;
const recentReports: number[] = [];
const lastReported = new Map<string, number>();
const breadcrumbs: ReportBreadcrumb[] = [];
let route: RouteMatch = { template: '/<unknown>/' };
let stopObservers: (() => void) | undefined;
let everStarted = false;

type ErrorFields = {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  errcode?: unknown;
  httpStatus?: unknown;
  data?: { errcode?: unknown };
};

type ErrorDetails = {
  type: string;
  message: string;
  frames: ReportFrame[];
  errcode?: string;
  httpStatus?: string;
};

const V8_FRAME =
  /^\s*at (?:(.+?) \()?((?:[a-z][\w+.-]*:\/\/|\/)[^)]*?|<anonymous>)(?::(\d+))?(?::(\d+))?\)?\s*$/i;
const OTHER_FRAME =
  /^\s*([^@]*)@((?:[a-z][\w+.-]*:\/\/)\S*?|\[native code\])(?::(\d+))?(?::(\d+))?\s*$/i;

/**
 * The frames of an `Error.stack`, oldest call first as Sentry wants them. A V8 stack starts with
 * the error's message, which may hold anything, so only its `at` lines are read.
 */
export const parseStack = (
  stack: unknown,
  origin: string = window.location.origin
): ReportFrame[] => {
  if (typeof stack !== 'string') return [];
  const lines = stack.split('\n').slice(0, 120);
  const v8 = lines.some((line) => /^\s*at /.test(line));
  const frames: ReportFrame[] = [];
  lines.forEach((line) => {
    const match = (v8 ? V8_FRAME : OTHER_FRAME).exec(line);
    if (!match) return;
    const [, name, file = '', lineNumber, column] = match;
    frames.push({
      filename: file,
      abs_path: file,
      function: name?.trim() || '?',
      lineno: lineNumber === undefined ? undefined : Number(lineNumber),
      colno: column === undefined ? undefined : Number(column),
      in_app: file.startsWith(`${origin}/`),
    });
  });
  return frames.reverse();
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** What a thrown value tells: its type, message, frames and Matrix error code. */
const describe = (value: unknown): ErrorDetails => {
  if (typeof value === 'string') return { type: 'Error', message: value, frames: [] };
  if (typeof value !== 'object' || value === null) {
    return { type: 'Error', message: `Non-error value of type ${typeof value}`, frames: [] };
  }
  const fields = value as ErrorFields;
  const type =
    text(fields.name) ?? text((value as { constructor?: { name?: unknown } }).constructor?.name);
  const errcode = text(fields.errcode) ?? text(fields.data?.errcode);
  const status = fields.httpStatus;
  return {
    type: type ?? 'Error',
    // An object that is not an error may hold anything, so only its type is told.
    message: text(fields.message) ?? `Non-error object of type ${type ?? 'Object'}`,
    frames: parseStack(fields.stack),
    errcode,
    httpStatus: typeof status === 'number' ? String(status) : undefined,
  };
};

const newEventId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

/** Groups a duration for tags, which GlitchTip counts by value. */
const durationBucket = (ms: number): string => {
  if (ms < 1_000) return '<1s';
  if (ms < 2_000) return '1-2s';
  if (ms < 5_000) return '2-5s';
  if (ms < 10_000) return '5-10s';
  return ms < 30_000 ? '10-30s' : '30s+';
};

const addBreadcrumb = (
  category: string,
  data: ReportBreadcrumb['data'],
  level: ReportLevel = 'info'
): void => {
  breadcrumbs.push({ timestamp: Date.now() / 1000, category, level, data });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
};

/** A report with what every report carries: release, route, viewport and browser. */
const newReport = (level: ReportLevel, source: string): ReportEvent => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true;
  return {
    event_id: newEventId(),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level,
    logger: 'mindroom-client',
    release: APP_BUILD_VERSION,
    environment: window.location.hostname,
    sdk: { name: 'mindroom-client.reporter', version: '1' },
    tags: {
      source,
      route: route.template,
      app_release: APP_RELEASE_VERSION,
      viewport: `${width}x${height}`,
      online: navigator.onLine ? 'yes' : 'no',
      visibility: document.visibilityState,
      display_mode: standalone ? 'standalone' : 'browser',
    },
    contexts: {
      viewport: {
        width,
        height,
        device_pixel_ratio: Math.round(window.devicePixelRatio * 100) / 100,
      },
      app: { app_version: APP_RELEASE_VERSION, app_build: APP_BUILD_VERSION },
    },
    request: {
      url: `${window.location.origin}${route.template}`,
      headers: { 'User-Agent': navigator.userAgent },
    },
    breadcrumbs: { values: breadcrumbs.slice() },
  };
};

const withError = (report: ReportEvent, details: ErrorDetails, mechanism: string): ReportEvent => {
  report.exception = {
    values: [
      {
        type: details.type,
        value: details.message,
        // Sync and send failures are caught by the SDK; the others reached the top of the app.
        mechanism: { type: mechanism, handled: mechanism === 'sync' || mechanism === 'send' },
        stacktrace: details.frames.length > 0 ? { frames: details.frames } : undefined,
      },
    ],
  };
  report.tags = {
    ...report.tags,
    error_name: details.type,
    ...(details.errcode ? { errcode: details.errcode } : {}),
    ...(details.httpStatus ? { http_status: details.httpStatus } : {}),
  };
  return report;
};

/** Whether the limits let another report out now, `key` naming the failure for repeats. */
const mayReport = (key: string, now: number): boolean => {
  if (now < pausedUntil || reportsThisPage >= MAX_REPORTS_PER_PAGE) return false;
  const last = lastReported.get(key);
  if (last !== undefined && now - last < REPEAT_AFTER_MS) return false;
  while (recentReports.length > 0 && now - (recentReports[0] ?? 0) > 60_000) recentReports.shift();
  return recentReports.length < MAX_REPORTS_PER_MINUTE;
};

/** Scrubs the report and posts it, when the setting is on and the limits allow it. */
const send = (report: ReportEvent, key: string): void => {
  const target = endpoint;
  // The setting is read at each report, so switching it off in any tab stops reports at once.
  if (!target || !getSettings().sendErrorReports) return;
  const now = Date.now();
  if (!mayReport(key, now)) return;
  const clean = scrubEvent(report);
  if (!clean) return;
  let body = JSON.stringify(clean);
  if (body.length > MAX_BODY_LENGTH) {
    clean.breadcrumbs = undefined;
    body = JSON.stringify(clean);
    if (body.length > MAX_BODY_LENGTH) return;
  }
  reportsThisPage += 1;
  recentReports.push(now);
  lastReported.set(key, now);
  if (lastReported.size > 500) {
    const oldest = lastReported.keys().next().value;
    if (oldest !== undefined) lastReported.delete(oldest);
  }
  fetch(target, {
    method: 'POST',
    body,
    // A simple request: no preflight, and the collector reads it as JSON all the same.
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    keepalive: true,
    mode: 'cors',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  })
    .then((response) => {
      if (response.status !== 429) return;
      const retryAfter = Number(response.headers.get('Retry-After'));
      pausedUntil = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 60_000);
    })
    .catch(() => undefined);
};

/** Reports an uncaught error, an unhandled rejection or an error boundary's catch. */
export const captureError = (
  value: unknown,
  mechanism: Mechanism,
  componentStack?: string
): void => {
  const details = describe(value);
  const report = withError(newReport('error', mechanism), details, mechanism);
  if (componentStack) report.extra = { component_stack: componentStack };
  const top = details.frames[details.frames.length - 1];
  send(report, `${details.type}:${details.message}:${top?.filename}:${top?.lineno}:${top?.colno}`);
};

/** Reports a slow or failed moment that is not an exception. */
const reportIssue = (
  level: ReportLevel,
  source: string,
  message: string,
  fingerprint: string[],
  fill: (report: ReportEvent) => void,
  key = fingerprint.join(':')
): void => {
  const report = newReport(level, source);
  report.message = message;
  report.fingerprint = fingerprint;
  fill(report);
  send(report, key);
};

type RoomOpen = {
  room: string;
  startup: boolean;
  started: number;
  seen: Set<string>;
  frame: number;
};
let roomOpen: RoomOpen | undefined;

const cancelRoomOpen = (): void => {
  if (roomOpen) cancelAnimationFrame(roomOpen.frame);
  roomOpen = undefined;
};

const shownTileIds = (): string[] => {
  const timeline = document.querySelector(TIMELINE);
  return timeline
    ? Array.from(
        timeline.querySelectorAll(TILE),
        (tile) => tile.getAttribute('data-message-id') ?? ''
      )
    : [];
};

const finishRoomOpen = (open: RoomOpen, elapsed: number): void => {
  roomOpen = undefined;
  const duration = Math.round(elapsed);
  addBreadcrumb('room.open', { duration_ms: duration, initial: open.startup });
  if (duration < SLOW_ROOM_OPEN_MS) return;
  const kind = open.startup ? 'startup' : 'navigation';
  reportIssue(
    'warning',
    'room-open',
    'A room was slow to show its messages',
    ['slow-room-open', kind, route.template],
    (report) => {
      report.tags = { ...report.tags, room_open: kind, duration: durationBucket(duration) };
      report.extra = { duration_ms: duration };
    }
  );
};

/**
 * Times how long the room takes to show its messages: until a message tile that was not on screen
 * before shows in a visible timeline. At startup the clock starts with the page load. A hidden
 * page ends the timing unreported, and so does a room that shows no new tile (an empty room).
 */
const timeRoomOpen = (room: string, startup: boolean): void => {
  cancelRoomOpen();
  const open: RoomOpen = {
    room,
    startup,
    started: startup ? 0 : performance.now(),
    seen: new Set(startup ? [] : shownTileIds()),
    frame: 0,
  };
  const timeout = startup ? STARTUP_ROOM_OPEN_TIMEOUT_MS : ROOM_OPEN_TIMEOUT_MS;
  const check = () => {
    if (roomOpen !== open) return;
    if (document.visibilityState !== 'visible') {
      cancelRoomOpen();
      return;
    }
    const elapsed = performance.now() - open.started;
    const timeline = document.querySelector<HTMLElement>(TIMELINE);
    if (
      timeline &&
      timeline.style.visibility !== 'hidden' &&
      Array.from(timeline.querySelectorAll(TILE)).some(
        (tile) => !open.seen.has(tile.getAttribute('data-message-id') ?? '')
      )
    ) {
      finishRoomOpen(open, elapsed);
      return;
    }
    if (elapsed > timeout) {
      addBreadcrumb(
        'room.open',
        { duration_ms: Math.round(elapsed), initial: startup, state: 'timeout' },
        'warning'
      );
      cancelRoomOpen();
      return;
    }
    open.frame = requestAnimationFrame(check);
  };
  roomOpen = open;
  open.frame = requestAnimationFrame(check);
};

/** Follows the page the app shows: a navigation breadcrumb, and a timing for each room opened. */
export const noteRoute = (pathname: string, search: string, startup = false): void => {
  const next = matchRoute(pathname, search);
  const previous = route;
  if (!startup && next.template === previous.template && next.room === previous.room) return;
  route = next;
  if (!startup) addBreadcrumb('navigation', { from: previous.template, to: next.template });
  if (!next.room) cancelRoomOpen();
  else if (startup || next.room !== previous.room) timeRoomOpen(next.room, startup);
};

const observeLongTasks = (): (() => void) | undefined => {
  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes?.includes('longtask')
  ) {
    return undefined;
  }
  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      const duration = Math.round(entry.duration);
      if (duration < LONG_TASK_BREADCRUMB_MS) return;
      const reported = duration >= LONG_TASK_REPORT_MS;
      addBreadcrumb('longtask', { duration_ms: duration }, reported ? 'warning' : 'info');
      if (!reported) return;
      reportIssue(
        'warning',
        'longtask',
        'The page stopped responding',
        ['long-task', route.template],
        (report) => {
          report.tags = { ...report.tags, duration: durationBucket(duration) };
          report.extra = { duration_ms: duration, at_ms: Math.round(entry.startTime) };
        }
      );
    });
  });
  try {
    // Buffered: the blocks of startup, before this chunk loaded, count too.
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    return undefined;
  }
  return () => observer.disconnect();
};

const observeConnectivity = (): (() => void) => {
  const online = () => addBreadcrumb('connectivity', { state: 'online' });
  const offline = () => addBreadcrumb('connectivity', { state: 'offline' }, 'warning');
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
  };
};

/**
 * Starts reporting to `target` (a store endpoint), with `place` as the page shown since startup.
 * Starting again only changes the endpoint.
 */
export const startReporter = (
  target: string,
  place?: { pathname: string; search: string }
): void => {
  const starting = endpoint === undefined;
  endpoint = target;
  if (!starting) return;
  // Only the first start times the startup room open; a later one (the setting switched back
  // on) just takes the current page.
  if (place && everStarted) route = matchRoute(place.pathname, place.search);
  else if (place) noteRoute(place.pathname, place.search, true);
  everStarted = true;
  const stops = [observeLongTasks(), observeConnectivity()];
  stopObservers = () => stops.forEach((stop) => stop?.());
};

/** Stops all reports and forgets the breadcrumbs. */
export const stopReporter = (): void => {
  endpoint = undefined;
  stopObservers?.();
  stopObservers = undefined;
  cancelRoomOpen();
  breadcrumbs.length = 0;
};

/**
 * Reports `mx`'s failures: entering the sync error state, messages still undecryptable after a
 * minute (counted by failure code), and events that could not be sent. Returns the cleanup.
 */
export const watchClient = (mx: MatrixClient): (() => void) => {
  const onSync = (state: SyncState, previous: SyncState | null, data?: SyncStateData) => {
    if (state === previous) return;
    addBreadcrumb(
      'sync',
      { state, previous: previous ?? 'none' },
      state === SyncState.Error ? 'error' : 'info'
    );
    // Offline, a failing sync is what the connection banner already says.
    if (state !== SyncState.Error || !navigator.onLine) return;
    const details = describe(data?.error ?? { name: 'SyncError', message: 'Sync failed' });
    reportIssue(
      'error',
      'sync',
      'Sync failed',
      ['sync-failed', details.errcode ?? details.type],
      (report) => {
        withError(report, { ...details, frames: [] }, 'sync');
      }
    );
  };

  // Event IDs of messages that failed to decrypt, with their failure code; local only.
  const failures = new Map<string, { code: string; at: number }>();
  const counts = new Map<string, number>();
  const lastCodeReport = new Map<string, number>();
  const onDecrypted = (event: MatrixEvent) => {
    const id = event.getId();
    if (!id) return;
    if (!event.isDecryptionFailure()) {
      failures.delete(id);
      return;
    }
    if (failures.has(id) || failures.size >= MAX_TRACKED_DECRYPTIONS) return;
    failures.set(id, { code: event.decryptionFailureReason ?? 'UNKNOWN_ERROR', at: Date.now() });
  };
  const checkDecryption = () => {
    const now = Date.now();
    failures.forEach((failure, id) => {
      if (now - failure.at < DECRYPTION_GRACE_MS) return;
      failures.delete(id);
      counts.set(failure.code, (counts.get(failure.code) ?? 0) + 1);
    });
    counts.forEach((count, code) => {
      const last = lastCodeReport.get(code);
      if (last !== undefined && now - last < DECRYPTION_REPORT_EVERY_MS) return;
      counts.delete(code);
      lastCodeReport.set(code, now);
      addBreadcrumb('decryption', { code, count }, 'warning');
      reportIssue(
        'warning',
        'decryption',
        'Messages could not be decrypted',
        ['decryption-failure', code],
        (report) => {
          report.tags = { ...report.tags, decryption_code: code };
          report.extra = { count };
        },
        `decryption:${code}:${now}`
      );
    });
  };
  const decryptionTimer = window.setInterval(checkDecryption, DECRYPTION_CHECK_MS);

  const onLocalEcho = (
    event: MatrixEvent,
    _room: Room,
    _oldEventId?: string,
    oldStatus?: EventStatus | null
  ) => {
    if (event.status !== EventStatus.NOT_SENT || oldStatus === EventStatus.NOT_SENT) return;
    const details = describe(event.error ?? { name: 'SendError', message: 'Not sent' });
    const eventType = event.getType();
    addBreadcrumb(
      'send',
      { event_type: eventType, errcode: details.errcode ?? details.type },
      'error'
    );
    if (!navigator.onLine) return;
    reportIssue(
      'error',
      'send',
      'A message could not be sent',
      ['send-failed', details.errcode ?? details.type],
      (report) => {
        withError(report, { ...details, frames: [] }, 'send');
        report.tags = { ...report.tags, event_type: eventType };
      }
    );
  };

  mx.on(ClientEvent.Sync, onSync);
  mx.on(MatrixEventEvent.Decrypted, onDecrypted);
  mx.on(RoomEvent.LocalEchoUpdated, onLocalEcho);
  return () => {
    mx.removeListener(ClientEvent.Sync, onSync);
    mx.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
    mx.removeListener(RoomEvent.LocalEchoUpdated, onLocalEcho);
    window.clearInterval(decryptionTimer);
  };
};
