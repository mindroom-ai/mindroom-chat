import type { LoginRequest, LoginResponse, MatrixError } from 'matrix-js-sdk';
import { isAllowedHomeserverBaseUrl } from '../../../cs-api';
import { createMatrixClient } from '../../../mindroom/matrix/matrixClientFactory';
import { trimTrailingSlash } from '../../../utils/common';
import { CompletedAuth, useCompleteSession } from '../completeSession';














  readonly code: LoginError;

  constructor(code: LoginError, message?: string) {
    super(message ?? code);
    this.name = 'LoginFailure';
    this.code = code;
  }
}

const toLoginError = (error: unknown): LoginFailure => {
  const matrixError = error as Partial<MatrixError> | undefined;
  switch (matrixError?.errcode) {
    case 'M_FORBIDDEN':
      return new LoginFailure(LoginError.Forbidden, matrixError.message);
    case 'M_USER_DEACTIVATED':
      return new LoginFailure(LoginError.UserDeactivated, matrixError.message);
    case 'M_LIMIT_EXCEEDED':
      return new LoginFailure(LoginError.RateLimited, matrixError.message);
    case 'M_BAD_JSON':
    case 'M_NOT_JSON':
    case 'M_UNKNOWN':
      return new LoginFailure(LoginError.InvalidRequest, matrixError.message);
    default:
      return new LoginFailure(LoginError.Unknown, matrixError?.message);
  }
};

const sameOrigin = (a: string, b: string): boolean => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/**
 * The homeserver URL to keep after a login at `baseUrl`. The response's well-known answer is
 * used only when it passes the checks discovery applies and stays on the login's origin, so a
 * login response cannot move the session, and its access token, to another server.
 */
const resolveLoginBaseUrl = (baseUrl: string, wellKnownBaseUrl: unknown): string => {
  if (typeof wellKnownBaseUrl !== 'string') return baseUrl;
  const candidate = trimTrailingSlash(wellKnownBaseUrl.trim());
  if (!isAllowedHomeserverBaseUrl(candidate) || !sameOrigin(candidate, baseUrl)) return baseUrl;
  return candidate;
};

/**
 * Logs in at `baseUrl` and returns the credentials with the homeserver URL to use from now on:
 * the server's well-known answer when it is safe to follow, `baseUrl` otherwise. Always asks for
 * a refresh token.
 */
export const login = async (baseUrl: string, data: LoginRequest): Promise<CustomLoginResponse> => {
  const mx = createMatrixClient({ baseUrl });
  let response: LoginResponse;
  try {
    response = await mx.loginRequest({ ...data, refresh_token: true });
  } catch (error) {
    throw toLoginError(error);
  }
  return {
    baseUrl: resolveLoginBaseUrl(baseUrl, response.well_known?.['m.homeserver']?.base_url),
    response,
  };
};

/** Finishes a login: stores the session and leaves the login page. */
export const useLoginComplete = (data?: CustomLoginResponse): boolean => useCompleteSession(data);
