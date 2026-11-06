import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canUseServerThumbnail, loadServerScaledPicture } from './serverThumbnail';

const mocks = vi.hoisted(() => ({ savedMetadata: vi.fn() }));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  getCachedAttachmentCacheMetadata: mocks.savedMetadata,
}));

const HOMESERVER = 'https://matrix.example';

// The SDK's URL builder: a size makes it the thumbnail endpoint.
const mx = {
  getVersions: async () => ({ versions: ['v1.11'] }),
  getHomeserverUrl: () => HOMESERVER,
  getAccessToken: () => 'secret-token',
  mxcUrlToHttp: (mxc: string, width?: number, height?: number, method?: string) => {
    const [server, id] = mxc.slice('mxc://'.length).split('/');
    const path = width ? 'thumbnail' : 'download';
    const size = width ? `?width=${width}&height=${height}&method=${method}` : '';
    return `${HOMESERVER}/_matrix/client/v1/media/${path}/${server}/${id}${size}`;
  },
} as unknown as MatrixClient;

describe('loadServerScaledPicture', () => {
  const loadOriginal = vi.fn(async () => 'blob:original');
  let fetchMock: ReturnType<typeof vi.fn>;
  let blobs: Blob[];

  beforeEach(() => {
    mocks.savedMetadata.mockReset().mockResolvedValue(undefined);
    loadOriginal.mockClear();
    blobs = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:scaled';
    });
    fetchMock = vi.fn(
      async () => new Response(new Blob(['scaled'], { type: 'image/png' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks the homeserver for a scaled copy, with the access token', async () => {
    await expect(loadServerScaledPicture(mx, 'mxc://example/photo', loadOriginal)).resolves.toBe(
      'blob:scaled'
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${HOMESERVER}/_matrix/client/v1/media/thumbnail/example/photo?width=800&height=600&method=scale`
    );
    expect(init.headers).toEqual({ Authorization: 'Bearer secret-token' });
    expect(blobs[0]?.type).toBe('image/png');
    expect(loadOriginal).not.toHaveBeenCalled();
  });

  it('shows an original this device saved, without the network', async () => {
    mocks.savedMetadata.mockResolvedValue({ mxcUri: 'mxc://example/photo' });

    await expect(loadServerScaledPicture(mx, 'mxc://example/photo', loadOriginal)).resolves.toBe(
      'blob:original'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the original when the homeserver cannot scale it', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));

    await expect(loadServerScaledPicture(mx, 'mxc://example/photo', loadOriginal)).resolves.toBe(
      'blob:original'
    );
  });

  it('never gives a scaled copy a type the browser would run', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Blob(['<svg/>'], { type: 'image/svg+xml' }), { status: 200 })
    );

    await loadServerScaledPicture(mx, 'mxc://example/photo', loadOriginal);
    expect(blobs[0]?.type).toBe('application/octet-stream');
  });
});

describe('canUseServerThumbnail', () => {
  it.each([
    ['image/png', false, true],
    ['image/jpeg', false, true],
    ['image/png', true, false],
    ['image/gif', false, false],
    ['image/svg+xml', false, false],
    [undefined, false, false],
  ])('%s (encrypted: %s) is scaled by the homeserver: %s', (mimeType, encrypted, expected) => {
    expect(canUseServerThumbnail(mimeType, encrypted)).toBe(expected);
  });
});
