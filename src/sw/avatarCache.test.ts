import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  avatarCacheKey,
  forgetAvatars,
  isAvatarThumbnailUrl,
  MAX_CACHED_AVATARS,
  recallAvatar,
  rememberAvatar,
} from './avatarCache';

const HS = 'https://hs.test';
const avatar = (id: string, size = 96) =>
  `${HS}/_matrix/client/v1/media/thumbnail/hs.test/${id}?width=${size}&height=${size}&method=crop`;

/** An in-memory CacheStorage with one cache, enough for these helpers. */
const makeCaches = () => {
  const entries = new Map<string, Response>();
  const cache = {
    put: vi.fn(async (url: string, response: Response) => {
      entries.delete(url);
      entries.set(url, response);
    }),
    match: vi.fn(async (url: string) => entries.get(url)?.clone()),
    keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
    delete: vi.fn(async (key: Request) => entries.delete(key.url)),
  };
  return {
    entries,
    storage: {
      open: vi.fn(async () => cache),
      delete: vi.fn(async () => {
        const had = entries.size > 0;
        entries.clear();
        return had;
      }),
    },
  };
};

describe('avatar cache', () => {
  let fake: ReturnType<typeof makeCaches>;

  beforeEach(() => {
    fake = makeCaches();
    vi.stubGlobal('caches', fake.storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps only small homeserver thumbnails', () => {
    expect(isAvatarThumbnailUrl(avatar('face'))).toBe(true);
    expect(
      isAvatarThumbnailUrl(`${HS}/_matrix/media/v3/thumbnail/hs.test/face?width=32&height=32`)
    ).toBe(true);
    expect(isAvatarThumbnailUrl(avatar('photo', 800))).toBe(false);
    expect(isAvatarThumbnailUrl(`${HS}/_matrix/client/v1/media/download/hs.test/face`)).toBe(false);
    expect(isAvatarThumbnailUrl('not a url')).toBe(false);
  });

  it('answers with a kept avatar, and forgets every avatar on sign-out', async () => {
    await rememberAvatar(avatar('face'), new Response('png'));
    await rememberAvatar(avatar('photo', 800), new Response('jpeg'));
    await rememberAvatar(avatar('refused'), new Response('no', { status: 404 }));

    expect(await (await recallAvatar(avatar('face')))?.text()).toBe('png');
    expect(await recallAvatar(avatar('photo', 800))).toBeUndefined();
    expect(await recallAvatar(avatar('refused'))).toBeUndefined();

    await forgetAvatars();
    expect(await recallAvatar(avatar('face'))).toBeUndefined();
  });

  it('drops the oldest avatars beyond the limit', async () => {
    for (let index = 0; index <= MAX_CACHED_AVATARS; index += 1) {
      await rememberAvatar(avatar(`face${index}`), new Response('png'));
    }
    expect(fake.entries.size).toBe(MAX_CACHED_AVATARS);
    expect(await recallAvatar(avatar('face0'))).toBeUndefined();
    expect(await recallAvatar(avatar(`face${MAX_CACHED_AVATARS}`))).toBeDefined();
  });

  it('does nothing where there is no cache storage', async () => {
    vi.stubGlobal('caches', undefined);
    await rememberAvatar(avatar('face'), new Response('png'));
    expect(await recallAvatar(avatar('face'))).toBeUndefined();
    await expect(forgetAvatars()).resolves.toBeUndefined();
  });

  it('keeps one picture under one key, by either path and with transport parameters', async () => {
    const legacy = `${HS}/_matrix/media/v3/thumbnail/hs.test/face?width=96&height=96&method=crop`;
    const online = `${avatar('face')}&allow_redirect=true`;
    expect(avatarCacheKey(legacy)).toBe(avatarCacheKey(online));
    expect(avatarCacheKey(avatar('face', 32))).not.toBe(avatarCacheKey(avatar('face')));

    await rememberAvatar(online, new Response('png'));
    expect(await (await recallAvatar(legacy))?.text()).toBe('png');
  });
});
