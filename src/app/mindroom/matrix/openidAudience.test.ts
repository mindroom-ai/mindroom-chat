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
  const mx = { getSafeUserId: () => userId, http: { authedRequest } } as unknown as MatrixClient;
  return { mx, authedRequest };
};

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

  it('passes a failed request on to the caller', async () => {
    const { mx, authedRequest } = makeClient();
    authedRequest.mockRejectedValueOnce(new Error('homeserver down'));
    await expect(requestAudienceOpenIdToken(mx, 'https://backend.example')).rejects.toThrow(
      'homeserver down'
    );
  });
});
