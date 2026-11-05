// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

type Gate = typeof import('./errorReporting');

const DSN = 'https://abc123@errors.example.org/7';

let gate: Gate;
const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
  Promise.resolve({ status: 200, headers: new Headers() })
);

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
  it('turns a DSN into its store endpoint', () => {
    expect(gate.parseDsn(DSN)).toEqual({
      endpoint: 'https://errors.example.org/api/7/store/?sentry_key=abc123&sentry_version=7',
      host: 'errors.example.org',
    });
    expect(gate.parseDsn('https://abc123@example.org/errors/7/')?.endpoint).toBe(
      'https://example.org/errors/api/7/store/?sentry_key=abc123&sentry_version=7'
    );
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
    expect(await gate.configureErrorReporting(DSN, true)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://errors.example.org/api/7/store/?sentry_key=abc123&sentry_version=7'
    );
    expect(String(fetchMock.mock.calls[0]?.[1].body)).toContain('failed at startup');
  });

  it('drops them and loads nothing without a DSN or with the setting off', async () => {
    gate.installErrorCapture();
    failEarly();
    expect(await gate.configureErrorReporting(undefined, true)).toBeUndefined();
    expect(await gate.configureErrorReporting(DSN, false)).toBeUndefined();
    failEarly();
    gate.reportBoundaryError(new Error('render failed'), '\n    at Room');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
