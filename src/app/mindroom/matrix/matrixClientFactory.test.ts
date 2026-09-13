import { describe, expect, it, vi } from 'vitest';
import { createMatrixFetchFn } from './matrixClientFactory';

describe('createMatrixFetchFn', () => {
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
});
