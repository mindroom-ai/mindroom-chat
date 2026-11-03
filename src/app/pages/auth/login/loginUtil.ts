import type { LoginRequest, LoginResponse, MatrixError } from 'matrix-js-sdk';
import { createMatrixClient } from '../../../mindroom/matrix/matrixClientFactory';
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

/**
 * Logs in at `baseUrl` and returns the credentials with the homeserver URL
 * the server's well-known answer points at. Always asks for a refresh token.
 */
export const login = async (baseUrl: string, data: LoginRequest): Promise<CustomLoginResponse> => {
  const mx = createMatrixClient({ baseUrl });
  let response: LoginResponse;
  try {
    response = await mx.loginRequest({ ...data, refresh_token: true });
  } catch (error) {
    throw toLoginError(error);
  }
  const wellKnownBaseUrl = response.well_known?.['m.homeserver']?.base_url;
  return {
    baseUrl: typeof wellKnownBaseUrl === 'string' ? wellKnownBaseUrl : baseUrl,
    response,
  };
};

/** Finishes a login: stores the session and leaves the login page. */
export const useLoginComplete = (data?: CustomLoginResponse): boolean => useCompleteSession(data);
