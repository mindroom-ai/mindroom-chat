// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import {
  ClientEvent,
  EventStatus,
  MatrixEventEvent,
  RoomEvent,
  SyncState,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_BUILD_VERSION } from '../../config/appVersion';
import type { ReportTarget } from './errorReporting';
import type { ReportEvent } from './scrub';

type Reporter = typeof import('./reporter');

const TARGET: ReportTarget = {
  url: 'https://errors.example.org/api/1/envelope/',
  dsn: 'https://abc123@errors.example.org/1',
  key: 'abc123',
  environment: 'chat.example.org',
};
const ROOM_PATH = `/home/${encodeURIComponent('!AbCdEfGhIjKl:example.org')}/`;

let reporter: Reporter;
const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
  Promise.resolve({ ok: true, status: 200, headers: new Headers() })
);

/** An envelope's lines: its header, the item header and the event. */
const envelopeLines = (
  body: unknown
): [Record<string, unknown>, Record<string, unknown>, ReportEvent] => {
  const lines = String(body).split('\n');
  expect(lines).toHaveLength(4);
  expect(lines[3]).toBe('');
  return lines.slice(0, 3).map((line) => JSON.parse(line) as unknown) as [
    Record<string, unknown>,
    Record<string, unknown>,
    ReportEvent
  ];
};

const reports = (): ReportEvent[] =>
  fetchMock.mock.calls.map(([, init]) => envelopeLines(init.body)[2]);

const matrixError = (message: string, errcode: string, httpStatus: number) =>
  Object.assign(new Error(message), { name: 'MatrixError', errcode, httpStatus });

/** A client that only emits; `watchClient` only listens. */
const watchFakeClient = () => {
  const mx = new EventEmitter();
  return { mx, stop: reporter.watchClient(mx as unknown as MatrixClient) };
};

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  reporter = await import('./reporter');
});

afterEach(() => {
  reporter.stopReporter();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseStack', () => {
  it('reads V8 frames, oldest first, and never the message line', () => {
    const stack = [
      'TypeError: invite alice@example.org failed',
      '    at sendMessage (https://chat.example.org/assets/index-B9x8Z2Ab.js:12:3456)',
      '    at https://chat.example.org/assets/index-B9x8Z2Ab.js:1:2',
      '    at async Promise.all (index 0)',
      '    at chrome-extension://abcdef/content.js:5:6',
    ].join('\n');
    expect(reporter.parseStack(stack, 'https://chat.example.org')).toEqual([
      {
        filename: 'chrome-extension://abcdef/content.js',
        abs_path: 'chrome-extension://abcdef/content.js',
        function: '?',
        lineno: 5,
        colno: 6,
        in_app: false,
      },
      {
        filename: 'https://chat.example.org/assets/index-B9x8Z2Ab.js',
        abs_path: 'https://chat.example.org/assets/index-B9x8Z2Ab.js',
        function: '?',
        lineno: 1,
        colno: 2,
        in_app: true,
      },
      {
        filename: 'https://chat.example.org/assets/index-B9x8Z2Ab.js',
        abs_path: 'https://chat.example.org/assets/index-B9x8Z2Ab.js',
        function: 'sendMessage',
        lineno: 12,
        colno: 3456,
        in_app: true,
      },
    ]);
  });

  it('reads Firefox and Safari frames, and no line of text with an @ in it', () => {
    const stack = [
      'sendMessage@https://chat.example.org/assets/index-B9x8Z2Ab.js:12:3456',
      'global code@https://chat.example.org/assets/index-B9x8Z2Ab.js:1:2',
      'invite alice@example.org failed',
      'map@[native code]',
    ].join('\n');
    expect(
      reporter.parseStack(stack, 'https://chat.example.org').map((frame) => frame.function)
    ).toEqual(['map', 'global code', 'sendMessage']);
  });
});

