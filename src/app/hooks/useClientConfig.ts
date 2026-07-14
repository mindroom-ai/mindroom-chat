import { createContext, useContext } from 'react';
import { autoDiscovery, type AutoDiscoveryInfo } from '../cs-api';
import { trimTrailingSlash } from '../utils/common';

export type HashRouterConfig = {
  enabled?: boolean;
  basename?: string;
};

export type ClientConfig = {
  defaultHomeserver?: number;
  homeserverList?: string[];
  allowCustomHomeservers?: boolean;
  homeserverDiscovery?: Record<string, AutoDiscoveryInfo>;

  push?: {
    ios?: {
      enabled?: boolean;
      appId?: string;
      gatewayUrl?: string;
      appDisplayName?: string;
      deviceDisplayName?: string;
      profileTag?: string;
      append?: boolean;
      format?: 'event_id_only' | 'full';
      lang?: string;
    };
  };

  featuredCommunities?: {
    openAsDefault?: boolean;
    spaces?: string[];
    rooms?: string[];
    servers?: string[];
  };

  hashRouter?: HashRouterConfig;

  splash?: {
    loadingMessages?: string[];
  };

  mindroom?: {
    thinkingPlaceholderMessages?: string[];
  };

  sidebar?: {
    showThreads?: boolean;
    showExploreCommunity?: boolean;
    showAddSpace?: boolean;
    showMindRoom?: boolean;
    mindRoomUrl?: string;
    mindRoomProvisioningUrl?: string;
  };

  auth?: {
    hideServerPickerWhenSingle?: boolean;
    allowRegistration?: boolean;
    disablePasswordLogin?: boolean;
    requireAppleProvider?: boolean;
    supportUrl?: string;
    privacyPolicyUrl?: string;
    termsUrl?: string;
  };

  createRoom?: {
    showEncryptionOption?: boolean;
    defaultEncryption?: boolean;
    showFederationOption?: boolean;
    defaultFederation?: boolean;
  };

  welcome?: {
    title?: string;
    subtitle?: string;
    sourceLabel?: string;
    sourceUrl?: string;
    docsLabel?: string;
    docsUrl?: string;
    poweredBy?: {
      label: string;
      url: string;
    }[];
  };
};

const ClientConfigContext = createContext<ClientConfig | null>(null);

export const ClientConfigProvider = ClientConfigContext.Provider;

export function useClientConfig(): ClientConfig {
  const config = useContext(ClientConfigContext);
  if (!config) throw new Error('Client config are not provided!');
  return config;
}

export const clientDefaultServer = (clientConfig: ClientConfig): string =>
  clientConfig.homeserverList?.[clientConfig.defaultHomeserver ?? 0] ?? 'matrix.org';

export const clientAllowedServer = (clientConfig: ClientConfig, server: string): boolean => {
  const { homeserverList, allowCustomHomeservers } = clientConfig;

  if (allowCustomHomeservers) return true;

  return homeserverList?.includes(server) === true;
};

const normalizeHomeserverReference = (value: string): string => {
  const candidate = /^https?:\/\//.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(candidate);
    return `${url.protocol}//${url.host}${trimTrailingSlash(url.pathname)}`;
  } catch {
    return trimTrailingSlash(value);
  }
};

const discoveryHomeserverBaseUrl = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const homeserver = (value as Record<string, unknown>)['m.homeserver'];
  if (!homeserver || typeof homeserver !== 'object' || Array.isArray(homeserver)) return undefined;

  const baseUrl = (homeserver as Record<string, unknown>).base_url;
  return typeof baseUrl === 'string' ? baseUrl : undefined;
};

export const clientConfiguredDiscovery = (
  clientConfig: ClientConfig,
  server: string,
  baseUrl?: string
): AutoDiscoveryInfo | undefined => {
  const entries = Object.entries(clientConfig.homeserverDiscovery ?? {});
  if (baseUrl) {
    const normalizedBaseUrl = normalizeHomeserverReference(baseUrl);
    return entries.find(([configuredServer, discovery]) => {
      const discoveryBaseUrl = discoveryHomeserverBaseUrl(discovery);
      return (
        normalizeHomeserverReference(configuredServer) === normalizedBaseUrl ||
        (discoveryBaseUrl !== undefined &&
          normalizeHomeserverReference(discoveryBaseUrl) === normalizedBaseUrl)
      );
    })?.[1];
  }

  const normalizedServer = normalizeHomeserverReference(server);
  return entries.find(
    ([configuredServer]) => normalizeHomeserverReference(configuredServer) === normalizedServer
  )?.[1];
};

export const clientAutoDiscovery = (
  clientConfig: ClientConfig,
  request: typeof fetch,
  server: string,
  baseUrl?: string
) => autoDiscovery(request, server, clientConfiguredDiscovery(clientConfig, server, baseUrl));
