/**
 * Account-level MindRoom settings — a single global dictionary stored in
 * Matrix account data under `io.mindroom.settings`, so preferences roam
 * across devices (unlike the localStorage-backed `prefetchSettingsAtom`).
 *
 * The stored content is intentionally open-shaped: readers sanitize only the
 * keys they know, and writers merge patches over the raw stored content so a
 * client that predates a key never destroys settings written by a newer one.
 */

export const MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE = 'io.mindroom.settings';

export type AccountSettings = {
  /** Show the sidebar's Canvases button (once there is a canvas) where the deployment has canvases. */
  showCanvasesInSidebar: boolean;
  /** Show the sidebar's Usage button (once a runtime reports provider usage). */
  showUsageInSidebar: boolean;
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
  /** The account answered the offer of the interface tour (src/app/tour/TourOffer.tsx). */
  tourOffered: boolean;
  /** The account answered the offer of the Mac app (src/app/shell/MacAppOffer.tsx). */
  macAppOffered: boolean;
  /** Bundled client plugin IDs turned off for this account (Settings -> Plugins). */
  disabledPlugins: readonly string[];
  /** Bundled client plugin IDs turned on for this account (Settings -> Plugins). */
  enabledPlugins: readonly string[];
};

export type PluginPreferences = Pick<AccountSettings, 'disabledPlugins' | 'enabledPlugins'>;

export type BooleanAccountSetting = {
  [K in keyof AccountSettings]: AccountSettings[K] extends boolean ? K : never;
}[keyof AccountSettings];

const EMPTY_PLUGIN_IDS: readonly string[] = Object.freeze([]);

export const DEFAULT_MINDROOM_ACCOUNT_SETTINGS: AccountSettings = {
  showCanvasesInSidebar: false,
  showUsageInSidebar: false,
  showThreadsInSidebar: false,
  showExploreInSidebar: false,
  showCreateSpaceInSidebar: false,
  showSearchInSidebar: false,
  showLocalMindroomInSidebar: false,
  tourOffered: false,
  macAppOffered: false,
  disabledPlugins: EMPTY_PLUGIN_IDS,
  enabledPlugins: EMPTY_PLUGIN_IDS,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The stored switch, or its default when it is missing or not a boolean. */
const storedSwitch = (content: Record<string, unknown>, key: BooleanAccountSetting): boolean => {
  const value = content[key];
  return typeof value === 'boolean' ? value : DEFAULT_MINDROOM_ACCOUNT_SETTINGS[key];
};

const sanitizePluginIds = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return EMPTY_PLUGIN_IDS;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result.length === 0 ? EMPTY_PLUGIN_IDS : result;
};

/**
 * Returns sanitized plugin preferences with `pluginId` added to `enabledPlugins` (`enabled: true`)
 * or `disabledPlugins` (`enabled: false`), removing it from the opposite list.
 */
export const setPluginEnabledPreference = (
  current: PluginPreferences,
  pluginId: string,
  enabled: boolean
): PluginPreferences => {
  const id = pluginId.trim();
  const disabledPlugins = [...sanitizePluginIds(current.disabledPlugins)];
  const enabledPlugins = [...sanitizePluginIds(current.enabledPlugins)];
  if (id === '') return { disabledPlugins, enabledPlugins };
  if (enabled) {
    return {
      disabledPlugins: disabledPlugins.filter((item) => item !== id),
      enabledPlugins: enabledPlugins.includes(id) ? enabledPlugins : [...enabledPlugins, id],
    };
  }
  return {
    disabledPlugins: disabledPlugins.includes(id) ? disabledPlugins : [...disabledPlugins, id],
    enabledPlugins: enabledPlugins.filter((item) => item !== id),
  };
};

/**
 * Coerce raw account-data content (which any client may have written) into a
 * well-formed settings object. Unknown or malformed values fall back to the
 * defaults — never throw over garbage in account data.
 */
export const sanitizeAccountSettings = (content: unknown): AccountSettings => {
  if (!isRecord(content)) return DEFAULT_MINDROOM_ACCOUNT_SETTINGS;
  return {
    showCanvasesInSidebar:
      typeof content.showCanvasesInSidebar === 'boolean'
        ? content.showCanvasesInSidebar
        : DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showCanvasesInSidebar,
    showUsageInSidebar: storedSwitch(content, 'showUsageInSidebar'),
    showThreadsInSidebar: storedSwitch(content, 'showThreadsInSidebar'),
    showExploreInSidebar: storedSwitch(content, 'showExploreInSidebar'),
    showCreateSpaceInSidebar: storedSwitch(content, 'showCreateSpaceInSidebar'),
    showSearchInSidebar: storedSwitch(content, 'showSearchInSidebar'),
    showLocalMindroomInSidebar: storedSwitch(content, 'showLocalMindroomInSidebar'),
    tourOffered: storedSwitch(content, 'tourOffered'),
    macAppOffered: storedSwitch(content, 'macAppOffered'),
    disabledPlugins: sanitizePluginIds(content.disabledPlugins),
    enabledPlugins: sanitizePluginIds(content.enabledPlugins),
  };
};

/**
 * Overlay a patch of known settings onto the raw stored content, preserving
 * any keys this client does not understand.
 */
export const mergeAccountSettings = (
  content: unknown,
  patch: Partial<AccountSettings>
): Record<string, unknown> => ({
  ...(isRecord(content) ? content : {}),
  ...patch,
});
