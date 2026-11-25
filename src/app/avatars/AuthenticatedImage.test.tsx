// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { createClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../matrix/hooks/useSpecVersions';
import { ModelIcon } from '../models/ModelIcon';
import { PackAvatar } from '../emoji/packs/PackMetaEditor';
import { AuthenticatedImage } from './AuthenticatedImage';
import { clearFetchedAvatars } from './avatarMedia';

const HS = 'https://hs.test';
const mx = createClient({
  baseUrl: HS,
  userId: '@me:hs.test',
  accessToken: 'cap-token',
});

describe('authenticated image rendering on Capacitor', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;
  let blobCount: number;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    blobCount = 0;
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    fetchMock = vi.fn(async () => new Response(new Blob(['png']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      blobCount += 1;
      return `blob:cap-${blobCount}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    void clearFetchedAvatars();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  const renderWithProviders = (node: React.ReactNode) =>
    act(() =>
      root.render(
        <SpecVersionsProvider value={{ versions: ['v1.11'] }}>
          <MatrixClientProvider value={mx}>{node}</MatrixClientProvider>
        </SpecVersionsProvider>
      )
    );

  it('fetches AuthenticatedImage with Authorization Bearer outside MatrixClientProvider using explicit client', async () => {
    const src = `${HS}/_matrix/client/v1/media/download/hs.test/sticker`;
    act(() =>
      root.render(
        <SpecVersionsProvider value={{ versions: ['v1.11'] }}>
          <AuthenticatedImage client={mx} src={src} alt="sticker" />
        </SpecVersionsProvider>
      )
    );

    expect(container.querySelector('img')).toBeNull();
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(src, {
      headers: { Authorization: 'Bearer cap-token' },
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:cap-1');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('sticker');
  });

  it('shows provider fallback while fetching ModelIcon and swaps to the fetched object URL', async () => {
    renderWithProviders(
      <ModelIcon provider="OpenAI" id="fast-model" iconUrl="mxc://hs.test/model-icon" size={24} />
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/_matrix/client/v1/media/thumbnail/hs.test/model-icon');
    expect(url).not.toContain('access_token');
    expect(init).toEqual({ headers: { Authorization: 'Bearer cap-token' } });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:cap-1');
  });

  it('shows PackAvatar fallback while fetching and renders AvatarImage once resolved', async () => {
    renderWithProviders(<PackAvatar mxc="mxc://hs.test/pack-avatar" name="Birds" size="400" />);

    expect(container.querySelector('img')).toBeNull();
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/_matrix/client/v1/media/thumbnail/hs.test/pack-avatar');
    expect(url).not.toContain('access_token');
    expect(init).toEqual({ headers: { Authorization: 'Bearer cap-token' } });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:cap-1');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Birds');
  });
});
