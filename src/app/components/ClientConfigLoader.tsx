import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ClientConfig } from '../hooks/useClientConfig';
import { trimTrailingSlash } from '../utils/common';
import {
  authenticationConfigurationLoaded,
  recoverAuthentication,
} from '../../authenticationRecovery';
import { AUTHENTICATION_RECOVERY_NAVIGATION_PARAM } from '../../serviceWorkerNavigation';

/** The server answered `config.json` with a sign-in redirect or 401/403: the web session expired. */
export class ClientConfigAuthenticationError extends Error {
  constructor(message = 'Client configuration requires signing in again.') {
    super(message);
    this.name = 'ClientConfigAuthenticationError';
  }
}

const RECOVERY_BLOCKED_MESSAGE =
  'Sign-in recovery could not complete. Try again, or reload the page to sign in.';

const DEFAULT_BASE_PATH = trimTrailingSlash(import.meta.env.BASE_URL ?? '/');

const cacheKey = (basePath: string) => `mindroom.client-config:${basePath || '/'}`;

const isConfigObject = (value: unknown): value is ClientConfig =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** The last configuration fetched successfully for this base path, if any. */
export const readCachedClientConfig = (
  basePath: string = DEFAULT_BASE_PATH
): ClientConfig | undefined => {
  try {
    const raw = localStorage.getItem(cacheKey(basePath));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isConfigObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const writeCachedClientConfig = (basePath: string, config: ClientConfig) => {
  try {
    localStorage.setItem(cacheKey(basePath), JSON.stringify(config));
  } catch {
    // A full or unavailable storage only costs the offline start.
  }
};

const isAuthenticationResponse = (response: Response): boolean =>
  response.type === 'opaqueredirect' ||
  response.status === 0 ||
  response.status === 401 ||
  response.status === 403;

/** Fetches `<basePath>/config.json`, validates it, and caches it for offline starts. */
export const fetchClientConfig = async (
  basePath: string = DEFAULT_BASE_PATH
): Promise<ClientConfig> => {
  const response = await fetch(`${basePath}/config.json`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    // An authenticating proxy answers with a redirect to its login page; keep it visible.
    redirect: 'manual',
  });
  if (isAuthenticationResponse(response)) throw new ClientConfigAuthenticationError();
  if (!response.ok) {
    throw new Error(`Failed to load client configuration (HTTP ${response.status}).`);
  }
  const config: unknown = await response.json();
  if (!isConfigObject(config)) throw new Error('Client configuration must be a JSON object.');
  writeCachedClientConfig(basePath, config);
  authenticationConfigurationLoaded();
  return config;
};

/** Drops the marker a sign-in recovery navigation leaves in the URL, keeping history state. */
const removeRecoveryNavigationMarker = () => {
  if (typeof window === 'undefined' || !window.location?.href || !window.history) return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM)) return;
    url.searchParams.delete(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM);
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch {
    // An unparsable location has no marker to remove.
  }
};

/** Without a recovery owner, a top-level navigation lets the proxy run its sign-in. */
const navigateForSignIn = () => {
  if (typeof window === 'undefined' || !window.location?.href) return;
  const url = new URL(window.location.href);
  url.searchParams.set(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM, '1');
  window.location.href = url.href;
};

type LoaderState =
  | { status: 'loading' }
  | { status: 'ready'; config: ClientConfig }
  | { status: 'error'; error: unknown; cached?: ClientConfig };

type ClientConfigLoaderProps = {
  fallback?: () => ReactNode;
  /**
   * `ignore` continues with the cached configuration and is only offered when one exists;
   * `authenticate` starts sign-in recovery.
   */
  error?: (
    error: unknown,
    retry: () => void,
    ignore: (() => void) | undefined,













    const cached = Capacitor.isNativePlatform() ? undefined : readCachedClientConfig();
    return cached ? { status: 'ready', config: cached } : { status: 'loading' };
  });
  const requestRef = useRef(0);
  const startedWithCacheRef = useRef(state.status === 'ready');

  const load = useCallback((background: boolean) => {
    requestRef.current += 1;
    const request = requestRef.current;
    if (!background) setState({ status: 'loading' });
    fetchClientConfig().then(
      (config) => {
        if (request !== requestRef.current || background) return;
        setState({ status: 'ready', config });
      },
      (loadError: unknown) => {
        if (request !== requestRef.current) return;
        if (background && !(loadError instanceof ClientConfigAuthenticationError)) return;
        setState({ status: 'error', error: loadError, cached: readCachedClientConfig() });
      }
    );
  }, []);

  useEffect(() => {
    removeRecoveryNavigationMarker();
    load(startedWithCacheRef.current);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const retry = useCallback(() => load(false), [load]);

  const authenticate = useCallback(() => {
    requestRef.current += 1;
    const request = requestRef.current;
    recoverAuthentication().then(
      (result) => {
        if (request !== requestRef.current) return;
        if (result === 'healthy') {
          load(false);
          return;
        }
        if (result === 'navigating') return;
        if (result === 'unavailable' || result === 'disabled') {
          navigateForSignIn();
          return;
        }
        setState((current) => ({
          status: 'error',
          error: new ClientConfigAuthenticationError(RECOVERY_BLOCKED_MESSAGE),
          cached: current.status === 'error' ? current.cached : readCachedClientConfig(),
        }));
      },
      () => undefined
    );
  }, [load]);

  if (state.status === 'ready') return children(state.config);
  if (state.status === 'loading') return fallback?.() ?? null;

  const { cached } = state;
  const ignore = cached ? () => setState({ status: 'ready', config: cached }) : undefined;
  return error?.(state.error, retry, ignore, authenticate) ?? null;
}
