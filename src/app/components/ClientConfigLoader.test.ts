import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClientConfigAuthenticationError,
  ClientConfigLoader,
  fetchClientConfig,
  readCachedClientConfig,
  reloadForInteractiveAuthentication,
} from './ClientConfigLoader';

const originalFetch = globalThis.fetch;

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

const response = (overrides: Partial<Response> = {}): Response =>
  ({
    ok: true,
    status: 200,
    type: 'basic',
    json: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as Response);

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage());
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
});

describe('fetchClientConfig', () => {
  it('requests config.json from the provided base path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchClientConfig('/mindroom');

    expect(fetchMock).toHaveBeenCalledWith('/mindroom/config.json', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
  });

  it('classifies a manual redirect as requiring interactive sign-in', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(response({ ok: false, status: 0, type: 'opaqueredirect' }));

    await expect(fetchClientConfig('/mindroom')).rejects.toBeInstanceOf(
      ClientConfigAuthenticationError
    );
  });

  it('rejects unsuccessful HTTP responses before parsing JSON', async () => {
    const json = vi.fn();
    globalThis.fetch = vi.fn().mockResolvedValue(response({ ok: false, status: 503, json }));

    await expect(fetchClientConfig('/mindroom')).rejects.toThrow(
      'Failed to load client configuration (HTTP 503).'
    );
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects malformed configuration without caching it', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        json: vi.fn().mockResolvedValue([]),
      })
    );

    await expect(fetchClientConfig('/mindroom')).rejects.toThrow(
      'Client configuration must be a JSON object.'
    );
    expect(readCachedClientConfig('/mindroom')).toBeUndefined();
  });

  it('caches the last valid configuration by base path', async () => {
    const config = { homeserverList: ['https://matrix.example.test'] };
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        json: vi.fn().mockResolvedValue(config),
      })
    );

    await fetchClientConfig('/mindroom');

    expect(readCachedClientConfig('/mindroom')).toEqual(config);
    expect(readCachedClientConfig('/other-app')).toBeUndefined();
  });

  it('uses the last valid configuration when the user continues offline', async () => {
    const cachedConfig = { homeserverList: ['https://matrix.example.test'] };
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        json: vi.fn().mockResolvedValue(cachedConfig),
      })
    );
    await fetchClientConfig();

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    let continueOffline: (() => void) | undefined;
    let renderedConfig: unknown;

    await act(async () => {
      create(
        React.createElement(
          ClientConfigLoader,
          {
            error: (_error, _retry, ignore) => {
              continueOffline = ignore;
              return null;
            },
          },
          (config) => {
            renderedConfig = config;
            return null;
          }
        )
      );
    });

    await vi.waitFor(() => expect(continueOffline).toBeTypeOf('function'));
    act(() => continueOffline?.());

    expect(renderedConfig).toEqual(cachedConfig);
  });

  it('uses a document reload for interactive authentication', () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });

    reloadForInteractiveAuthentication();

    expect(reload).toHaveBeenCalledOnce();
  });
});
