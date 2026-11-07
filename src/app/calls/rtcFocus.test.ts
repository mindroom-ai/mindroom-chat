import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  chooseCallService,
  discoverLivekitServiceUrl,
  firstLivekitServiceUrl,
  requestOwnSfuGrant,
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

describe('chooseCallService', () => {
  const OWN = 'https://rtc.example.org/livekit/jwt';

  it("starts a call on this deployment's backend", () => {
    expect(chooseCallService(undefined, OWN)).toEqual({ url: OWN });
  });

  it('joins a running call only when it runs on that same backend', () => {
    expect(chooseCallService('https://rtc.example.org/livekit/jwt/', OWN)).toEqual({ url: OWN });
    expect(chooseCallService('https://RTC.example.org/livekit/jwt', OWN)).toEqual({ url: OWN });
  });

  it('refuses a call on a backend a room member named, whose owner would get the token', () => {
    for (const named of [
      'https://evil.example/livekit/jwt',
      'https://rtc.example.org/other',
      'https://rtc.example.org/livekit/jwt?x=1',
      'https://user@rtc.example.org/livekit/jwt',
      'http://rtc.example.org/livekit/jwt',
    ]) {
      expect(chooseCallService(named, OWN), named).toEqual({ refused: 'foreign' });
    }
  });

  it('cannot call without a backend of its own', () => {
    expect(chooseCallService(undefined, undefined)).toEqual({ refused: 'missing' });
    expect(chooseCallService(OWN, undefined)).toEqual({ refused: 'missing' });
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

describe('requestOwnSfuGrant', () => {
  const ownClient = (deviceId: string | null = 'DEVICE') =>
    ({
      getDomain: () => 'own.example.org',
      baseUrl: 'https://matrix.own.example.org',
      getDeviceId: () => deviceId,
      getOpenIdToken: vi.fn(async () => ({
        access_token: 'openid',
        token_type: 'Bearer',
        matrix_server_name: 'own.example.org',
        expires_in: 3600,
      })),
      http: { authedRequest: vi.fn(async () => Promise.reject(new Error('404'))) },
    } as unknown as MatrixClient);

  it("asks the deployment's own service, the one its well-known names", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/.well-known/matrix/client')
        ? jsonResponse({
            'org.matrix.msc4143.rtc_foci': [
              { type: 'livekit', livekit_service_url: 'https://rtc.own.example.org' },
            ],
          })
        : jsonResponse({ url: 'wss://sfu.own.example.org', jwt: 'jwt' })
    );
    vi.stubGlobal('fetch', fetchFn);
    try {
      await expect(requestOwnSfuGrant(ownClient(), '!call:own.example.org')).resolves.toEqual({
        serviceUrl: 'https://rtc.own.example.org',
        grant: { url: 'wss://sfu.own.example.org', jwt: 'jwt' },
      });
      expect(fetchFn).toHaveBeenLastCalledWith(
        'https://rtc.own.example.org/sfu/get',
        expect.objectContaining({ method: 'POST' })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks for nothing when the deployment announces no service', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}))
    );
    try {
      const mx = ownClient();
      await expect(requestOwnSfuGrant(mx, '!call:own.example.org')).resolves.toBeUndefined();
      expect(mx.getOpenIdToken).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
