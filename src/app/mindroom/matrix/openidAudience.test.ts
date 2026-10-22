import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { requestAudienceOpenIdToken } from './openidAudience';

const token = {
  access_token: 'bound-token',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 120,
};

const makeClient = (userId = '@alice:example.org') => {
  const authedRequest = vi.fn().mockResolvedValue(token);
  const mx = {
    getSafeUserId: () => userId,
    getHomeserverUrl: () => 'https://example.org',
    http: { authedRequest },
  } as unknown as MatrixClient;
  return { mx, authedRequest };
};

const answerVersions = (response: Response | Error) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    })
  );
const versions = (unstableFeatures: Record<string, boolean>) =>
  new Response(JSON.stringify({ versions: ['v1.11'], unstable_features: unstableFeatures }), {
    status: 200,
  });

describe('requestAudienceOpenIdToken', () => {
  it('posts the audience to the encoded request_token path', async () => {
    const { mx, authedRequest } = makeClient('@alice/x:example.org');
    await expect(requestAudienceOpenIdToken(mx, 'https://backend.example')).resolves.toBe(token);
    expect(authedRequest).toHaveBeenCalledTimes(1);
    expect(authedRequest).toHaveBeenCalledWith(
      'POST',
      '/user/%40alice%2Fx%3Aexample.org/openid/request_token',
      undefined,
      { 'io.mindroom.audience': 'https://backend.example' }
    );
  });

  it('asks the homeserver afresh before a token for a published server', async () => {
    const { mx, authedRequest } = makeClient();
    answerVersions(versions({ 'io.mindroom.openid_audience': true }));
    await expect(
      requestAudienceOpenIdToken(mx, 'https://found.example', { requireBinding: true })
    ).resolves.toBe(token);
    expect(fetch).toHaveBeenCalledWith(
      'https://example.org/_matrix/client/versions',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(authedRequest).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it.each([
    ['does not bind tokens', versions({})],
    ['says binding is off', versions({ 'io.mindroom.openid_audience': false })],
    ['cannot be reached', new Error('offline')],
    ['answers with an error', new Response('', { status: 502 })],
  ])('requests no token for a published server when the homeserver %s', async (_case, response) => {
    const { mx, authedRequest } = makeClient();
    answerVersions(response);
    await expect(
      requestAudienceOpenIdToken(mx, 'https://found.example', { requireBinding: true })
    ).rejects.toThrow('does not bind sign-in tokens');
    expect(authedRequest).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('passes a failed request on to the caller', async () => {
    const { mx, authedRequest } = makeClient();
    authedRequest.mockRejectedValueOnce(new Error('homeserver down'));
    await expect(requestAudienceOpenIdToken(mx, 'https://backend.example')).rejects.toThrow(
      'homeserver down'
    );
  });
});
