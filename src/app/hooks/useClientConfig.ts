import { createContext, useContext } from 'react';

/**
 * The deployment's `config.json`. Every field is optional: a missing field means the built-in
 * default, so an empty object is a valid configuration.
 */










    enabled?: boolean;
    basename?: string;
  };

  auth?: {
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










  sidebar?: {
    showThreads?: boolean;
    showExploreCommunity?: boolean;
    showExploreCommunityInSimpleMode?: boolean;
    /** The Local MindRoom tab; on unless set to false. */
    showMindRoom?: boolean;
    /** Where the Local MindRoom tab links for more about MindRoom. */
    mindRoomUrl?: string;
    /** Provisioning service the Local MindRoom pairing flow talks to. */
    mindRoomProvisioningUrl?: string;
  };

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













