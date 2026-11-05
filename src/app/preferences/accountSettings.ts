/**
 * Account-level MindRoom settings — a single global dictionary stored in
 * Matrix account data under `io.mindroom.settings`, so preferences roam
 * across devices (unlike the localStorage-backed `mindroomSettingsAtom`).
 *
 * The stored content is intentionally open-shaped: readers sanitize only the
 * keys they know, and writers merge patches over the raw stored content so a
 * client that predates a key never destroys settings written by a newer one.
 */

export const MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE = 'io.mindroom.settings';

export type MindroomAccountSettings = {
  /** Show the sidebar's Canvases button (once there is a canvas) where the deployment has canvases. */
  showCanvasesInSidebar: boolean;
  /** Show the sidebar's Threads button where the deployment offers it. */
  showThreadsInSidebar: boolean;
  /** Show the sidebar's Explore Community button where the deployment offers it. */
  showExploreInSidebar: boolean;
  /** Show the sidebar's Create Space button where the deployment offers it. */
  showCreateSpaceInSidebar: boolean;
  /** Show the sidebar's command palette button. */
  showSearchInSidebar: boolean;
  /** Show the sidebar's Local MindRoom button where the account can pair one. */
  showLocalMindroomInSidebar: boolean;
};

export const DEFAULT_MINDROOM_ACCOUNT_SETTINGS: MindroomAccountSettings = {
  showCanvasesInSidebar: true,
  showThreadsInSidebar: true,
  showExploreInSidebar: true,
  showCreateSpaceInSidebar: true,
  showSearchInSidebar: true,
  showLocalMindroomInSidebar: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The stored switch, or its default when it is missing or not a boolean. */
const storedSwitch = (
  content: Record<string, unknown>,
  key: keyof MindroomAccountSettings
): boolean => {
  const value = content[key];
  return typeof value === 'boolean' ? value : DEFAULT_MINDROOM_ACCOUNT_SETTINGS[key];
};

/**
 * Coerce raw account-data content (which any client may have written) into a
 * well-formed settings object. Unknown or malformed values fall back to the
 * defaults — never throw over garbage in account data.
 */
export const sanitizeMindroomAccountSettings = (content: unknown): MindroomAccountSettings => {
  if (!isRecord(content)) return DEFAULT_MINDROOM_ACCOUNT_SETTINGS;
  return {
    showCanvasesInSidebar:
      typeof content.showCanvasesInSidebar === 'boolean'
        ? content.showCanvasesInSidebar
        : DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showCanvasesInSidebar,
    showThreadsInSidebar: storedSwitch(content, 'showThreadsInSidebar'),
    showExploreInSidebar: storedSwitch(content, 'showExploreInSidebar'),
    showCreateSpaceInSidebar: storedSwitch(content, 'showCreateSpaceInSidebar'),
    showSearchInSidebar: storedSwitch(content, 'showSearchInSidebar'),
    showLocalMindroomInSidebar: storedSwitch(content, 'showLocalMindroomInSidebar'),
  };
};

/**
 * Overlay a patch of known settings onto the raw stored content, preserving
 * any keys this client does not understand.
 */
export const mergeMindroomAccountSettings = (
  content: unknown,
  patch: Partial<MindroomAccountSettings>
): Record<string, unknown> => ({
  ...(isRecord(content) ? content : {}),
  ...patch,
});
