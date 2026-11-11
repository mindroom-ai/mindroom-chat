import { useEffect, useRef, useState } from 'react';
import { type NavigateFunction, useNavigate } from 'react-router-dom';
import {
  createSessionId,
  listSessions,
  putSession,
  setActiveSession,
  type StoredSession,
} from '../../matrix/session/sessions';
import { createMatrixClient } from '../../matrix/client/matrixClientFactory';
import {
  deleteAfterLoginRedirectPath,
  getAfterLoginRedirectPath,
  isInAppPath,
} from '../../routes/afterLoginRedirectPath';
import { getHomePath } from '../../routes/pathUtils';
import { resolveAuthRouteRedirect } from '../../navigation/routeSessionGuards';

/** Credentials a successful login or registration hands back. */
export type SessionCredentials = {
  access_token?: string;
  device_id?: string;
  user_id: string;
  refresh_token?: string;
  expires_in_ms?: number;
};

export type CompletedAuth<T extends SessionCredentials> = {
  baseUrl: string;
  response: T;
};

/** The stored account a login belongs to, when this browser has it on another device. */
const storedOnOtherDevice = (
  baseUrl: string,
  userId: string,
  deviceId: string
): StoredSession | undefined => {
  const sessionId = createSessionId(baseUrl, userId);
  const stored = listSessions().find((session) => session.sessionId === sessionId);
  return stored && stored.deviceId !== deviceId ? stored : undefined;
};

/** Signs a login's new device out again; best effort, since nothing here depends on it. */
const discardLogin = (baseUrl: string, userId: string, deviceId: string, accessToken: string) => {
  createMatrixClient({ baseUrl, userId, deviceId, accessToken })
    .logout()
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[auth] could not sign out the duplicate login', deviceId, error);
    });
};

/** Opens the page saved before sign-in, or Home, and forgets the saved page. */
export const openAfterSignIn = (navigate: NavigateFunction): void => {
  const redirectPath = getAfterLoginRedirectPath();
  deleteAfterLoginRedirectPath();
  navigate(isInAppPath(redirectPath) ? redirectPath : getHomePath(), { replace: true });
};

/**
 * Stores the new session, makes it active, and opens the page saved before
 * sign-in (or home), through AuthLayout's redirect unless adding an account. Returns true when the browser refused to store the
 * credentials, so the page can tell the user instead of looping.
 *
 * Signing in again to an account this browser has already (Add account, a second login tab)
 * keeps the stored session and its device, with its keys and verification, and signs the new
 * device out. Replacing it would leave the old device on the account, where other people keep
 * encrypting to it, and its key database in the browser.
 */
export const useCompleteSession = <T extends SessionCredentials>(
  data: CompletedAuth<T> | undefined
): boolean => {
  const navigate = useNavigate();
  const [storeFailed, setStoreFailed] = useState(false);
  const handledResponse = useRef<T>();

  const baseUrl = data?.baseUrl;
  const response = data?.response;

  useEffect(() => {
    if (!baseUrl || !response || handledResponse.current === response) return;
    handledResponse.current = response;
    const { access_token: accessToken, device_id: deviceId, user_id: userId } = response;
    if (!accessToken || !deviceId) return;

    try {
      const stored = storedOnOtherDevice(baseUrl, userId, deviceId);
      if (stored) {
        discardLogin(baseUrl, userId, deviceId, accessToken);
        setActiveSession(stored.sessionId);
      } else {
        putSession({
          baseUrl,
          userId,
          deviceId,
          accessToken,
          refreshToken: response.refresh_token,
          expiresInMs: response.expires_in_ms,
        });
      }
    } catch {
      setStoreFailed(true);
      return;
    }

    // AuthLayout sends an active session off the sign-in pages, after this effect, and so opens
    // the page itself; a navigation from here would lose to its redirect. When adding an account
    // it stays, and the page opens from here.
    if (!resolveAuthRouteRedirect(window.location.href)) openAfterSignIn(navigate);
  }, [baseUrl, response, navigate]);

  return storeFailed;
};
