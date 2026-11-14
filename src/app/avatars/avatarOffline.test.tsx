// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ClientEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../matrix/hooks/useSpecVersions';
import { UserAvatar } from './UserAvatar';
import { clearFetchedAvatars } from './avatarMedia';
import { avatarCacheKey } from '../../sw/avatarCache';

const HS = 'https://hs.test';
const AUTHED = `${HS}/_matrix/client/v1/media/thumbnail/hs.test/face?width=96&height=96&method=crop`;

// A page that no service worker controls fetches avatars itself, with the token.
const setUncontrolledPage = () =>
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: null },
  });

const makeClient = () =>
  Object.assign(new EventEmitter(), {
    getHomeserverUrl: () => HS,
    getAccessToken: () => 'token-1',
    getUserId: () => '@me:hs.test',
  }) as unknown as MatrixClient & EventEmitter;

describe('avatars while the homeserver is out of reach', () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();
  const kept = new Map<string, Response>();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    fetchMock.mockReset();
    kept.clear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', {
      open: async () => ({
        put: async (url: string, response: Response) => {
          kept.set(url, response);
        },
        match: async (url: string) => kept.get(url)?.clone(),
        keys: async () => [],
        delete: async () => false,
      }),
      delete: async () => {
        kept.clear();
        return true;
      },
    });
    URL.createObjectURL = vi.fn(() => 'blob:face');
    URL.revokeObjectURL = vi.fn();
    setUncontrolledPage();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    void clearFetchedAvatars();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    vi.unstubAllGlobals();
  });

  const image = () => container.querySelector('img');
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const render = (mx: MatrixClient) =>
    act(() =>
      root.render(
        <SpecVersionsProvider value={{ versions: ['v1.11'] }}>
          <MatrixClientProvider value={mx}>
            <UserAvatar
              userId="@friend:hs.test"
              src={AUTHED}
              alt="Friend"
              renderFallback={() => 'F'}
            />
          </MatrixClientProvider>
        </SpecVersionsProvider>
      )
    );

  it('shows the picture kept from an earlier load when the network fails', async () => {
    kept.set(avatarCacheKey(AUTHED), new Response(new Blob(['png']), { status: 200 }));
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(makeClient());
    await settle();

    expect(image()?.getAttribute('src')).toBe('blob:face');
  });

  it('keeps a loaded picture for later', async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(['png']), { status: 200 }));
    render(makeClient());
    await settle();

    expect(image()?.getAttribute('src')).toBe('blob:face');
    expect(kept.has(avatarCacheKey(AUTHED))).toBe(true);
  });

  it('tries a failed picture again once sync recovers', async () => {
    const mx = makeClient();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(mx);
    await settle();
    expect(image()).toBeNull();
    expect(container.textContent).toBe('F');

    fetchMock.mockResolvedValue(new Response(new Blob(['png']), { status: 200 }));
    act(() => {
      mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Error);
    });
    await settle();

    expect(image()?.getAttribute('src')).toBe('blob:face');
  });
});
