import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authenticatedAvatarRequest,
  avatarNeedsFetch,
  canFetchAvatar,
  clearFetchedAvatars,
  fetchAvatar,
  peekFetchedAvatar,
  toAuthenticatedAvatarUrl,
} from './avatarMedia';

const HS = 'https://hs.test';
const LEGACY = `${HS}/_matrix/media/v3/thumbnail/hs.test/abc?width=96&height=96&method=crop`;
const AUTHED = `${HS}/_matrix/client/v1/media/thumbnail/hs.test/abc?width=96&height=96&method=crop`;

const client = (userId = '@alice:hs.test', homeserver = HS, token = 'secret-token') => ({
  getHomeserverUrl: () => homeserver,
  getAccessToken: () => token,
  getUserId: () => userId,
});

describe('toAuthenticatedAvatarUrl', () => {
  it('moves a legacy thumbnail to the authenticated endpoint and keeps its query', () => {
    expect(toAuthenticatedAvatarUrl(client(), LEGACY)).toBe(AUTHED);
    expect(toAuthenticatedAvatarUrl(client(), AUTHED)).toBe(AUTHED);
    expect(toAuthenticatedAvatarUrl(client(), `${HS}/_matrix/media/r0/download/hs.test/abc`)).toBe(
      `${HS}/_matrix/client/v1/media/download/hs.test/abc`
    );
  });

  it('keeps the base path of a homeserver served under a path', () => {
    const mx = client('@alice:hs.test', `${HS}/matrix/`);
    expect(toAuthenticatedAvatarUrl(mx, `${HS}/matrix/_matrix/media/v3/download/hs.test/abc`)).toBe(
      `${HS}/matrix/_matrix/client/v1/media/download/hs.test/abc`
    );
    expect(toAuthenticatedAvatarUrl(mx, `${HS}/_matrix/media/v3/download/hs.test/abc`)).toBe(
      undefined
    );
  });

  it('leaves other origins, other endpoints and traversing paths alone', () => {
    expect(toAuthenticatedAvatarUrl(client(), LEGACY.replace(HS, 'https://evil.test'))).toBe(
      undefined
    );
    expect(toAuthenticatedAvatarUrl(client(), `${HS}/_matrix/media/v3/config`)).toBe(undefined);
    expect(toAuthenticatedAvatarUrl(client(), `${HS}/_matrix/media/v3/thumbnail/../config`)).toBe(
      undefined
    );
    expect(toAuthenticatedAvatarUrl(client(), `${HS}/avatars/abc.png`)).toBe(undefined);
    expect(toAuthenticatedAvatarUrl(client(), 'blob:https://app.test/1')).toBe(undefined);
  });
});

describe('authenticatedAvatarRequest', () => {
  it('asks the authenticated endpoint with the token in a header', () => {
    expect(authenticatedAvatarRequest(client(), LEGACY)).toEqual({
      url: AUTHED,
      init: { headers: { Authorization: 'Bearer secret-token' } },
    });
  });

  it('has no request for foreign media or a signed-out client', () => {
    expect(authenticatedAvatarRequest(client(), 'https://evil.test/a.png')).toBe(undefined);
    expect(authenticatedAvatarRequest(client('@a:hs.test', HS, ''), LEGACY)).toBe(undefined);
  });
});

describe('avatarNeedsFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  const withWorker = (controller: object | null) =>
    vi.stubGlobal('navigator', { serviceWorker: { controller } });

  it('fetches authenticated media at once on a page no service worker controls', () => {
    withWorker(null);
    expect(avatarNeedsFetch(client(), AUTHED, { versions: [] })).toBe(true);
    expect(avatarNeedsFetch(client(), `${AUTHED}&access_token=t`, { versions: [] })).toBe(false);
  });

  it('fetches legacy media at once only when the server has authenticated media', () => {
    withWorker(null);
    expect(avatarNeedsFetch(client(), LEGACY, { versions: ['v1.10'] })).toBe(false);
    expect(avatarNeedsFetch(client(), LEGACY, { versions: ['v1.11'] })).toBe(true);
  });

  it('lets the image load by itself while a service worker controls the page', () => {
    withWorker({});
    expect(avatarNeedsFetch(client(), AUTHED, { versions: ['v1.11'] })).toBe(false);
  });

  it('lets the image try first where there is no service worker API', () => {
    vi.stubGlobal('navigator', {});
    expect(avatarNeedsFetch(client(), AUTHED, { versions: ['v1.11'] })).toBe(false);
    expect(canFetchAvatar(client(), AUTHED)).toBe(true);
    expect(canFetchAvatar(client(), 'https://evil.test/_matrix/client/v1/media/download/x/y')).toBe(
      false
    );
  });
});

