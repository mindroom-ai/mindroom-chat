import { TokenRefreshLogoutError } from 'matrix-js-sdk';
import { createStoredSessionTokenRefresh } from '../../../client/sessionTokenRefresh';
import { listSessions, type StoredSession } from '../../state/sessions';
import { LocalMindroomApiError } from './api';
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

// An account can approve only when its provisioning request would carry its
// own token, which excludes accounts on other homeservers when a provisioning
// override is configured.
export const getPairingAccounts = (
  sessions: StoredSession[],
  provisioningOverrideUrl: string | undefined
): PairingAccount[] =>
  sessions.flatMap((session) => {
    const { accessToken, provisioningBaseUrl } = resolveMindroomProvisioningRequest({
      sessionHomeserverUrl: session.baseUrl,
      provisioningOverrideUrl,
      accessToken: session.accessToken,
    });
    return accessToken && provisioningBaseUrl ? [{ session, provisioningBaseUrl }] : [];
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

// Runs a provisioning request with a stored account's token, independent of
// the account the rest of the app is using. A rejected token is replaced once:
// by credentials another tab rotated meanwhile, or else by a refresh that the
// shared refresh function persists to the session store.
export const requestAsStoredSession = async <T>(
  sessionId: string,
  request: (accessToken: string) => Promise<T>,
  refreshAccessToken: (
    session: StoredSession
  ) => Promise<string | undefined> = refreshStoredSessionAccessToken
): Promise<T> => {
  const findSession = () => listSessions().find((session) => session.sessionId === sessionId);
  const session = findSession();
  if (!session) throw new LocalMindroomApiError('Account is no longer signed in', 401);

  try {
    return await request(session.accessToken);
  } catch (error) {
    if (!isInvalidTokenError(error)) throw error;

    const latest = findSession();
    if (!latest) throw error;

    let accessToken: string | undefined = latest.accessToken;
    if (accessToken === session.accessToken) {
      try {
        accessToken = await refreshAccessToken(latest);
      } catch (refreshError) {
        if (refreshError instanceof TokenRefreshLogoutError) throw error;
        throw refreshError;
      }
    }
    if (!accessToken) throw error;

    return request(accessToken);
  }
};
