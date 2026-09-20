import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
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

describe('client configuration loading', () => {
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

  it.each([0, 401, 403])(
    'classifies authentication response %s as requiring sign-in',
    async (status) => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          response({ ok: false, status, type: status === 0 ? 'opaqueredirect' : 'basic' })
        );

      await expect(fetchClientConfig('/mindroom')).rejects.toBeInstanceOf(
        ClientConfigAuthenticationError
      );
    }
  );

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

  it('uses the last valid configuration when the user continues offline after an authentication error', async () => {
    const cachedConfig = { homeserverList: ['https://matrix.example.test'] };
    globalThis.fetch = vi.fn().mockResolvedValue(
      response({
        json: vi.fn().mockResolvedValue(cachedConfig),
      })
    );
    await fetchClientConfig();

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(response({ ok: false, status: 0, type: 'opaqueredirect' }));
    let continueOffline: (() => void) | undefined;
    let renderedConfig: unknown;
    let renderer!: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            error: (_error, _retry, ignore) => {
              continueOffline = ignore;
              return React.createElement('span', null, 'Sign in');
            },
          },
          (config) => {
            renderedConfig = config;
            return React.createElement('span', null, 'Cached chats');
          }
        )
      );
    });

    await vi.waitFor(() => expect(continueOffline).toBeTypeOf('function'));
    expect(renderer.root.findByType('span').children).toEqual(['Sign in']);
    act(() => continueOffline?.());

    expect(renderedConfig).toEqual(cachedConfig);
    expect(renderer.root.findByType('span').children).toEqual(['Cached chats']);
    act(() => renderer.unmount());
  });

  it('keeps the cached router and route mounted while refreshing configuration', async () => {
    const cachedConfig = { homeserverList: ['https://matrix.example.test'] };
    globalThis.fetch = vi.fn().mockResolvedValue(response({ json: async () => cachedConfig }));
    await fetchClientConfig();
    let finish!: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    const routers: ReturnType<typeof createMemoryRouter>[] = [];
    const renderedConfigs: unknown[] = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            fallback: () => React.createElement('span', null, 'Loading'),
          },
          (config) => {
            renderedConfigs.push(config);
            const router = createMemoryRouter([
              { path: '*', element: React.createElement('span', null, 'Chats') },
            ]);
            routers.push(router);
            return React.createElement(RouterProvider, { router });
          }
        )
      );
    });
    try {
      expect(renderer.root.findByType('span').children).toEqual(['Chats']);
      expect(routers).toHaveLength(1);
      await act(async () => {
        await routers[0].navigate('/room/thread');
      });
      const refreshedConfig = { ...cachedConfig, hashRouter: true };
      await act(async () => finish(response({ json: async () => refreshedConfig })));
      expect(routers).toHaveLength(1);
      expect(routers[0].state.location.pathname).toBe('/room/thread');
      expect(renderedConfigs).toEqual([cachedConfig]);
      expect(readCachedClientConfig()).toEqual(refreshedConfig);
    } finally {
      act(() => renderer.unmount());
      routers.forEach((router) => router.dispose());
    }
  });

  it.each(['offline', 'server', 'invalid'] as const)(
    'keeps cached startup usable after a background %s failure',
    async (failure) => {
      const cachedConfig = { homeserverList: ['https://matrix.example.test'] };
      globalThis.fetch = vi.fn().mockResolvedValue(response({ json: async () => cachedConfig }));
      await fetchClientConfig();
      globalThis.fetch =
        failure === 'offline'
          ? vi.fn().mockRejectedValue(new TypeError('offline'))
          : vi
              .fn()
              .mockResolvedValue(
                failure === 'server'
                  ? response({ ok: false, status: 503 })
                  : response({ json: async () => [] })
              );
      let renderer!: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(
          React.createElement(
            ClientConfigLoader,
            {
              fallback: () => React.createElement('span', null, 'Loading'),
              error: () => React.createElement('span', null, 'Error'),
            },
            (config) => React.createElement('span', null, config.homeserverList?.[0])
          )
        );
      });
      expect(renderer.root.findByType('span').children).toEqual(['https://matrix.example.test']);
      expect(readCachedClientConfig()).toEqual(cachedConfig);
      act(() => renderer.unmount());
    }
  );

  it('waits for explicit authentication recovery before showing cached content again', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(response({ json: async () => ({ hashRouter: true }) }));
    await fetchClientConfig();
    let finish!: (value: Response) => void;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: false, status: 0, type: 'opaqueredirect' }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          })
      );
    let retry!: () => void;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            fallback: () => React.createElement('span', null, 'Loading'),
            error: (_error, retryRequest) => {
              retry = retryRequest;
              return React.createElement('span', null, 'Sign in');
            },
          },
          (config) =>
            React.createElement('span', null, config.hashRouter ? 'Cached chats' : 'Fresh chats')
        )
      );
    });
    expect(renderer.root.findByType('span').children).toEqual(['Sign in']);
    await act(async () => retry());
    expect(renderer.root.findByType('span').children).toEqual(['Loading']);
    await act(async () => finish(response()));
    expect(renderer.root.findByType('span').children).toEqual(['Fresh chats']);
    act(() => renderer.unmount());
  });

  it('keeps the loading screen on first launch until fresh configuration is available', async () => {
    let finish!: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ClientConfigLoader,
          {
            fallback: () => React.createElement('span', null, 'Loading'),
          },
          (config) => React.createElement('span', null, config.homeserverList?.[0])
        )
      );
    });
    expect(renderer.root.findByType('span').children).toEqual(['Loading']);
    await act(async () =>
      finish(response({ json: async () => ({ homeserverList: ['https://new.example'] }) }))
    );
    expect(renderer.root.findByType('span').children).toEqual(['https://new.example']);
    act(() => renderer.unmount());
  });

  it('does not offer offline continuation without a cached configuration', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    let errorRendered = false;
    let continueOffline: (() => void) | undefined;

    await act(async () => {
      create(
        React.createElement(
          ClientConfigLoader,
          {
            error: (_error, _retry, ignore) => {
              errorRendered = true;
              continueOffline = ignore;
              return null;
            },
          },
          () => null
        )
      );
    });

    await vi.waitFor(() => expect(errorRendered).toBe(true));
    expect(continueOffline).toBeUndefined();
  });

  it('uses a document reload for interactive authentication', () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });

    reloadForInteractiveAuthentication();

    expect(reload).toHaveBeenCalledOnce();
  });
});