describe('fetchAvatar', () => {
  let objectUrls: number;
  const fetchMock = vi.fn();

  beforeEach(() => {
    objectUrls = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(new Blob(['png']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      objectUrls += 1;
      return `blob:avatar-${objectUrls}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    void clearFetchedAvatars();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads with the token in a header from the authenticated endpoint', async () => {
    const objectUrl = await fetchAvatar(client(), LEGACY);

    expect(objectUrl).toBe('blob:avatar-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(AUTHED, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(peekFetchedAvatar(client(), AUTHED)).toBe('blob:avatar-1');
  });

  it('gives the object URL a safe type, never one that runs script in the app origin', async () => {
    const types: string[] = [];
    vi.mocked(URL.createObjectURL).mockImplementation((blob) => {
      types.push((blob as Blob).type);
      return `blob:avatar-${types.length}`;
    });
    const served = (type: string) => async () =>
      new Response(new Blob(['<svg onload="alert(1)"/>'], { type }), { status: 200 });

    fetchMock.mockImplementationOnce(served('image/svg+xml'));
    await fetchAvatar(client('@a:hs.test'), AUTHED);
    fetchMock.mockImplementationOnce(served('text/html'));
    await fetchAvatar(client('@b:hs.test'), AUTHED);
    fetchMock.mockImplementationOnce(served('image/png'));
    await fetchAvatar(client('@c:hs.test'), AUTHED);

    expect(types).toEqual(['application/octet-stream', 'application/octet-stream', 'image/png']);
  });

  it('shares one download between concurrent requests of one account', async () => {
    const [first, second] = await Promise.all([
      fetchAvatar(client(), LEGACY),
      fetchAvatar(client(), AUTHED),
    ]);

    expect(first).toBe('blob:avatar-1');
    expect(second).toBe('blob:avatar-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the images of each account apart', async () => {
    await fetchAvatar(client('@alice:hs.test'), AUTHED);
    expect(peekFetchedAvatar(client('@bob:hs.test'), AUTHED)).toBe(undefined);

    await fetchAvatar(client('@bob:hs.test', HS, 'bob-token'), AUTHED);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(AUTHED, {
      headers: { Authorization: 'Bearer bob-token' },
    });
  });

  it('asks again after a refusal instead of remembering it', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 404 }));

    expect(await fetchAvatar(client(), AUTHED)).toBe(undefined);
    expect(await fetchAvatar(client(), AUTHED)).toBe('blob:avatar-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never sends the token anywhere but the homeserver media endpoints', async () => {
    expect(await fetchAvatar(client(), 'https://evil.test/_matrix/client/v1/media/x/y')).toBe(
      undefined
    );
    expect(await fetchAvatar(client(), `${HS}/_matrix/media/v3/thumbnail/../config`)).toBe(
      undefined
    );
    expect(await fetchAvatar(client('@a:hs.test', HS, ''), AUTHED)).toBe(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops only the images of an account that signs out', async () => {
    await fetchAvatar(client('@alice:hs.test'), AUTHED);
    await fetchAvatar(client('@bob:hs.test', HS, 'bob-token'), AUTHED);

    void clearFetchedAvatars('@alice:hs.test');

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1');
    expect(peekFetchedAvatar(client('@alice:hs.test'), AUTHED)).toBe(undefined);
    expect(peekFetchedAvatar(client('@bob:hs.test'), AUTHED)).toBe('blob:avatar-2');
  });

  it('does not keep a download that finishes after its account signed out', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    const pending = fetchAvatar(client(), AUTHED);
    void clearFetchedAvatars('@alice:hs.test');
    finish(new Response(new Blob(['png']), { status: 200 }));

    expect(await pending).toBe('blob:avatar-1');
    expect(peekFetchedAvatar(client(), AUTHED)).toBe(undefined);
  });

  it('revokes the least recently used image once the cache is full', async () => {
    const url = (n: number) => `${AUTHED}&n=${n}`;
    for (let n = 0; n < 300; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fetchAvatar(client(), url(n));
    }
    // Showing the first image again makes the second the oldest one.
    expect(peekFetchedAvatar(client(), url(0))).toBe('blob:avatar-1');
    await fetchAvatar(client(), url(300));

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-2');
    expect(peekFetchedAvatar(client(), url(1))).toBe(undefined);
    expect(peekFetchedAvatar(client(), url(0))).toBe('blob:avatar-1');
  });
});
