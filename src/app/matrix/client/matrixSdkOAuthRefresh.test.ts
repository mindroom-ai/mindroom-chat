import { HttpApiEvent, createClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';

// The patch (patches/matrix-js-sdk+45.2.0.patch) lets a client that was given a
// `tokenRefreshFunction` refresh through it, which is how MindRoom Chat refreshes
// (sessionTokenRefreshParity.test.ts). A client without one must refresh as the SDK does itself.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ISSUER = 'https://auth.example.com/';
const metadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}authorize`,
  token_endpoint: `${ISSUER}oauth2/token`,
  revocation_endpoint: `${ISSUER}oauth2/revoke`,
  registration_endpoint: `${ISSUER}oauth2/registration`,
  response_modes_supported: ['query', 'fragment'],
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
};

describe('a client without a token refresh function', () => {
  it("refreshes a rejected access token at the token endpoint of the homeserver's OAuth 2.0 provider", async () => {
    const tokenRequests: string[] = [];
    const sends: string[] = [];
    const onTokenRefresh = vi.fn();
    const onLogout = vi.fn();
    const mx = createClient({
      baseUrl: 'https://example.com',
      accessToken: 'A',
      refreshToken: 'R1',
      deviceId: 'DEVICE',
      oauthClientId: 'client-id',
      onTokenRefresh,
      fetchFn: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/_matrix/client/v1/auth_metadata') return json(metadata);
        if (url.href === metadata.token_endpoint) {
          tokenRequests.push(String(init?.body));
          return json({
            access_token: 'B',
            refresh_token: 'R2',
            token_type: 'Bearer',
            expires_in: 300,
          });
        }
        const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
        sends.push(token);
        return token === 'B'
          ? json({ user_id: '@alice:example.com' })
          : json({ errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown access token.' }, 401);
      },
    });
    mx.on(HttpApiEvent.SessionLoggedOut, onLogout);

    await expect(mx.whoami()).resolves.toEqual({ user_id: '@alice:example.com' });

    expect(tokenRequests).toEqual([
      'grant_type=refresh_token&client_id=client-id&refresh_token=R1',
    ]);
    expect(sends).toEqual(['A', 'B']);
    expect(mx.getAccessToken()).toBe('B');
    expect(mx.getRefreshToken()).toBe('R2');
    // The SDK reports the tokens of its own refresh, for the app to store.
    expect(onTokenRefresh).toHaveBeenCalledWith({
      accessToken: 'B',
      refreshToken: 'R2',
      expiry: expect.any(Date),
    });
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('logs out for a rejected access token when it has no OAuth 2.0 client to refresh with', async () => {
    const sends: string[] = [];
    const onLogout = vi.fn();
    const mx = createClient({
      baseUrl: 'https://example.com',
      accessToken: 'A',
      refreshToken: 'R1',
      fetchFn: async (_input, init) => {
        sends.push(new Headers(init?.headers).get('Authorization') ?? '');
        return json({ errcode: 'M_UNKNOWN_TOKEN', error: 'Unknown access token.' }, 401);
      },
    });
    mx.on(HttpApiEvent.SessionLoggedOut, onLogout);

    await expect(mx.whoami()).rejects.toMatchObject({ errcode: 'M_UNKNOWN_TOKEN' });

    expect(sends).toEqual(['Bearer A']);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
