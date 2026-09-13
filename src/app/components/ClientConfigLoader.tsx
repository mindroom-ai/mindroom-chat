import { ReactNode, useCallback, useEffect, useState } from 'react';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { ClientConfig } from '../hooks/useClientConfig';
import { appUrl, getAppBasePath } from '../utils/basePath';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../utils/safeLocalStorage';

const CLIENT_CONFIG_STORAGE_PREFIX = 'io.cinny.client-config:';

export class ClientConfigAuthenticationError extends Error {
  constructor() {
    super('Interactive sign-in is required.');
    this.name = 'ClientConfigAuthenticationError';
  }
}

export const isClientConfigAuthenticationError = (
  error: unknown
): error is ClientConfigAuthenticationError => error instanceof ClientConfigAuthenticationError;

export const getClientConfigUrl = (basePath: string = getAppBasePath()): string =>
  appUrl('config.json', basePath);

const getClientConfigStorageKey = (basePath: string = getAppBasePath()): string =>
  `${CLIENT_CONFIG_STORAGE_PREFIX}${getClientConfigUrl(basePath)}`;

const asClientConfig = (value: unknown): ClientConfig => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Client configuration must be a JSON object.');
  }
  return value as ClientConfig;
};

export const readCachedClientConfig = (
  basePath: string = getAppBasePath()
): ClientConfig | undefined => {
  const value = getStorageItemSafe(getSafeLocalStorage(), getClientConfigStorageKey(basePath));
  if (value === null) return undefined;

  try {
    return asClientConfig(JSON.parse(value));
  } catch {
    return undefined;
  }
};

const cacheClientConfig = (config: ClientConfig, basePath: string): void => {
  setStorageItemSafe(
    getSafeLocalStorage(),
    getClientConfigStorageKey(basePath),
    JSON.stringify(config)
  );
};

export const fetchClientConfig = async (
  basePath: string = getAppBasePath()
): Promise<ClientConfig> => {
  const url = getClientConfigUrl(basePath);
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'manual',
  });

  if (response.type === 'opaqueredirect') {
    throw new ClientConfigAuthenticationError();
  }
  if (!response.ok) {
    throw new Error(`Failed to load client configuration (HTTP ${response.status}).`);
  }

  const config = asClientConfig(await response.json());
  cacheClientConfig(config, basePath);
  return config;
};

export const reloadForInteractiveAuthentication = (): void => window.location.reload();

type ClientConfigLoaderProps = {
  fallback?: () => ReactNode;
  error?: (
    err: unknown,
    retry: () => void,
    ignore: (() => void) | undefined,
    authenticate: () => void
  ) => ReactNode;
  children: (config: ClientConfig) => ReactNode;
};
export function ClientConfigLoader({ fallback, error, children }: ClientConfigLoaderProps) {
  const [state, load] = useAsyncCallback(fetchClientConfig);
  const [ignoreError, setIgnoreError] = useState(false);
  const config = state.status === AsyncStatus.Success ? state.data : undefined;
  const cachedConfig = readCachedClientConfig();

  const ignoreCallback = useCallback(() => setIgnoreError(true), []);
  const retryCallback = useCallback(() => {
    setIgnoreError(false);
    void load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    retryCallback();
  }, [retryCallback]);

  if (state.status === AsyncStatus.Idle || state.status === AsyncStatus.Loading) {
    return fallback?.();
  }

  if (!ignoreError && state.status === AsyncStatus.Error) {
    return error?.(
      state.error,
      retryCallback,
      cachedConfig === undefined ? undefined : ignoreCallback,
      reloadForInteractiveAuthentication
    );
  }

  const resolvedConfig: ClientConfig = config ?? cachedConfig ?? {};

  return children(resolvedConfig);
}
