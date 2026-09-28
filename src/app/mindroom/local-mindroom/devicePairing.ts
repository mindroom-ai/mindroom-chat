import { TokenRefreshLogoutError } from 'matrix-js-sdk';
import { createStoredSessionTokenRefresh } from '../../../client/sessionTokenRefresh';
import { listSessions, type StoredSession } from '../../state/sessions';
import { HomeserverSignedOutError, LocalMindroomApiError, requestMatrixOpenIdToken } from './api';
import { resolveMindroomProvisioningRequest } from './mindroom';

export type PairingAccount = {
  session: StoredSession;
  provisioningBaseUrl: string;
};

const PAIR_CODE_PATTERN = /^[A-Z0-9]{8}$/;

export const normalizePairCode = (value: string | null | undefined): string | undefined => {
  const compact = (value ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!PAIR_CODE_PATTERN.test(compact)) return undefined;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
};

// An account can approve only when it may authenticate to its provisioning
// origin, which excludes accounts on other homeservers when a provisioning
// override is configured.
export const getPairingAccounts = (
  sessions: StoredSession[],
  provisioningOverrideUrl: string | undefined
): PairingAccount[] =>
  sessions.flatMap((session) => {
    const { canAuthenticate, provisioningBaseUrl } = resolveMindroomProvisioningRequest({
      sessionHomeserverUrl: session.baseUrl,
      provisioningOverrideUrl,
      accessToken: session.accessToken,
    });
    return canAuthenticate && provisioningBaseUrl ? [{ session, provisioningBaseUrl }] : [];
  });

const refreshStoredSessionAccessToken = async (
  session: StoredSession
): Promise<string | undefined> => {
  const refresh = createStoredSessionTokenRefresh(session);
  if (!refresh || !session.refreshToken) return undefined;
  return (await refresh(session.refreshToken)).accessToken;
};

const isInvalidTokenError = (error: unknown): boolean =>
  error instanceof LocalMindroomApiError && error.status === 401;

// Runs a provisioning request as a stored account, independent of the account
// the rest of the app is using. The request receives an OpenID token minted
// from the account's access token; the access token itself only goes to the
// account's homeserver. A 401 from the homeserver OpenID request triggers one
// refresh-and-retry: by credentials another tab rotated meanwhile, or else by
// a refresh that the shared refresh function persists to the session store.
// Homeserver auth failures throw HomeserverSignedOutError; provisioning 401s
// surface as LocalMindroomApiError.
export const requestAsStoredSession = async <T>(
  sessionId: string,
  request: (openIdToken: string) => Promise<T>,
  refreshAccessToken: (
    session: StoredSession
  ) => Promise<string | undefined> = refreshStoredSessionAccessToken
): Promise<T> => {
  const findSession = () => listSessions().find((session) => session.sessionId === sessionId);
  const session = findSession();
  if (!session) throw new HomeserverSignedOutError('Account is no longer signed in');

  const mintOpenIdToken = async (accessToken: string): Promise<string> =>
    requestMatrixOpenIdToken({
      baseUrl: session.baseUrl,
      userId: session.userId,
      accessToken,
    });

  let usedAccessToken = session.accessToken;
  let openIdToken: string;
  try {
    openIdToken = await mintOpenIdToken(usedAccessToken);
  } catch (error) {
    // A 401 from the homeserver means the access token is expired.
    // Refresh once and retry the OpenID request.
    if (!isInvalidTokenError(error)) throw error;

    const latest = findSession();
    if (!latest) throw new HomeserverSignedOutError('Account is no longer signed in');

    let refreshedAccessToken: string | undefined = latest.accessToken;
    if (refreshedAccessToken === usedAccessToken) {
      try {
        refreshedAccessToken = await refreshAccessToken(latest);
      } catch (refreshError) {
        if (refreshError instanceof TokenRefreshLogoutError) {
          throw new HomeserverSignedOutError('Account refresh token expired');
        }
        throw refreshError;
      }
    }
    if (!refreshedAccessToken || refreshedAccessToken === usedAccessToken) {
      throw new HomeserverSignedOutError('Cannot refresh account credentials');
    }

    usedAccessToken = refreshedAccessToken;
    try {
      openIdToken = await mintOpenIdToken(usedAccessToken);
    } catch (secondError) {
      if (isInvalidTokenError(secondError)) {
        throw new HomeserverSignedOutError('Homeserver rejected refreshed credentials');
      }
      throw secondError;
    }
  }

  return request(openIdToken);
};
