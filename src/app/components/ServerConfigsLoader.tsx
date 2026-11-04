import React, { ReactNode, createContext, useContext, useEffect, useState } from 'react';
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

// Servers that require authenticated media (Matrix 1.11) refuse the legacy `/media/v3/config`,
// and older servers lack `/client/v1/media/config`: ask the authenticated one first.
const loadMediaConfig = (client: MatrixClient): Promise<MediaConfig> =>
  client.getMediaConfig(true).catch(() => client.getMediaConfig(false));

const loadServerConfigs = async (client: MatrixClient): Promise<ServerConfigs> => {
  // Each request may fail on its own (older servers lack auth metadata); the rest still count.
  const [capabilities, mediaConfig, authMetadata] = await Promise.allSettled([
    client.getCapabilities(),
    loadMediaConfig(client),
    client.getAuthMetadata(),
  ]);
  return {
    capabilities: settledValue(capabilities),
    mediaConfig: settledValue(mediaConfig),
    authMetadata: settledValue(authMetadata),
  };
};

const LoadedConfigs = createContext<ServerConfigs>({});

/** Until the homeserver answers, every field reads as missing. */
const NOT_LOADED: ServerConfigs = {};

/**
 * Fetches the homeserver's capabilities, media limits and auth metadata. Children render at once
 * with no fields, so a shell restored from the store never waits for (or, offline, on) these
 * requests, and render again with what the server reported.
 */
export function ServerConfigsLoader({ mx, children }: ServerConfigsLoaderProps) {
  const [configs, setConfigs] = useState<ServerConfigs>(NOT_LOADED);

  useEffect(() => {
    let current = true;
    setConfigs(NOT_LOADED);
    loadServerConfigs(mx).then((loaded) => {
      if (current) setConfigs(loaded);
    });
    return () => {
      current = false;
    };
  }, [mx]);

  return <LoadedConfigs.Provider value={configs}>{children(configs)}</LoadedConfigs.Provider>;
}

/**
 * What the nearest loader fetched, for components far below it (the account and device settings
 * read the auth metadata here instead of requesting it again); empty outside a loader.
 */
export const useServerConfigs = (): ServerConfigs => useContext(LoadedConfigs);
