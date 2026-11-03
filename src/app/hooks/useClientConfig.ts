import { createContext, useContext } from 'react';

const configContext = createContext<ClientConfig | undefined>(undefined);
configContext.displayName = 'ClientConfig';

/** Supplies the loaded `config.json` to everything rendered below it. */
export const ClientConfigProvider = configContext.Provider;

/** The deployment's configuration; throws when no `ClientConfigProvider` is above the caller. */
export const useClientConfig = (): ClientConfig => {
  const provided = useContext(configContext);
  if (provided === undefined) {
    throw new Error('useClientConfig() was called outside a ClientConfigProvider');
  }
  return provided;
};

/** A homeserver's server name, such as `mindroom.chat`. */
type ServerName = string;

/** A room or space, by room ID (`!abc:server`) or alias (`#name:server`). */
type RoomIdOrAlias = string;

/** Hash routing for hosts that cannot rewrite every path to `index.html`. */
type HashRouterConfig = {
  enabled?: boolean;
  basename?: string;
};

/** The sign-in and registration pages. */
type AuthConfig = {
  allowRegistration?: boolean;
  disablePasswordLogin?: boolean;
  /** Ask for Sign in with Apple on the primary MindRoom homeserver (App Store requirement). */
  requireAppleProvider?: boolean;
  /** Hide the homeserver picker when the list holds a single homeserver. */
  hideServerPickerWhenSingle?: boolean;
  /** Credits under the sign-in card; an empty list hides the credit line. */
  poweredBy?: { label: string; url: string }[];
  supportUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
};

/** The Explore page's Featured section, and whether the Explore tab opens it first. */
type FeaturedCommunitiesConfig = {
  openAsDefault?: boolean;
  spaces?: RoomIdOrAlias[];
  rooms?: RoomIdOrAlias[];
  /** Homeservers whose public room directories the Explore page suggests. */
  servers?: ServerName[];
};

type SidebarConfig = {
  showThreads?: boolean;
  showExploreCommunity?: boolean;
  /** The Local MindRoom tab; on unless set to false. */
  showMindRoom?: boolean;
  /** Where the Local MindRoom tab links for more about MindRoom. */
  mindRoomUrl?: string;
  /** Provisioning service the Local MindRoom pairing flow talks to. */
  mindRoomProvisioningUrl?: string;
};

/**
 * The deployment's `config.json`. Every field is optional: a missing field means the built-in
 * default, so an empty object is a valid configuration.
 */
export type ClientConfig = {
  /** Homeservers offered on the login and registration pages. */
  homeserverList?: ServerName[];
  /** Index into `homeserverList` of the preselected homeserver. */
  defaultHomeserver?: number;
  /** Whether people may type a homeserver that is not in the list. */
  allowCustomHomeservers?: boolean;
  auth?: AuthConfig;

  hashRouter?: HashRouterConfig;
  featuredCommunities?: FeaturedCommunitiesConfig;
  sidebar?: SidebarConfig;

  createRoom?: {
    showEncryptionOption?: boolean;
    defaultEncryption?: boolean;
    showFederationOption?: boolean;
    defaultFederation?: boolean;
  };

  /** Messages the loading screen rotates through while the client starts. */
  splash?: {
    loadingMessages?: string[];
  };

  messageRendering?: {
    /** URI schemes, besides the web and Matrix ones, that links in messages may use. */
    additionalAllowedUriSchemes?: string[];
  };

  /** Copy and links on the welcome page. */
  welcome?: {
    title?: string;
    subtitle?: string;
    poweredBy?: string;
    docsLabel?: string;
    docsUrl?: string;
    sourceLabel?: string;
    sourceUrl?: string;
  };

  push?: {
    ios?: {
      enabled?: boolean;
      appId?: string;
      gatewayUrl?: string;
      appDisplayName?: string;
      deviceDisplayName?: string;
      profileTag?: string;
      append?: boolean;
      format?: string;
      lang?: string;
    };
  };

  mindroom?: {
    /** Messages shown while an agent is thinking, in place of the built-in ones. */
    thinkingPlaceholderMessages?: string[];
    canvas?: {
      enabled?: boolean;
      /** Lets canvas pages load libraries from the library CDN. */
      libraries?: boolean;
    };
    computers?: {
      /** Base URL of the computer API; empty means this deployment's origin. */
      apiUrl?: string;
    };
    uiActions?: {
      /** Homeservers whose agents may open panels without a click. */
      autoOpenFromHomeservers?: string[];
    };
  };
};
