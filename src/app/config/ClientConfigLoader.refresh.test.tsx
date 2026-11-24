import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import {
  ClientConfigLoader,
  fetchClientConfig,
  readCachedClientConfig,
} from './ClientConfigLoader';
import type { ClientConfig } from './useClientConfig';

// A configuration fetched while the cached one is on screen: operator switches apply on this load,
// while a change to how the app routes waits for the next one (ClientConfigLoader.test.ts).

const originalFetch = globalThis.fetch;

const storage = (): Storage => {
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

const answer = (config: ClientConfig): Response =>
  ({ ok: true, status: 200, type: 'basic', json: async () => config } as Response);

const cached: ClientConfig = {
  homeserverList: ['https://matrix.example.test'],
  mindroom: { canvas: { enabled: true } },
};

/** Renders the loader from `cached` with one router, as App does, and answers the refresh. */
const refreshWith = async (fresh: ClientConfig) => {
  globalThis.fetch = vi.fn().mockResolvedValue(answer(cached));
  await fetchClientConfig();
  let finish!: (value: Response) => void;
  globalThis.fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  const router = createMemoryRouter([{ path: '*', element: <span>Chats</span> }]);
  const rendered: ClientConfig[] = [];
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <ClientConfigLoader>
        {(config) => {
          rendered.push(config);
          return <RouterProvider router={router} />;
        }}
      </ClientConfigLoader>
    );
  });
  await act(async () => {
    await router.navigate('/room/thread');
  });
  await act(async () => finish(answer(fresh)));
  const result = {
    rendered,
    path: router.state.location.pathname,
    text: renderer.root.findByType('span').children,
  };
  act(() => renderer.unmount());
  router.dispose();
  return result;
};

beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a configuration refreshed during the page load', () => {
  it('applies a switch at once and keeps the route', async () => {
    const fresh = { ...cached, mindroom: { canvas: { enabled: false } } };
    const { rendered, path, text } = await refreshWith(fresh);
    expect(rendered).toEqual([cached, fresh]);
    expect(path).toBe('/room/thread');
    expect(text).toEqual(['Chats']);
    expect(readCachedClientConfig()).toEqual(fresh);
  });

  it('applies a new auto-open allowlist at once', async () => {
    const fresh = {
      ...cached,
      mindroom: { ...cached.mindroom, uiActions: { autoOpenFromHomeservers: ['example.test'] } },
    };
    expect((await refreshWith(fresh)).rendered).toEqual([cached, fresh]);
  });

  it('renders an unchanged configuration once', async () => {
    expect((await refreshWith({ ...cached })).rendered).toEqual([cached]);
  });

  it.each([
    ['the hash router', { hashRouter: { enabled: true } }],
    ['the Local MindRoom page', { sidebar: { showMindRoom: false } }],
  ])('keeps a change to %s, with everything else, for the next load', async (_name, routing) => {
    const fresh = { ...cached, ...routing, mindroom: { canvas: { enabled: false } } };
    const { rendered, path } = await refreshWith(fresh);
    expect(rendered).toEqual([cached]);
    expect(path).toBe('/room/thread');
    expect(readCachedClientConfig()).toEqual(fresh);
  });
});
