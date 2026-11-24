import type { LoginRequest, LoginResponse, MatrixError } from 'matrix-js-sdk';
import { AutoDiscoveryAction, autoDiscovery, isAllowedHomeserverBaseUrl } from '../../../matrix/cs-api';
import {
  createMatrixClient,
  createMatrixFetchFn,
} from '../../../matrix/client/matrixClientFactory';
import { trimTrailingSlash } from '../../../lib/common';
import { CompletedAuth, useCompleteSession } from '../completeSession';

/** A finished login: the credentials and the homeserver URL to keep using. */
export type CustomLoginResponse = CompletedAuth<LoginResponse>;

/** Why a login failed, as the login forms tell the user. */
export const LoginError = {
  Forbidden: 'Forbidden',
  InvalidRequest: 'InvalidRequest',
  InvalidServer: 'InvalidServer',
  RateLimited: 'RateLimited',
  ServerNotAllowed: 'ServerNotAllowed',
  Unknown: 'Unknown',
  UserDeactivated: 'UserDeactivated',
} as const;
export type LoginError = (typeof LoginError)[keyof typeof LoginError];

/** The error `login` throws, carrying the reason as a `LoginError`. */
export class LoginFailure extends Error {
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

/** The server name of a full Matrix user ID such as `@alice:example.org`. */
export const getMatrixIdServer = (user: string): string | undefined => {
  if (!user.startsWith('@')) return undefined;
  const separator = user.indexOf(':');
  if (separator < 2 || separator === user.length - 1) return undefined;
  return user.slice(separator + 1);
};

/**
 * The homeserver a login as `user` goes to. A full Matrix ID names its server, and that server's
 * well-known answer is followed when the deployment allows the server. When it cannot be read the
 * login stays at `baseUrl`: a server name need not be an address (`matrix.localhost` on a local
 * test server), and the homeserver at `baseUrl` knows its own users.
 */
export const resolveMatrixIdHomeserver = async (
  user: string,
  baseUrl: string,
  isServerAllowed: (server: string) => boolean,
  request: typeof fetch = fetch
): Promise<string> => {
  const server = getMatrixIdServer(user);
  if (!server) return baseUrl;
  const [error, info] = await autoDiscovery(createMatrixFetchFn(request), server);
  if (error?.action === AutoDiscoveryAction.FAIL_INSECURE) {
    throw new LoginFailure(LoginError.InvalidServer);
  }
  const discovered = info?.['m.homeserver'].base_url;
  if (!discovered || trimTrailingSlash(discovered) === trimTrailingSlash(baseUrl)) return baseUrl;
  if (!isServerAllowed(server)) throw new LoginFailure(LoginError.ServerNotAllowed);
  return discovered;
};
