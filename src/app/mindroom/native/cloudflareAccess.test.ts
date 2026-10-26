// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import {
  clearCloudflareAccess,
  discoverCloudflareAccess,
  getCloudflareAccessToken,
  hasCloudflareAccess,
  parseCloudflareAccessCallback,
  signInToCloudflareAccess,
} from './cloudflareAccess';
import { authenticateInNativeBrowser, isNativeIOS } from './nativeSso';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: vi.fn() },
}));

vi.mock('./nativeSso', () => ({
  authenticateInNativeBrowser: vi.fn(),
  isNativeIOS: vi.fn(),
}));

const NOW = 1_800_000_000_000;
const BASE_URL = 'https://hs.example';
const HANDOFF_URL = 'https://hs.example/native/cloudflare-access';

const base64Url = (value: string): string =>
  btoa(value).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const jwt = (exp: unknown): string =>
  [base64Url('{"alg":"RS256"}'), base64Url(JSON.stringify({ exp })), 'signature'].join('.');

const validToken = jwt(NOW / 1000 + 3600);

const respond = (body: string, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));

const advert = (handoffUrl: string) => respond(JSON.stringify({ handoff_url: handoffUrl }));

describe('cloudflareAccess', () => {
  beforeEach(() => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    clearCloudflareAccess(BASE_URL);
    localStorage.clear();
    vi.restoreAllMocks();
    vi.mocked(authenticateInNativeBrowser).mockReset();
  });

  it('discovers a same-origin https handoff url', async () => {
    const request = advert(HANDOFF_URL);

    await expect(discoverCloudflareAccess(`${BASE_URL}/`, request)).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(
      'https://hs.example/.well-known/mindroom/cloudflare-access',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(hasCloudflareAccess(BASE_URL)).toBe(true);
  });

  it('does not look for an advert outside the iOS app', async () => {
    vi.mocked(isNativeIOS).mockReturnValue(false);
    const request = advert(HANDOFF_URL);

    await expect(discoverCloudflareAccess(BASE_URL, request)).resolves.toBe(false);

    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['an html page', () => respond('<!doctype html><html></html>')],
    ['a 404', () => respond('{}', 404)],
    ['a handoff on another origin', () => advert('https://evil.example/native/cloudflare-access')],
    ['an http handoff', () => advert('http://hs.example/native/cloudflare-access')],
  ])('treats %s as no Access and forgets an earlier record', async (_, request) => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));

    await expect(discoverCloudflareAccess(BASE_URL, request())).resolves.toBe(false);

    expect(hasCloudflareAccess(BASE_URL)).toBe(false);
  });

  it('keeps an earlier record when the advert cannot be fetched', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Load failed'));

    await expect(discoverCloudflareAccess(BASE_URL, offline)).resolves.toBe(true);

    expect(hasCloudflareAccess(BASE_URL)).toBe(true);
  });

  it('treats an unreachable advert as no Access when nothing was recorded', async () => {
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Load failed'));

    await expect(discoverCloudflareAccess(BASE_URL, offline)).resolves.toBe(false);
  });

  it('keeps the token when discovery finds the same handoff url again', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(
      `mindroom://cloudflare-access#token=${validToken}`
    );
    await signInToCloudflareAccess(BASE_URL);

    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));

    expect(getCloudflareAccessToken(`${BASE_URL}/_matrix/client/v3/sync`)).toBe(validToken);
  });

  it('reads the token from the callback fragment', () => {
    expect(parseCloudflareAccessCallback(`mindroom://cloudflare-access#token=${validToken}`)).toBe(
      validToken
    );
  });

  it.each([
    ['another callback host', `mindroom://auth/login#token=${validToken}`],
    ['another scheme', `https://cloudflare-access#token=${validToken}`],
    ['no token', 'mindroom://cloudflare-access#state=1'],
    ['a token that is not a JWT', 'mindroom://cloudflare-access#token=abc'],
    ['a token without exp', `mindroom://cloudflare-access#token=${jwt('soon')}`],
    [
      'a token expiring within a minute',
      `mindroom://cloudflare-access#token=${jwt(NOW / 1000 + 30)}`,
    ],
  ])('rejects a callback with %s', (_, url) => {
    expect(parseCloudflareAccessCallback(url)).toBeUndefined();
  });

  it('signs in through the advertised handoff page and stores the token for that origin', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(
      `mindroom://cloudflare-access#token=${validToken}`
    );

    await signInToCloudflareAccess(BASE_URL);

    expect(authenticateInNativeBrowser).toHaveBeenCalledWith(HANDOFF_URL, 'mindroom');
    expect(getCloudflareAccessToken('https://hs.example/_matrix/client/v3/sync')).toBe(validToken);
    expect(
      getCloudflareAccessToken('https://other.example/_matrix/client/v3/sync')
    ).toBeUndefined();
  });

  it('stores nothing when the callback carries no valid token', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue('mindroom://cloudflare-access#');

    await expect(signInToCloudflareAccess(BASE_URL)).rejects.toThrow();

    expect(getCloudflareAccessToken(BASE_URL)).toBeUndefined();
    expect(hasCloudflareAccess(BASE_URL)).toBe(true);
  });

  it('stops returning the token a minute before it expires', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));
    vi.mocked(authenticateInNativeBrowser).mockResolvedValue(
      `mindroom://cloudflare-access#token=${validToken}`
    );
    await signInToCloudflareAccess(BASE_URL);

    expect(getCloudflareAccessToken(BASE_URL, NOW + 3540_000)).toBeUndefined();
  });

  it('clears the record', async () => {
    await discoverCloudflareAccess(BASE_URL, advert(HANDOFF_URL));

    clearCloudflareAccess(BASE_URL);

    expect(hasCloudflareAccess(BASE_URL)).toBe(false);
  });
});
