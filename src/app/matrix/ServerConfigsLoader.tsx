import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { ClientPrefix, HTTPError, MatrixError, Method, type MatrixClient } from 'matrix-js-sdk';
import { parseHttpUrl } from '../lib/httpUrl';
import { isRecord } from '../lib/isRecord';

/** `GET /media/config`; the SDK does not export its type. */
export type MediaConfig = Awaited<ReturnType<MatrixClient['getMediaConfig']>>;

/** The client call behind each config field. */
type ConfigSources = {
  /** `GET /capabilities`: which account changes the server allows. */
  capabilities: MatrixClient['getCapabilities'];
  /** Upload limits; see {@link MediaConfig}. */
  mediaConfig: MatrixClient['getMediaConfig'];
};

/** What the account management links read of the auth provider's OAuth 2.0 metadata (MSC2965). */
export type AccountManagementMetadata = {
  issuer: string;
  account_management_uri?: string;
};

/** What the homeserver reports about itself; a field is missing when its request failed. */
export type ServerConfigs = {
  [Field in keyof ConfigSources]?: Awaited<ReturnType<ConfigSources[Field]>>;
} & {
  /** Where the auth provider manages the account (MSC2965), when the homeserver delegates auth. */
  authMetadata?: AccountManagementMetadata;
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

const MSC2965_PREFIX = `${ClientPrefix.Unstable}/org.matrix.msc2965`;

/**
 * Whether the homeserver does not have the route: `M_UNRECOGNIZED`, or a 404 of any kind, which is
 * what a proxy or a server from before that error code answers.
 */
const isUnknownRoute = (error: unknown): boolean =>
  (error instanceof MatrixError && error.errcode === 'M_UNRECOGNIZED') ||
  (error instanceof HTTPError && error.httpStatus === 404);

const requestAuthMetadata = (client: MatrixClient, prefix: string): Promise<unknown> =>
  client.http.request(Method.Get, '/auth_metadata', undefined, undefined, { prefix });

/**
 * The provider's OAuth 2.0 metadata: from the stable route (Matrix 1.15) or, for a homeserver that
 * does not know it, from the two MSC2965 routes matrix-js-sdk asked until 42.0: `auth_metadata`,
 * then `auth_issuer` and that issuer's OpenID configuration.
 */
const fetchAuthMetadata = async (client: MatrixClient): Promise<unknown> => {
  try {
    return await requestAuthMetadata(client, ClientPrefix.V1);
  } catch (error) {
    if (!isUnknownRoute(error)) throw error;
  }
  try {
    return await requestAuthMetadata(client, MSC2965_PREFIX);
  } catch (error) {
    if (!isUnknownRoute(error)) throw error;
  }
  const { issuer } = await client.http.request<{ issuer: string }>(
    Method.Get,
    '/auth_issuer',
    undefined,
    undefined,
    { prefix: MSC2965_PREFIX }
  );
  return client.http.requestOtherUrl(
    Method.Get,
    new URL('.well-known/openid-configuration', issuer),
    undefined,
    { localTimeoutMs: 5000 }
  );
};

/**
 * What the account and device settings link to, read from the provider's metadata. The SDK's own
 * `getAuthMetadata` is not used: it checks what a login needs (a registration endpoint, the
 * response modes), which older providers do not state, and these links need none of it.
 */
const loadAccountManagementMetadata = async (
  client: MatrixClient
): Promise<AccountManagementMetadata> => {
  const metadata = await fetchAuthMetadata(client);
  if (!isRecord(metadata)) throw new Error('Invalid auth metadata');
  const { issuer, account_management_uri: accountManagementUri } = metadata;
  // The links are opened in a browser, so both must be http(s) URLs.
  if (typeof issuer !== 'string' || !parseHttpUrl(issuer)) throw new Error('Invalid issuer');
  if (accountManagementUri === undefined) return { issuer };
  if (typeof accountManagementUri !== 'string' || !parseHttpUrl(accountManagementUri)) {
    throw new Error('Invalid account management URL');
  }
  return { issuer, account_management_uri: accountManagementUri };
};

const loadServerConfigs = async (client: MatrixClient): Promise<ServerConfigs> => {
  // Each request may fail on its own (older servers lack auth metadata); the rest still count.
  const [capabilities, mediaConfig, authMetadata] = await Promise.allSettled([
    client.getCapabilities(),
    loadMediaConfig(client),
    loadAccountManagementMetadata(client),
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
    void loadServerConfigs(mx).then((loaded) => {
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
