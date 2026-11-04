import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  discoverLivekitServiceUrl,
  firstLivekitServiceUrl,
  requestSfuGrant,
  SfuGrantError,
} from './rtcFocus';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const fakeClient = (transports: () => Promise<unknown>) =>
  ({
    getDomain: () => 'example.org',
    baseUrl: 'https://matrix.example.org',
    http: { authedRequest: vi.fn(transports) },
  } as unknown as MatrixClient);

describe('firstLivekitServiceUrl', () => {
  it('takes the first LiveKit entry with an HTTP(S) URL', () => {
    expect(
      firstLivekitServiceUrl([
        { type: 'nextgen', url: 'https://other.example.org' },
        { type: 'livekit', livekit_service_url: '' },
        { type: 'livekit', livekit_service_url: 'ftp://rtc.example.org' },
        { type: 'livekit', livekit_service_url: 'https://rtc.example.org/livekit/jwt' },
        { type: 'livekit', livekit_service_url: 'https://second.example.org' },
      ])
    ).toBe('https://rtc.example.org/livekit/jwt');
  });

  it('finds nothing in a missing or malformed list', () => {
    expect(firstLivekitServiceUrl(undefined)).toBeUndefined();
    expect(firstLivekitServiceUrl({ type: 'livekit' })).toBeUndefined();
    expect(firstLivekitServiceUrl([null, 'livekit', { type: 'livekit' }])).toBeUndefined();
  });
});

describe('discoverLivekitServiceUrl', () => {
  it("prefers the server name's well-known, which agents trust", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        'm.homeserver': { base_url: 'https://matrix.example.org' },
        'org.matrix.msc4143.rtc_foci': [
          { type: 'livekit', livekit_service_url: 'https://rtc.example.org' },
        ],
      })
    );
    const mx = fakeClient(async () => ({ rtc_transports: [] }));
    await expect(discoverLivekitServiceUrl(mx, fetchFn)).resolves.toBe('https://rtc.example.org');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.org/.well-known/matrix/client',
      expect.anything()
    );
    expect(mx.http.authedRequest).not.toHaveBeenCalled();
  });

  it('falls back to /rtc/transports, then to a well-known at the homeserver URL', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.startsWith('https://example.org')) throw new TypeError('Failed to fetch');
      return jsonResponse({
        'org.matrix.msc4143.rtc_foci': [
          { type: 'livekit', livekit_service_url: 'https://homeserver-rtc.example.org' },
        ],
      });
    }) as unknown as typeof fetch;
    const viaTransports = fakeClient(async () => ({
      rtc_transports: [{ type: 'livekit', livekit_service_url: 'https://transports.example.org' }],
    }));
    await expect(discoverLivekitServiceUrl(viaTransports, fetchFn)).resolves.toBe(
      'https://transports.example.org'
    );

    const withoutTransports = fakeClient(async () => {
      throw new Error('M_UNRECOGNIZED');
    });
    await expect(discoverLivekitServiceUrl(withoutTransports, fetchFn)).resolves.toBe(
      'https://homeserver-rtc.example.org'
    );
  });

  it('answers undefined when nothing announces a backend', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 404)) as unknown as typeof fetch;
    const mx = fakeClient(async () => ({ rtc_transports: [] }));
    await expect(discoverLivekitServiceUrl(mx, fetchFn)).resolves.toBeUndefined();
  });
});

describe('requestSfuGrant', () => {
  const token = {
    access_token: 'openid-token',
    token_type: 'Bearer',
    matrix_server_name: 'example.org',
    expires_in: 3600,
  };

  it('posts the OpenID token, room and device to /sfu/get', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ url: 'wss://sfu.example.org', jwt: 'livekit-token' })
    );
    const grant = await requestSfuGrant(
      'https://rtc.example.org/',
      { roomId: '!room:example.org', deviceId: 'DEVICE', token },
      fetchFn
    );
    expect(grant).toEqual({ url: 'wss://sfu.example.org', jwt: 'livekit-token' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rtc.example.org/sfu/get');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      room: '!room:example.org',
      device_id: 'DEVICE',
      openid_token: token,
    });
  });

  it('refuses an error answer and a grant without a WebSocket URL', async () => {
    const refused = vi.fn(async () => jsonResponse({ errcode: 'M_FORBIDDEN' }, 403));
    await expect(
      requestSfuGrant('https://rtc.example.org', { roomId: '!r', deviceId: 'D', token }, refused)
    ).rejects.toMatchObject({ name: 'SfuGrantError', status: 403 });

    const malformed = vi.fn(async () => jsonResponse({ url: 'https://sfu.example.org', jwt: 'x' }));
    await expect(
      requestSfuGrant('https://rtc.example.org', { roomId: '!r', deviceId: 'D', token }, malformed)
    ).rejects.toBeInstanceOf(SfuGrantError);
  });
});
