import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  traceDeepDiagnosticFetch: vi.fn(
    (baseFetch: typeof globalThis.fetch, input: RequestInfo | URL, init?: RequestInit) =>
      baseFetch(input, init)
  ),
}));

vi.mock('../diagnostics/deepTrace', () => ({
  traceDeepDiagnosticFetch: mocks.traceDeepDiagnosticFetch,
}));

import { createMatrixFetchFn } from './matrixClientFactory';

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
