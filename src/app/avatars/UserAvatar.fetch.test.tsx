// @vitest-environment jsdom
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../matrix/hooks/useSpecVersions';
import { RoomAvatar } from './RoomAvatar';
import { UserAvatar } from './UserAvatar';
import { clearFetchedAvatars } from './avatarMedia';

const HS = 'https://hs.test';
const LEGACY = `${HS}/_matrix/media/v3/thumbnail/hs.test/face?width=96&height=96&method=crop`;
const AUTHED = `${HS}/_matrix/client/v1/media/thumbnail/hs.test/face?width=96&height=96&method=crop`;

const mx = {
  getHomeserverUrl: () => HS,
  getAccessToken: () => 'token-1',
  getUserId: () => '@me:hs.test',
} as unknown as MatrixClient;

const setServiceWorker = (controller: object | null | undefined) => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: controller === undefined ? undefined : { controller },
  });
};

describe('avatars that need the access token', () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(new Blob(['png']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:face');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    void clearFetchedAvatars();
    setServiceWorker(undefined);
    vi.unstubAllGlobals();
  });

  const image = () => container.querySelector('img');
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  const render = (node: React.ReactNode, withClient = true, versions = ['v1.11']) =>
    act(() =>
      root.render(
        <SpecVersionsProvider value={{ versions }}>
          {withClient ? <MatrixClientProvider value={mx}>{node}</MatrixClientProvider> : node}
        </SpecVersionsProvider>
      )
    );

  const user = (src: string) => (
    <UserAvatar userId="@friend:hs.test" src={src} alt="Friend" renderFallback={() => 'F'} />
  );

  it('fetches authenticated media at once when no service worker controls the page', async () => {
    setServiceWorker(null);
    render(user(AUTHED));

    // The initial stays until the picture arrives; the URL itself is never handed to the img.
    expect(image()).toBeNull();
    expect(container.textContent).toBe('F');
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(AUTHED, {
      headers: { Authorization: 'Bearer token-1' },
    });
    expect(image()?.getAttribute('src')).toBe('blob:face');
  });

  it('loads straight from the URL while a service worker adds the token', () => {
    setServiceWorker({});
    render(user(AUTHED));

    expect(image()?.getAttribute('src')).toBe(AUTHED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a refused legacy URL on the authenticated endpoint', async () => {
    setServiceWorker({});
    render(user(LEGACY));
    expect(image()?.getAttribute('src')).toBe(LEGACY);

    act(() => {
      image()?.dispatchEvent(new Event('error'));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(AUTHED, expect.anything());
    expect(image()?.getAttribute('src')).toBe('blob:face');
  });

  it('shows the fallback when the fetched picture is refused too', async () => {
    setServiceWorker(null);
    fetchMock.mockImplementation(async () => new Response('', { status: 403 }));
    render(user(AUTHED));
    await settle();

    expect(image()).toBeNull();
    expect(container.textContent).toBe('F');
  });

  it('shows the fallback when a fetched picture does not decode', async () => {
    setServiceWorker(null);
    render(user(AUTHED));
    await settle();

    act(() => {
      image()?.dispatchEvent(new Event('error'));
    });
    expect(image()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps media of other servers and pages without a client on the plain path', () => {
    setServiceWorker(null);
    const elsewhere = 'https://cdn.test/face.png';
    render(user(elsewhere));
    act(() => {
      image()?.dispatchEvent(new Event('error'));
    });
    expect(image()).toBeNull();

    render(user(AUTHED), false);
    expect(image()?.getAttribute('src')).toBe(AUTHED);
    act(() => {
      image()?.dispatchEvent(new Event('error'));
    });
    expect(image()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads room avatars the same way', async () => {
    setServiceWorker(null);
    render(
      <RoomAvatar roomId="!room:hs.test" src={LEGACY} alt="Room" renderFallback={() => '#'} />
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(AUTHED, expect.anything());
    expect(image()?.getAttribute('src')).toBe('blob:face');
  });
});
