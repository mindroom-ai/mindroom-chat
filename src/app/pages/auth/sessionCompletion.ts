import { useEffect, useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { deleteAfterLoginRedirectPath, getAfterLoginRedirectPath } from '../afterLoginRedirectPath';
import { getHomePath } from '../pathUtils';
import { putSession } from '../../state/sessions';

export type CompletedSession = {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  expiresInMs?: number;
  refreshToken?: string;
};

const completeSession = (
  session: CompletedSession,
  addAccount: boolean,
  navigate: NavigateFunction
): boolean => {
  try {
    putSession(session);
  } catch {
    return false;
  }

  if (addAccount) {
    navigate(getHomePath(), { replace: true });
    return true;
  }

  const afterLoginRedirectPath = getAfterLoginRedirectPath();
  deleteAfterLoginRedirectPath();
  navigate(afterLoginRedirectPath ?? getHomePath(), { replace: true });
  return true;
};

export const useSessionCompletion = (
  session: CompletedSession | undefined,
  addAccount: boolean
): boolean => {
  const navigate = useNavigate();
  const [sessionStoreError, setSessionStoreError] = useState(false);

  useEffect(() => {
    if (!session) return;
    setSessionStoreError(false);
    if (!completeSession(session, addAccount, navigate)) {
      setSessionStoreError(true);
    }
  }, [addAccount, session, navigate]);

  return sessionStoreError;
};
