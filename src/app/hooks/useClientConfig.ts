import { createContext, useContext } from 'react';

export type HashRouterConfig = {
  enabled?: boolean;
  basename?: string;
};

export type ClientConfig = {
  defaultHomeserver?: number;
  homeserverList?: string[];
  allowCustomHomeservers?: boolean;

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

  sidebar?: {
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