describe('reports', () => {
  it('sends an uncaught error with the release, route and browser, scrubbed', () => {
    reporter.startReporter(TARGET, { pathname: ROOM_PATH, search: '' });
    reporter.captureError(
      new TypeError("Cannot read properties of undefined (reading 'getId') for @alice:example.org"),
      'onerror'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(TARGET.url);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      // Another origin: the auth header needs a preflight, which keepalive requests may not do.
      keepalive: false,
    });
    // The key travels in a header only, never in an address a privacy list could match.
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      'content-type': 'application/x-sentry-envelope',
      'x-sentry-auth':
        'Sentry sentry_version=7, sentry_key=abc123, sentry_client=mindroom-client.reporter/1',
    });
    const [report] = reports();
    expect(report?.environment).toBe('chat.example.org');
    expect(report?.exception?.values[0]).toMatchObject({
      type: 'TypeError',
      value: "Cannot read properties of undefined (reading 'getId') for <user-id>",
      mechanism: { type: 'onerror', handled: false },
    });
    expect(report?.release).toBe(APP_BUILD_VERSION);
    expect(report?.tags).toMatchObject({
      route: '/home/:roomIdOrAlias/:eventId?/',
      source: 'onerror',
      error_name: 'TypeError',
    });
    expect(report?.request?.headers?.['User-Agent']).toBe(navigator.userAgent);
    expect(report?.contexts?.viewport).toMatchObject({ width: window.innerWidth });
    expect(JSON.stringify(report)).not.toMatch(/alice|AbCdEfGhIjKl/);
  });

  it('sends nothing while the setting is off, and a repeat only after five minutes', () => {
    reporter.startReporter(TARGET);
    localStorage.setItem('settings', JSON.stringify({ sendErrorReports: false }));
    reporter.captureError(new Error('while off'), 'onerror');
    expect(fetchMock).not.toHaveBeenCalled();

    localStorage.clear();
    const error = new Error('the same failure');
    reporter.captureError(error, 'onerror');
    reporter.captureError(error, 'onerror');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Array.from({ length: 15 }, (_, index) =>
      reporter.captureError(new Error(`failure ${index}`), 'onerror')
    );
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('keeps React’s component stack with an error boundary catch', () => {
    reporter.startReporter(TARGET);
    reporter.captureError(
      new Error('render failed'),
      'react-error-boundary',
      '\n    at RoomTimeline (https://chat.example.org/assets/index-B9x8Z2Ab.js:3:4)\n    at div'
    );
    expect(reports()[0]?.extra?.component_stack).toBe(
      'at RoomTimeline (https://chat.example.org/assets/index-B9x8Z2Ab.js:3:4) at div'
    );
  });

  it('records navigation as route templates', () => {
    reporter.startReporter(TARGET, { pathname: '/home/', search: '' });
    reporter.noteRoute(ROOM_PATH, '?threadId=%24Ev3ntIdAbCdEfGhIjKl');
    reporter.captureError(new Error('after navigating'), 'onerror');
    expect(reports()[0]?.breadcrumbs?.values).toContainEqual(
      expect.objectContaining({
        category: 'navigation',
        data: { from: '/home/', to: '/home/:roomIdOrAlias/:eventId?/?threadId=:eventId' },
      })
    );
  });

  it('posts to a tunnel on the app’s own origin as a keepalive request', () => {
    const tunnel = `${window.location.origin}/errors/envelope`;
    reporter.startReporter({ ...TARGET, url: tunnel });
    reporter.captureError(new Error('through the tunnel'), 'onerror');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(tunnel);
    expect(init?.keepalive).toBe(true);
    expect(new Headers(init?.headers).get('X-Sentry-Auth')).toContain('sentry_key=abc123');
    const [header, item, report] = envelopeLines(init?.body);
    expect(header).toMatchObject({ event_id: report.event_id, dsn: TARGET.dsn });
    expect(item).toEqual({ type: 'event' });
  });

  it('counts reports that do not arrive, warns once, and tells the next report', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
      .mockImplementationOnce(() =>
        Promise.resolve({ ok: false, status: 503, headers: new Headers() })
      );
    reporter.startReporter(TARGET);
    reporter.captureError(new Error('blocked by an extension'), 'onerror');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0]?.[0])).toContain('[error-reports]');
    reporter.captureError(new Error('the collector is down'), 'onerror');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(warn).toHaveBeenCalledTimes(1);

    reporter.captureError(new Error('this one arrives'), 'onerror');
    expect(reports()[2]?.breadcrumbs?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'report',
          level: 'warning',
          data: { state: 'failed', count: 1 },
        }),
        expect.objectContaining({
          category: 'report',
          level: 'warning',
          data: { state: 'failed', http_status: 503, count: 2 },
        }),
      ])
    );
    warn.mockRestore();
  });
});

