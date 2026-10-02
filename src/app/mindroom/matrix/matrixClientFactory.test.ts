import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  traceDeepDiagnosticFetch: vi.fn(
    (baseFetch: typeof globalThis.fetch, input: RequestInfo | URL, init?: RequestInit) =>
      baseFetch(input, init)
  ),
}));

vi.mock('../diagnostics/deepTrace', () => ({
  traceDeepDiagnosticFetch: mocks.traceDeepDiagnosticFetch,
}));

import { createMatrixClient, createMatrixFetchFn } from './matrixClientFactory';
import { getHomeserverReachability, HOMESERVER_CHECK_TIMEOUT_MS } from './homeserverReachability';

describe('createMatrixFetchFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds credentials for same-origin requests', async () => {
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const originalLocation = (globalThis as { location?: Location }).location;

    try {
      (globalThis as { location?: Location }).location = {
        origin: 'https://example.com',
      } as Location;

      const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);
      await fetchFn('/_matrix/client', { method: 'GET' });
    } finally {
      (globalThis as { location?: Location }).location = originalLocation;
    }

    expect(baseFetch).toHaveBeenCalledWith('/_matrix/client', {
      method: 'GET',
      credentials: 'include',
    });
  });

  it('does not add credentials for cross-origin requests', async () => {
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const originalLocation = (globalThis as { location?: Location }).location;

    try {
      (globalThis as { location?: Location }).location = {
        origin: 'https://example.com',
      } as Location;

      const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);
      await fetchFn('https://other.example.com/_matrix/client', { method: 'GET' });
    } finally {
      (globalThis as { location?: Location }).location = originalLocation;
    }

    expect(baseFetch).toHaveBeenCalledWith('https://other.example.com/_matrix/client', {
      method: 'GET',
    });
  });

  it('keeps a captured Matrix delegate routed through dynamic tracing', async () => {
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);

    await fetchFn('https://matrix.example/_matrix/client/v3/sync');
    await fetchFn('https://matrix.example/_matrix/client/v3/sync');
    await fetchFn('https://matrix.example/_matrix/client/v3/sync');

    expect(mocks.traceDeepDiagnosticFetch).toHaveBeenCalledTimes(3);
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });
});

describe('createMatrixClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks whether its requests reach the homeserver', async () => {
    vi.useFakeTimers();
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const mx = createMatrixClient({
      baseUrl: 'https://matrix.example',
      accessToken: 'token',
      userId: '@alice:matrix.example',
      fetchFn: baseFetch as unknown as typeof fetch,
    });

    await expect(mx.sendTyping('!room:matrix.example', true, 1000)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS);
    expect(getHomeserverReachability(mx)?.isUnreachable()).toBe(true);

    await mx.sendTyping('!room:matrix.example', false, 0);
    expect(getHomeserverReachability(mx)?.isUnreachable()).toBe(false);
  });
});
