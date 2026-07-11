import {
  MatrixError,
  TokenRefreshError,
  TokenRefreshLogoutError,
  type IRefreshTokenResponse,
  type TokenRefreshFunction,
} from 'matrix-js-sdk';

import { updateSessionCredentials } from '../app/state/sessions';

type SessionTokenRefreshOptions = {
  sessionId: string;
  refresh: (refreshToken: string) => Promise<IRefreshTokenResponse>;
};

const rethrowForSdkRefreshPolicy = (error: unknown): never => {
  if (!(error instanceof MatrixError)) throw error;

  // The SDK treats every MatrixError from a tokenRefreshFunction as a
  // definitive logout. Refresh endpoints can also return MatrixError for
  // rate limits and server failures, so make the intended policy explicit.
  if (error.errcode === 'M_UNKNOWN_TOKEN') {
    throw new TokenRefreshLogoutError(error);
  }

  throw new TokenRefreshError(error);
};

export const createSessionTokenRefresh =
  ({ sessionId, refresh }: SessionTokenRefreshOptions): TokenRefreshFunction =>
  async (refreshToken) => {
    const response: IRefreshTokenResponse = await refresh(refreshToken).catch(
      rethrowForSdkRefreshPolicy
    );

    const nextRefreshToken = response.refresh_token ?? refreshToken;
    const expiresInMs =
      typeof response.expires_in_ms === 'number' ? response.expires_in_ms : undefined;
    updateSessionCredentials(sessionId, {
      accessToken: response.access_token,
      refreshToken: nextRefreshToken,
      expiresInMs,
    });

    return {
      accessToken: response.access_token,
      refreshToken: nextRefreshToken,
      expiry: expiresInMs === undefined ? undefined : new Date(Date.now() + expiresInMs),
    };
  };
