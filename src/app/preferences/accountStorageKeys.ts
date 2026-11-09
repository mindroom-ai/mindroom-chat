import { pendingRoamingSettingsKeyPrefix } from './roamingSettings';

/**
 * The localStorage keys the app keeps per account. The module that writes a key builds it here,
 * and signing out (`clearUserUiState`) removes the same keys, so each key is stated once.
 */

/** The order of the account's spaces in the sidebar. */
export const spaceOrderStorageKey = (userId: string): string =>
  `mindroom.sidebar.spaceOrder:${userId}`;

/** The account's choice to collapse the page navigation (room list) panel. */
export const getDesktopPageNavCollapsedStorageKey = (userId: string): string =>
  `mindroom.pageNav.desktopCollapsed:${userId}`;

/** When the account first saw the Local MindRoom setup steps on the welcome page. */
export const getWelcomeSetupFirstSeenStorageKey = (userId: string): string =>
  `mindroom_welcome_setup_first_seen_at::${userId}`;

/** The widths of the account's resizable panels. */
export const pageNavWidthStorageKey = (userId: string): string =>
  `mindroom.pageNav.width:${userId}`;
export const membersWidthStorageKey = (userId: string): string =>
  `mindroom.members.width:${userId}`;
export const canvasWidthStorageKey = (userId: string): string => `mindroom.canvas.width:${userId}`;
export const callWidthStorageKey = (userId: string): string => `mindroom.call.width:${userId}`;
export const computerWidthStorageKey = (userId: string): string =>
  `mindroom.computer.width:${userId}`;
export const callTranscriptWidthStorageKey = (userId: string): string =>
  `mindroom.callTranscript.width:${userId}`;

/** The start of the width keys of the account's plugin side panels. */
export const pluginPanelWidthStorageKeyPrefix = (userId: string): string =>
  `mindroom.panel.width:${userId}:`;
export const pluginPanelWidthStorageKey = (userId: string, panelId: string): string =>
  `${pluginPanelWidthStorageKeyPrefix(userId)}${panelId}`;

/** Every key above of one account. */
export const accountStorageKeys = (userId: string): string[] => [
  spaceOrderStorageKey(userId),
  getDesktopPageNavCollapsedStorageKey(userId),
  getWelcomeSetupFirstSeenStorageKey(userId),
  pageNavWidthStorageKey(userId),
  membersWidthStorageKey(userId),
  canvasWidthStorageKey(userId),
  callWidthStorageKey(userId),
  computerWidthStorageKey(userId),
  callTranscriptWidthStorageKey(userId),
];

/** The starts of the account's keys that hold one value per panel or device. */
export const accountStorageKeyPrefixes = (userId: string): string[] => [
  pluginPanelWidthStorageKeyPrefix(userId),
  pendingRoamingSettingsKeyPrefix(userId),
];
