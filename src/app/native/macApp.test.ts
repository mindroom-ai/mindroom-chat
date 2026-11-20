// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import {
  MAC_APP_RELEASES_URL,
  parseMacAppDownloadUrl,
  resetMacAppDownloadUrlForTests,
  useMacAppDownloadUrl,
  useOffersMacApp,
} from './macApp';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(), getPlatform: vi.fn() },
  registerPlugin: vi.fn(() => ({})),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { close: vi.fn(), open: vi.fn() } }));

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const OFFERED: ClientConfig = { macApp: { offer: true } };

const browser = (userAgent: string, platform: string, maxTouchPoints = 0) =>
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints });

/** What the hook says under a deployment's config. */
const offers = (config: ClientConfig = OFFERED): boolean =>
  renderHook(useOffersMacApp, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(ClientConfigProvider, { value: config }, children),
  }).result.current;

describe('useOffersMacApp', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true in a browser on a Mac where the deployment offers the app', () => {
    browser(MAC_SAFARI, 'MacIntel');
    expect(offers()).toBe(true);
  });

  it('is false unless the deployment says `macApp.offer: true`', () => {
    browser(MAC_SAFARI, 'MacIntel');
    expect(offers({})).toBe(false);
    expect(offers({ macApp: {} })).toBe(false);
    expect(offers({ macApp: { offer: false } })).toBe(false);
  });

  it("is false inside the Mac app, a Mac user agent on Capacitor's native iOS bridge", () => {
    browser(MAC_SAFARI, 'MacIntel');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    expect(offers()).toBe(false);
  });

  it('is false on an iPad in desktop mode, which reports a Mac with a touch screen', () => {
    browser(MAC_SAFARI, 'MacIntel', 5);
    expect(offers()).toBe(false);
  });

  it('is false on Windows', () => {
    browser(WINDOWS_CHROME, 'Win32');
    expect(offers()).toBe(false);
  });
});

const dmg = (tag: string, name = 'MindRoom-Chat.dmg') =>
  `https://github.com/mindroom-ai/mindroom-chat/releases/download/${tag}/${name}`;

const release = (
  tag: string,
  assets: string[],
  extra: Record<string, unknown> = {},
  state = 'uploaded'
) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: assets.map((name) => ({
    name,
    state,
    browser_download_url: name.endsWith('.dmg') ? dmg(tag, name) : `https://example.org/${name}`,
  })),
  ...extra,
});

describe('parseMacAppDownloadUrl', () => {
  it('picks the newest release that has the disk image, past one still without it', () => {
    expect(
      parseMacAppDownloadUrl([
        release('v3', ['MindRoom.ipa']),
        release('v2', ['notes.txt', 'MindRoom-Chat.dmg']),
        release('v1', ['MindRoom-Chat.dmg']),
      ])
    ).toBe(dmg('v2'));
  });

  it('takes the MindRoom.dmg of a release from before the app was MindRoom Chat', () => {
    expect(
      parseMacAppDownloadUrl([release('v2', ['notes.txt']), release('v1', ['MindRoom.dmg'])])
    ).toBe(dmg('v1', 'MindRoom.dmg'));
  });

  it('prefers MindRoom-Chat.dmg when a release has both, the old one listed first', () => {
    expect(parseMacAppDownloadUrl([release('v2', ['MindRoom.dmg', 'MindRoom-Chat.dmg'])])).toBe(
      dmg('v2')
    );
  });

  it('passes over an image whose upload never finished (`starter`)', () => {
    expect(
      parseMacAppDownloadUrl([
        release('v3', ['MindRoom-Chat.dmg'], {}, 'starter'),
        release('v2', ['MindRoom-Chat.dmg']),
      ])
    ).toBe(dmg('v2'));
  });

  it('leaves out drafts and pre-releases', () => {
    expect(
      parseMacAppDownloadUrl([
        release('v4', ['MindRoom-Chat.dmg'], { draft: true }),
        release('v3', ['MindRoom-Chat.dmg'], { prerelease: true }),
        release('v2', ['MindRoom-Chat.dmg']),
      ])
    ).toBe(dmg('v2'));
  });

  it('is undefined without a release that has it, or for what is no list of releases', () => {
    expect(parseMacAppDownloadUrl([])).toBeUndefined();
    expect(parseMacAppDownloadUrl([release('v1', ['MindRoom.ipa'])])).toBeUndefined();
    expect(parseMacAppDownloadUrl({ message: 'API rate limit exceeded' })).toBeUndefined();
    expect(parseMacAppDownloadUrl(null)).toBeUndefined();
    expect(
      parseMacAppDownloadUrl([null, 'v1', { assets: 'MindRoom-Chat.dmg' }, { assets: [null] }])
    ).toBeUndefined();
    expect(
      parseMacAppDownloadUrl([
        { assets: [{ name: 'MindRoom-Chat.dmg', state: 'uploaded', browser_download_url: 7 }] },
      ])
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
      respond(new Response(JSON.stringify([release('v2', ['MindRoom-Chat.dmg'])])));
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
    answer([release('v2', ['MindRoom-Chat.dmg'])]);
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
    answer([release('v2', ['MindRoom-Chat.dmg'])]);
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
