import { createContext, createElement, useContext, useLayoutEffect, type ReactNode } from 'react';

const configContext = createContext<ClientConfig | undefined>(undefined);
configContext.displayName = 'ClientConfig';
/** How many `ClientConfigProvider`s are above, so the innermost one's configuration counts. */
const depthContext = createContext(0);

/** What each mounted `ClientConfigProvider` supplies, at its depth, in the order they mounted. */
const mountedProviders: { config: ClientConfig | undefined; depth: number }[] = [];

/**
 * Supplies the loaded `config.json` to everything rendered below it, and to `getClientConfig()`
 * while it is mounted: from before the `useEffect` mount effects of what it renders run, though
 * after their layout effects.
 */
export function ClientConfigProvider({
  value,
  children,
}: {
  value: ClientConfig | undefined;
  children?: ReactNode;
}) {
  const depth = useContext(depthContext) + 1;
  useLayoutEffect(() => {
    const entry = { config: value, depth };
    mountedProviders.push(entry);
    return () => {
      mountedProviders.splice(mountedProviders.indexOf(entry), 1);
    };
  }, [value, depth]);
  return createElement(
    depthContext.Provider,
    { value: depth },
    createElement(configContext.Provider, { value }, children)
  );
}

/**
 * The configuration of the innermost mounted `ClientConfigProvider`, as `useClientConfig` gives it
 * below that provider (of several as deep, the last to mount or change), for code that runs
 * outside components, such as a plugin command's `run`; undefined while none is mounted.
 */
export const getClientConfig = (): ClientConfig | undefined =>
  mountedProviders.reduce<(typeof mountedProviders)[number] | undefined>(
    (innermost, entry) => (!innermost || entry.depth >= innermost.depth ? entry : innermost),
    undefined
  )?.config;

/** The deployment's configuration; throws when no `ClientConfigProvider` is above the caller. */
export const useClientConfig = (): ClientConfig => {
  const provided = useContext(configContext);
  if (provided === undefined) {
    throw new Error('useClientConfig() was called outside a ClientConfigProvider');
  }
  return provided;
};

/** The deployment's configuration, or undefined without a `ClientConfigProvider` above. */
export const useOptionalClientConfig = (): ClientConfig | undefined => useContext(configContext);

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

/**
 * A deployment's own look on the signed-out pages (docs/configuration.md "Branding"). Values come
 * from an operator's file: `resolveDeploymentBranding` checks each one and keeps the default for
 * any it refuses.
 */
type BrandingConfig = {
  /** The name in the sign-in card's header, on the pairing page, the loading screens and the tab. */
  title?: string;
  /** An https or same-origin image; `srcDark` in dark themes. */
  logo?: { src?: string; srcDark?: string; alt?: string };
  /**
   * Plain text and http, https or mailto links under the sign-in card. `text` may be a list of
   * texts and links, shown as one line.
   */
  footer?: {
    text?: string | (string | { label: string; url: string })[];
    links?: { label: string; url: string }[];
  };
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
  /**
   * Local MindRoom: the rail tab, its Settings page, the welcome page's setup steps and the
   * `/connect` pairing page; on unless set to false.
   */
  showMindRoom?: boolean;
  /** Read by nothing; kept because the ported WelcomePage test's config still sets it. */
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
  branding?: BrandingConfig;
  /**
   * The theme people see until they pick one in Settings, Appearance, and on the signed-out pages:
   * a theme's name, such as `green`; any other value keeps the light or dark theme the system's
   * preference picks.
   */
  defaultTheme?: string;

  hashRouter?: HashRouterConfig;
  featuredCommunities?: FeaturedCommunitiesConfig;
  sidebar?: SidebarConfig;

  createRoom?: {
    showEncryptionOption?: boolean;
    defaultEncryption?: boolean;
    showFederationOption?: boolean;
    defaultFederation?: boolean;
  };

  encryptionRecovery?: {
    /** `false` stops the app from opening the recovery password Set up or Unlock dialog at start. */
    promptAtStart?: boolean;
  };

  /** Messages the loading screen rotates through while the client starts. */
  splash?: {
    loadingMessages?: string[];
  };

  messageRendering?: {
    /** URI schemes, besides the web and Matrix ones, that links in messages may use. */
    additionalAllowedUriSchemes?: string[];
    /**
     * Site icons beside links in unencrypted rooms, from icons.duckduckgo.com, which then sees
     * each linked host and the viewer's address. Off unless true.
     */
    linkFavicons?: boolean;
  };

  /** Copy and links on the welcome page. */
  welcome?: {
    title?: string;
    subtitle?: string;
    /** Credits under the welcome links, as for the sign-in card; an empty list hides them. */
    poweredBy?: { label: string; url: string }[];
    docsLabel?: string;
    docsUrl?: string;
    sourceLabel?: string;
    sourceUrl?: string;
  };

  /** Error reports from this deployment's clients (src/app/bug-reports/error-reporting). */
  errorReporting?: {
    /**
     * DSN of a Sentry-compatible collector such as GlitchTip:
     * `https://<public key>@<host>/<project id>`. HTTPS only; without it no reports are sent.
     */
    dsn?: string;
    /**
     * A path on the client's own origin, such as `/errors/envelope`, whose server forwards each
     * envelope to the collector's envelope endpoint. Without it reports go to the collector
     * directly, where privacy blocklists may stop them.
     */
    tunnel?: string;
    /** The reports' environment, such as `lab`; the page's host name when unset. */
    environment?: string;
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
      /**
       * Origin of the MindRoom server for agent computers and Connections. Empty, or a value
       * `resolveComputerApiUrl` rejects, counts as unset: the client then uses the origin the room's
       * agents publish.
       */
      apiUrl?: string;
    };
    uiActions?: {
      /** Homeservers whose agents may open panels without a click. */
      autoOpenFromHomeservers?: string[];
    };
  };
};
