// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

type Gate = typeof import('./errorReporting');

const DSN = 'https://abc123@errors.example.org/7';

let gate: Gate;
const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
  Promise.resolve({ ok: true, status: 200, headers: new Headers() })
);

/** The event an envelope carries: its third line. */
const eventOf = (init: RequestInit | undefined) =>
  JSON.parse(String(init?.body).split('\n')[2] ?? '') as {
    environment?: string;
    exception?: { values: { value: string }[] };
  };

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  gate = await import('./errorReporting');
});

afterEach(async () => {
  await gate.configureErrorReporting(undefined, false);
  vi.unstubAllGlobals();
});

// The reporter chunk loads on the first configuration; load it before that test's timeout runs.
importBeforeTests(() => import('./reporter'));

describe('parseDsn', () => {
  it('turns a DSN into its envelope endpoint, with the key kept out of the address', () => {
    expect(gate.parseDsn(DSN)).toEqual({
      dsn: DSN,
      endpoint: 'https://errors.example.org/api/7/envelope/',
      key: 'abc123',
      host: 'errors.example.org',
    });
    expect(gate.parseDsn(' https://abc123:legacy-secret@example.org/errors/7/ ')).toEqual({
      dsn: 'https://abc123@example.org/errors/7',
      endpoint: 'https://example.org/errors/api/7/envelope/',
      key: 'abc123',
      host: 'example.org',
    });
  });

  it.each([
    ['plain HTTP', 'http://abc123@errors.example.org/7'],
    ['no public key', 'https://errors.example.org/7'],
    ['no project', 'https://abc123@errors.example.org/'],
    ['not a URL', 'abc123@errors.example.org/7'],
    ['not a string', 7],
  ])('refuses %s', (_name, dsn) => {
    expect(gate.parseDsn(dsn)).toBeUndefined();
  });
});

describe('tunnelUrl', () => {
  const origin = 'https://chat.example.org';

  it('resolves a path, or an address, on the app’s own origin', () => {
    expect(gate.tunnelUrl('/errors/envelope', origin)).toBe(
      'https://chat.example.org/errors/envelope'
    );
    expect(gate.tunnelUrl(' https://chat.example.org/base/errors ', origin)).toBe(
      'https://chat.example.org/base/errors'
    );
  });

  it.each([
    ['another origin', 'https://errors.example.org/api/7/envelope/'],
    ['a protocol-relative address', '//errors.example.org/errors/envelope'],
    ['another scheme', 'http://chat.example.org/errors/envelope'],
    ['a script address', 'javascript:alert(1)'],
    ['an empty value', '  '],
    ['not a string', ['/errors/envelope']],
  ])('refuses %s', (_name, tunnel) => {
    expect(gate.tunnelUrl(tunnel, origin)).toBeUndefined();
  });
});

describe('configureErrorReporting', () => {
  const failEarly = () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('failed at startup'),
        message: 'failed at startup',
      })
    );
  };

  it('sends the failures from before the configuration once it names a collector', async () => {
    gate.installErrorCapture();
    failEarly();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await gate.configureErrorReporting({ dsn: DSN }, true)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://errors.example.org/api/7/envelope/');
    expect(new Headers(init?.headers).get('X-Sentry-Auth')).toContain('sentry_key=abc123');
    const event = eventOf(init);
    expect(event.exception?.values[0]?.value).toBe('failed at startup');
    expect(event.environment).toBe(window.location.hostname);
  });

  it('posts through the tunnel, with the configured environment', async () => {
    const reporter = await gate.configureErrorReporting(
      { dsn: DSN, tunnel: '/errors/envelope', environment: 'lab' },
      true
    );
    reporter?.captureError(new Error('through the tunnel'), 'onerror');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${window.location.origin}/errors/envelope`);
    expect(init?.keepalive).toBe(true);
    expect(new Headers(init?.headers).get('X-Sentry-Auth')).toContain('sentry_key=abc123');
    expect(eventOf(init).environment).toBe('lab');
  });

  it('drops them and loads nothing without a DSN or with the setting off', async () => {
    gate.installErrorCapture();
    failEarly();
    expect(await gate.configureErrorReporting(undefined, true)).toBeUndefined();
    expect(
      await gate.configureErrorReporting({ dsn: DSN, tunnel: '/errors/envelope' }, false)
    ).toBeUndefined();
    failEarly();
    gate.reportBoundaryError(new Error('render failed'), '\n    at Room');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
