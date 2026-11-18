// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAC_APP_RELEASES_URL,
  parseMacAppDownloadUrl,
  resetMacAppDownloadUrlForTests,
  useMacAppDownloadUrl,
} from './macApp';

const dmg = (tag: string) =>
  `https://github.com/mindroom-ai/mindroom-chat/releases/download/${tag}/MindRoom.dmg`;

const release = (tag: string, assets: string[], extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: assets.map((name) => ({
    name,
    browser_download_url: name === 'MindRoom.dmg' ? dmg(tag) : `https://example.org/${name}`,
  })),
  ...extra,
});

describe('parseMacAppDownloadUrl', () => {
  it('picks the newest release that has the disk image, past one still without it', () => {
    expect(
      parseMacAppDownloadUrl([
        release('v3', ['MindRoom.ipa']),
        release('v2', ['notes.txt', 'MindRoom.dmg']),
        release('v1', ['MindRoom.dmg']),
      ])
    ).toBe(dmg('v2'));
  });

  it('leaves out drafts and pre-releases', () => {
    expect(
      parseMacAppDownloadUrl([
        release('v4', ['MindRoom.dmg'], { draft: true }),
        release('v3', ['MindRoom.dmg'], { prerelease: true }),
        release('v2', ['MindRoom.dmg']),
      ])
    ).toBe(dmg('v2'));
  });

  it('is undefined without a release that has it, or for what is no list of releases', () => {
    expect(parseMacAppDownloadUrl([])).toBeUndefined();
    expect(parseMacAppDownloadUrl([release('v1', ['MindRoom.ipa'])])).toBeUndefined();
    expect(parseMacAppDownloadUrl({ message: 'API rate limit exceeded' })).toBeUndefined();
    expect(parseMacAppDownloadUrl(null)).toBeUndefined();
    expect(
      parseMacAppDownloadUrl([null, 'v1', { assets: 'MindRoom.dmg' }, { assets: [null] }])
    ).toBeUndefined();
    expect(
      parseMacAppDownloadUrl([{ assets: [{ name: 'MindRoom.dmg', browser_download_url: 7 }] }])
    ).toBeUndefined();
  });
});

describe('useMacAppDownloadUrl', () => {
  const fetchReleases = vi.fn<() => Promise<Response>>();
  const answer = (body: unknown, status = 200) =>
    fetchReleases.mockResolvedValue(new Response(JSON.stringify(body), { status }));

  beforeEach(() => {
    resetMacAppDownloadUrlForTests();
    fetchReleases.mockReset();
    vi.stubGlobal('fetch', fetchReleases);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links the releases page until GitHub names the disk image, then the image', async () => {
    let respond!: (response: Response) => void;
    fetchReleases.mockReturnValue(
      new Promise<Response>((resolve) => {
        respond = resolve;
      })
    );
    const { result } = renderHook(() => useMacAppDownloadUrl());
    expect(result.current).toBe(MAC_APP_RELEASES_URL);

    await act(async () => {
      respond(new Response(JSON.stringify([release('v2', ['MindRoom.dmg'])])));
    });

    expect(result.current).toBe(dmg('v2'));
  });

  it.each([
    ['offline', () => fetchReleases.mockRejectedValue(new TypeError('Failed to fetch'))],
    ['rate limited', () => answer({ message: 'API rate limit exceeded' }, 403)],
    ['not JSON', () => fetchReleases.mockResolvedValue(new Response('<html>'))],
  ])('stays on the releases page when GitHub cannot name it (%s)', async (_, fail) => {
    fail();
    const { result } = renderHook(() => useMacAppDownloadUrl());
    await act(async () => {});
    expect(fetchReleases).toHaveBeenCalledOnce();
    expect(result.current).toBe(MAC_APP_RELEASES_URL);
  });

  it('asks GitHub once for every link on the page, a later one included', async () => {
    answer([release('v2', ['MindRoom.dmg'])]);
    const first = renderHook(() => useMacAppDownloadUrl());
    const second = renderHook(() => useMacAppDownloadUrl());
    await act(async () => {});
    const later = renderHook(() => useMacAppDownloadUrl());

    expect(fetchReleases).toHaveBeenCalledOnce();
    expect(first.result.current).toBe(dmg('v2'));
    expect(second.result.current).toBe(dmg('v2'));
    expect(later.result.current).toBe(dmg('v2'));
  });

  it('asks nothing while not enabled', async () => {
    answer([release('v2', ['MindRoom.dmg'])]);
    const { result, rerender } = renderHook(({ on }) => useMacAppDownloadUrl(on), {
      initialProps: { on: false },
    });
    await act(async () => {});
    expect(fetchReleases).not.toHaveBeenCalled();
    expect(result.current).toBe(MAC_APP_RELEASES_URL);

    rerender({ on: true });
    await act(async () => {});
    expect(fetchReleases).toHaveBeenCalledOnce();
    expect(result.current).toBe(dmg('v2'));
  });
});