describe('toEnvelope', () => {
  it('frames a report as an envelope header, one event item header and the event', () => {
    const report: ReportEvent = {
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: 1_700_000_000,
      platform: 'javascript',
      level: 'error',
      message: 'two\nlines',
    };
    const body = reporter.toEnvelope(
      report,
      'https://abc123@errors.example.org/1',
      new Date(Date.UTC(2026, 10, 5, 12))
    );
    expect(body).toBe(
      [
        '{"event_id":"0123456789abcdef0123456789abcdef","sent_at":"2026-11-05T12:00:00.000Z","dsn":"https://abc123@errors.example.org/1"}',
        '{"type":"event"}',
        JSON.stringify(report),
        '',
      ].join('\n')
    );
    expect(envelopeLines(body)[2]).toEqual(report);
  });
});

describe('watchClient', () => {
  it('reports entering the sync error state once, with its errcode and no token', () => {
    reporter.startReporter(TARGET);
    const { mx, stop } = watchFakeClient();
    const error = matrixError(
      'MatrixError: [401] Invalid token (https://matrix.example.org/_matrix/client/v3/sync?access_token=syt_c2VjcmV0_abcdefghij_123456)',
      'M_UNKNOWN_TOKEN',
      401
    );
    mx.emit(ClientEvent.Sync, SyncState.Error, SyncState.Syncing, { error });
    mx.emit(ClientEvent.Sync, SyncState.Error, SyncState.Error, { error });
    stop();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [report] = reports();
    expect(report?.message).toBe('Sync failed');
    expect(report?.tags).toMatchObject({
      source: 'sync',
      errcode: 'M_UNKNOWN_TOKEN',
      http_status: '401',
    });
    expect(report?.fingerprint).toEqual(['sync-failed', 'M_UNKNOWN_TOKEN']);
    expect(JSON.stringify(report)).not.toMatch(/syt_|access_token/);
  });

  it('counts messages that stay undecryptable by failure code, without their IDs', () => {
    vi.useFakeTimers();
    reporter.startReporter(TARGET);
    const { mx, stop } = watchFakeClient();
    const decrypted = (id: string, code: string | null) => ({
      getId: () => id,
      isDecryptionFailure: () => code !== null,
      decryptionFailureReason: code,
    });
    mx.emit(MatrixEventEvent.Decrypted, decrypted('$first', 'MEGOLM_UNKNOWN_INBOUND_SESSION_ID'));
    mx.emit(MatrixEventEvent.Decrypted, decrypted('$second', 'MEGOLM_UNKNOWN_INBOUND_SESSION_ID'));
    mx.emit(MatrixEventEvent.Decrypted, decrypted('$late', 'OLM_UNKNOWN_MESSAGE_INDEX'));
    // The keys of this one arrive before the minute is up.
    mx.emit(MatrixEventEvent.Decrypted, decrypted('$late', null));
    vi.advanceTimersByTime(90_000);
    stop();
    const sent = reports();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toBe('Messages could not be decrypted');
    expect(sent[0]?.tags?.decryption_code).toBe('MEGOLM_UNKNOWN_INBOUND_SESSION_ID');
    expect(sent[0]?.extra?.count).toBe(2);
    expect(JSON.stringify(sent)).not.toMatch(/\$first|\$second|\$late/);
  });

  it('reports a failed send with its errcode and event type, never the message', () => {
    reporter.startReporter(TARGET);
    const { mx, stop } = watchFakeClient();
    const event = {
      status: EventStatus.NOT_SENT,
      error: matrixError('MatrixError: [413] Too large', 'M_TOO_LARGE', 413),
      getType: () => 'm.room.message',
      getContent: () => ({ body: 'Meet me at the station at 5pm' }),
    };
    mx.emit(
      RoomEvent.LocalEchoUpdated,
      event,
      { name: 'Project Falcon' },
      '~1',
      EventStatus.SENDING
    );
    stop();
    const [report] = reports();
    expect(report?.message).toBe('A message could not be sent');
    expect(report?.tags).toMatchObject({
      source: 'send',
      errcode: 'M_TOO_LARGE',
      http_status: '413',
      event_type: 'm.room.message',
    });
    expect(JSON.stringify(report)).not.toMatch(/station|Falcon/);
  });
});
