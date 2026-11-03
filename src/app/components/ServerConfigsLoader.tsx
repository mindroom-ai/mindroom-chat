import { ReactNode, useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';

/** `GET /media/config`; the SDK does not export its type. */
export type MediaConfig = Awaited<ReturnType<MatrixClient['getMediaConfig']>>;

/** The client call behind each config field. */
type ConfigSources = {
  /** `GET /capabilities`: which account changes the server allows. */
  capabilities: MatrixClient['getCapabilities'];
  /** Upload limits; see {@link MediaConfig}. */
  mediaConfig: MatrixClient['getMediaConfig'];
  /** OAuth 2.0 server metadata (MSC2965), when the homeserver delegates auth. */
  authMetadata: MatrixClient['getAuthMetadata'];
};

/** What the homeserver reports about itself; a field is missing when its request failed. */
export type ServerConfigs = {
  [Field in keyof ConfigSources]?: Awaited<ReturnType<ConfigSources[Field]>>;
};

type RenderWithConfigs = (configs: ServerConfigs) => ReactNode;

type ServerConfigsLoaderProps = {
  /** Passed explicitly: the loader runs before the client context exists. */
  mx: MatrixClient;
  children: RenderWithConfigs;
};

const settledValue = <T,>(result: PromiseSettledResult<T>): T | undefined =>
  result.status === 'fulfilled' ? result.value : undefined;

const loadServerConfigs = async (client: MatrixClient): Promise<ServerConfigs> => {
  // Each request may fail on its own (older servers lack auth metadata); the rest still count.
  const [capabilities, mediaConfig, authMetadata] = await Promise.allSettled([
    client.getCapabilities(),
    client.getMediaConfig(),
    client.getAuthMetadata(),
  ]);
  return {
    capabilities: settledValue(capabilities),
    mediaConfig: settledValue(mediaConfig),
    authMetadata: settledValue(authMetadata),
  };
};

/** Fetches the homeserver's capabilities, media limits and auth metadata, then renders children. */
export function ServerConfigsLoader({ mx, children }: ServerConfigsLoaderProps) {
  const [configs, setConfigs] = useState<ServerConfigs>();

  useEffect(() => {
    let current = true;
    setConfigs(undefined);
    loadServerConfigs(mx).then((loaded) => {
      if (current) setConfigs(loaded);
    });
    return () => {
      current = false;
    };
  }, [mx]);

  if (!configs) return null;
  return children(configs);
}
