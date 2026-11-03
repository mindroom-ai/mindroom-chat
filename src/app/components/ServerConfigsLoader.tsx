import { ReactNode, useEffect, useState } from 'react';
import type { Capabilities, MatrixClient, OidcClientConfig } from 'matrix-js-sdk';

/** `GET /media/config`; the SDK does not export its type. */
export type MediaConfig = Awaited<ReturnType<MatrixClient['getMediaConfig']>>;




  /** OAuth 2.0 server metadata (MSC2965), when the homeserver delegates auth. */
  authMetadata?: OidcClientConfig;
};





};

const settledValue = <T,>(result: PromiseSettledResult<T>): T | undefined =>
  result.status === 'fulfilled' ? result.value : undefined;

const loadServerConfigs = async (mx: MatrixClient): Promise<ServerConfigs> => {
  // Each request may fail on its own (older servers lack auth metadata); the rest still count.
  const [capabilities, mediaConfig, authMetadata] = await Promise.allSettled([



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
