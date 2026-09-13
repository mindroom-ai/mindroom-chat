import {
  MatrixError,
  TokenRefreshError,
  TokenRefreshLogoutError,
  type IRefreshTokenResponse,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';

import { createSessionTokenRefresh } from './sessionTokenRefresh';

const createRefresh = (
  refresh: (refreshToken: string) => Promise<IRefreshTokenResponse> = vi.fn()
) =>
  createSessionTokenRefresh({
    sessionId: 'session-a',
    refresh,
  });

describe('createSessionTokenRefresh', () => {
  it.each([
    {
      name: 'rate limiting',
      error: new MatrixError(
        { errcode: 'M_LIMIT_EXCEEDED', error: 'Slow down', retry_after_ms: 1_000 },
        429
      ),
    },
    {
      name: 'a homeserver failure',
      error: new MatrixError({ errcode: 'M_UNKNOWN', error: 'Unavailable' }, 503),
    },
  ])('classifies $name as a retryable SDK refresh failure', async ({ error }) => {
    const refresh = createRefresh(vi.fn().mockRejectedValue(error));

    const result = refresh('refresh-a');

    await expect(result).rejects.toBeInstanceOf(TokenRefreshError);
    await expect(result).rejects.not.toBeInstanceOf(TokenRefreshLogoutError);
  });

  it('leaves network failures retryable', async () => {
    const networkError = new Error('Network unavailable');
    const refresh = createRefresh(vi.fn().mockRejectedValue(networkError));

    await expect(refresh('refresh-a')).rejects.toBe(networkError);
  });

  it('classifies an invalid refresh token as a definitive SDK logout', async () => {
    const invalidToken = new MatrixError(
      { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid refresh token' },
      401
    );
    const refresh = createRefresh(vi.fn().mockRejectedValue(invalidToken));

    const result = refresh('refresh-a');

    await expect(result).rejects.toBeInstanceOf(TokenRefreshLogoutError);
    await expect(result).rejects.not.toBeInstanceOf(TokenRefreshError);
  });
});
