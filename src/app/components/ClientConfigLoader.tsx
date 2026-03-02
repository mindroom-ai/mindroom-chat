import { ReactNode, useCallback, useEffect, useState } from 'react';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { ClientConfig } from '../hooks/useClientConfig';
import { reconcileFallbackSessionHomeserver } from '../state/sessions';
import { appUrl, getAppBasePath } from '../utils/basePath';

export const getClientConfigUrl = (basePath: string = getAppBasePath()): string =>
  appUrl('config.json', basePath);

export const fetchClientConfig = async (basePath: string = getAppBasePath()): Promise<ClientConfig> => {
  const url = getClientConfigUrl(basePath);
  const config = await fetch(url, { method: 'GET' });
  return config.json();
};

type ClientConfigLoaderProps = {
  fallback?: () => ReactNode;
  error?: (err: unknown, retry: () => void, ignore: () => void) => ReactNode;
  children: (config: ClientConfig) => ReactNode;
};
export function ClientConfigLoader({ fallback, error, children }: ClientConfigLoaderProps) {
  const [state, load] = useAsyncCallback(fetchClientConfig);
  const [ignoreError, setIgnoreError] = useState(false);
  const config = state.status === AsyncStatus.Success ? state.data : undefined;

  const ignoreCallback = useCallback(() => setIgnoreError(true), []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!config) return;

    reconcileFallbackSessionHomeserver(config);
  }, [config]);

  if (state.status === AsyncStatus.Idle || state.status === AsyncStatus.Loading) {
    return fallback?.();
  }

  if (!ignoreError && state.status === AsyncStatus.Error) {
    return error?.(state.error, load, ignoreCallback);
  }

  const resolvedConfig: ClientConfig = config ?? {};

  return children(resolvedConfig);
}
