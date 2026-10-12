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

/**
 * When long messages fold behind Show full message: `auto` folds people's messages and only very
 * long agent replies, `on` folds every long message, `off` shows every message in full.
 */
export type LongMessageFolding = 'auto' | 'on' | 'off';

export const LONG_MESSAGE_FOLDING_VALUES: readonly LongMessageFolding[] = ['auto', 'on', 'off'];

export type MindroomAccountSettings = {
  /**
   * Hide advanced UI (spaces, command palette, thread filter toolbar, …) for
   * non-technical users. Off means the full interface.
   */
  simpleMode: boolean;
  longMessageFolding: LongMessageFolding;
  /** Show the sidebar's Canvases button (once there is a canvas) where the deployment has canvases. */
  showCanvasesInSidebar: boolean;
};

export const DEFAULT_MINDROOM_ACCOUNT_SETTINGS: MindroomAccountSettings = {
  simpleMode: true,
  longMessageFolding: 'auto',
  showCanvasesInSidebar: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeLongMessageFolding = (content: Record<string, unknown>): LongMessageFolding => {
  const { longMessageFolding } = content;
  if (LONG_MESSAGE_FOLDING_VALUES.includes(longMessageFolding as LongMessageFolding)) {
    return longMessageFolding as LongMessageFolding;
  }
  // Older clients stored a switch that is only written when the user flips it, so a stored value
  // is their choice: expanded shows everything, folded folds everything.
  if (content.expandLongMessagesByDefault === true) return 'off';
  if (content.expandLongMessagesByDefault === false) return 'on';
  return DEFAULT_MINDROOM_ACCOUNT_SETTINGS.longMessageFolding;
};

/**
 * Coerce raw account-data content (which any client may have written) into a
 * well-formed settings object. Unknown or malformed values fall back to the
 * defaults — never throw over garbage in account data.
 */
export const sanitizeMindroomAccountSettings = (content: unknown): MindroomAccountSettings => {
  if (!isRecord(content)) return DEFAULT_MINDROOM_ACCOUNT_SETTINGS;
  return {
    simpleMode:
      typeof content.simpleMode === 'boolean'
        ? content.simpleMode
        : DEFAULT_MINDROOM_ACCOUNT_SETTINGS.simpleMode,
    longMessageFolding: sanitizeLongMessageFolding(content),
    showCanvasesInSidebar:
      typeof content.showCanvasesInSidebar === 'boolean'
        ? content.showCanvasesInSidebar
        : DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showCanvasesInSidebar,
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
