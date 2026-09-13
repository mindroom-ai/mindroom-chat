import { ClientConfig } from '../hooks/useClientConfig';
import { getActiveSession, hasStoredSessions } from '../state/sessions';
import { isAddAccountSearch } from './auth/addAccount';
import { getAppPathFromHref, getHomePath, getLoginPath, getOriginBaseUrl } from './pathUtils';

export type RouteRedirectDecision = {
  redirectTo: string;
  afterLoginPath?: string;
};

export const resolveRootRouteRedirect = (
  href: string,
  activeSession = getActiveSession()
): RouteRedirectDecision => {
  if (activeSession) {
    return {
      redirectTo: getHomePath(),
    };
  }

  const afterLoginPath = getAppPathFromHref(getOriginBaseUrl(), href);
  return {
    redirectTo: getLoginPath(),
    afterLoginPath: afterLoginPath || undefined,
  };
};

export const resolveAuthRouteRedirect = (
  requestUrl: string,
  activeSession = getActiveSession()
): string | null => {
  if (activeSession && !isAddAccountSearch(new URL(requestUrl).search)) {
    return getHomePath();
  }

  return null;
};

export const resolveProtectedRouteRedirect = (
  href: string,
  hashRouterConfig: ClientConfig['hashRouter'],
  storedSessions = hasStoredSessions(),
  activeSession = getActiveSession()
): RouteRedirectDecision | null => {
  if (!storedSessions) {
    const afterLoginPath = getAppPathFromHref(getOriginBaseUrl(hashRouterConfig), href);
    return {
      redirectTo: getLoginPath(),
      afterLoginPath: afterLoginPath || undefined,
    };
  }

  if (!activeSession) {
    return {
      redirectTo: getLoginPath(),
    };
  }

  return null;
};
