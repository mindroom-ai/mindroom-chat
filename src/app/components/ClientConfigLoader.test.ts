import { describe, expect, it, vi } from 'vitest';
import { fetchClientConfig } from './ClientConfigLoader';

describe('fetchClientConfig', () => {
  it('requests config.json from the provided base path', async () => {
    const json = vi.fn().mockResolvedValue({ ok: true });
    const fetchMock = vi.fn().mockResolvedValue({ json });
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      await fetchClientConfig('/mindroom');
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchMock).toHaveBeenCalledWith('/mindroom/config.json', { method: 'GET' });
  });
});
