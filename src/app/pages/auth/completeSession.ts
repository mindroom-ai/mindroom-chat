import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { putSession } from '../../state/sessions';
import { deleteAfterLoginRedirectPath, getAfterLoginRedirectPath } from '../afterLoginRedirectPath';
import { getHomePath } from '../pathUtils';

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

/**
 * Stores the new session, makes it active, and opens the page saved before
 * sign-in (or home). Returns true when the browser refused to store the
 * credentials, so the page can tell the user instead of looping.
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
      putSession({
        baseUrl,
        userId,
        deviceId,
        accessToken,
        refreshToken: response.refresh_token,
        expiresInMs: response.expires_in_ms,
      });
    } catch {
      setStoreFailed(true);
      return;
    }

    const redirectPath = getAfterLoginRedirectPath();
    deleteAfterLoginRedirectPath();
    navigate(redirectPath ?? getHomePath(), { replace: true });
  }, [baseUrl, response, navigate]);

  return storeFailed;
};
