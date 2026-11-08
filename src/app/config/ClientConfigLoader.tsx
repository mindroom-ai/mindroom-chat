import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { type ClientConfig, useOptionalClientConfig } from './useClientConfig';
import { trimTrailingSlash } from '../lib/common';
import {
  authenticationConfigurationLoaded,
  recoverAuthentication,
} from '../../boot/authenticationRecovery';
import { AUTHENTICATION_RECOVERY_NAVIGATION_PARAM } from '../../boot/serviceWorkerNavigation';

/** The server answered `config.json` with a sign-in redirect or 401/403: the web session expired. */
export class ClientConfigAuthenticationError extends Error {
  constructor(message = 'Client configuration requires signing in again.') {
    super(message);
    this.name = 'ClientConfigAuthenticationError';
  }
}

/** The server answered `config.json` with another error status, which `httpStatus` keeps. */
class ClientConfigHttpError extends Error {
  constructor(readonly httpStatus: number) {
    super(`Failed to load client configuration (HTTP ${httpStatus}).`);
    this.name = 'ClientConfigHttpError';
  }
}

const RECOVERY_BLOCKED_MESSAGE =
  'Sign-in recovery could not complete. Try again, or reload the page to sign in.';

const DEFAULT_BASE_PATH = trimTrailingSlash(import.meta.env.BASE_URL ?? '/');

// Named after the URL it caches; the end-to-end specs clear this key to load a new policy.
const cacheKey = (basePath: string) => `io.mindroom.client-config:${basePath}/config.json`;

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

/**
 * The loaded configuration, else the last one this browser loaded: what the screens shown before
 * or instead of a fresh load (the loading splash, the configuration error) go by.
 */
export const useLoadedOrCachedClientConfig = (): ClientConfig | undefined => {
  const loaded = useOptionalClientConfig();
  return useMemo(() => loaded ?? readCachedClientConfig(), [loaded]);
};

const writeCachedClientConfig = (basePath: string, config: ClientConfig) => {
  try {
    localStorage.setItem(cacheKey(basePath), JSON.stringify(config));
  } catch {
    // A full or unavailable storage only costs the offline start.
  }
};

/**
 * What the router is built from (`createRouter` in src/app/shell/Router.tsx): a refreshed
 * configuration that changes it needs a new router, which would drop the page's state, so it waits
 * for the next load.
 */
const routing = (config: ClientConfig): string =>
  JSON.stringify([config.hashRouter ?? null, config.sidebar?.showMindRoom ?? null]);

/** The configuration to render once a fresh copy arrived during a page load already rendering one. */
const refreshed = (shown: ClientConfig, fresh: ClientConfig): ClientConfig => {
  if (JSON.stringify(shown) === JSON.stringify(fresh)) return shown;
  return routing(shown) === routing(fresh) ? fresh : shown;
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
  if (!response.ok) throw new ClientConfigHttpError(response.status);
  const config: unknown = await response.json();
  if (!isConfigObject(config)) throw new Error('Client configuration must be a JSON object.');
  writeCachedClientConfig(basePath, config);
  authenticationConfigurationLoaded();
  return config;
};

/** The page address, or `undefined` outside a browser or when it does not parse. */
const readLocationUrl = (): URL | undefined => {
  const href = typeof window === 'undefined' ? undefined : window.location?.href;
  if (!href) return undefined;
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
};

/** Drops the marker a sign-in recovery navigation leaves in the URL, keeping history state. */
const removeRecoveryNavigationMarker = () => {
  const url = readLocationUrl();
  if (!url?.searchParams.has(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM)) return;
  const { history } = window;
  if (!history) return;
  url.searchParams.delete(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM);
  const path = [url.pathname, url.search, url.hash].join('');
  try {
    history.replaceState(history.state, '', path);
  } catch {
    // A document that refuses history updates keeps the marker; it is harmless.
  }
};

/** Without a recovery owner, a top-level navigation lets the proxy run its sign-in. */
const navigateForSignIn = () => {
  const url = readLocationUrl();
  if (!url) return;
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
    authenticate: () => void
  ) => ReactNode;
  children: (config: ClientConfig) => ReactNode;
};

/**
 * Loads the deployment's `config.json` before rendering `children`. A cached copy renders at once
 * (web only) while a fresh fetch runs in the background; only a sign-in failure interrupts it. A
 * fresh copy that differs replaces the cached one on screen, unless it routes differently.
 */
export function ClientConfigLoader({ children, error, fallback }: ClientConfigLoaderProps) {
  const [state, setState] = useState<LoaderState>(() => {
    // Native apps wait for a fresh configuration; the web starts from the cached one.
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
        if (request !== requestRef.current) return;
        if (!background) {
          setState({ status: 'ready', config });
          return;
        }
        // Operator switches (canvases off, the auto-open allowlist, error reports) apply on this load.
        setState((current) => {
          if (current.status !== 'ready') return current;
          const shown = refreshed(current.config, config);
          return shown === current.config ? current : { status: 'ready', config: shown };
        });
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
