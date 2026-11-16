import { Icons } from 'folds';
import type { BooleanSettingKey, Settings } from '../preferences/settings';
import type { SettingDefinition } from '../preferences/settingsRegistry';
import {
  getSettingText,
  type SettingsSearchValues,
  type SettingsTranslate,
} from '../settings/settingsSearchIndex';
import type { CommandPaletteActionItem } from './commandPaletteTypes';

type SettingSwitch = { key: BooleanSettingKey; inverted?: boolean };

/**
 * The settings whose page shows a plain switch: the stored field, and whether the switch shows
 * its opposite.
 */
export const COMMAND_PALETTE_SETTING_SWITCHES: Readonly<Record<string, SettingSwitch>> = {
  enterForNewline: { key: 'enterForNewline' },
  markdown: { key: 'isMarkdown' },
  hideMembershipEvents: { key: 'hideMembershipEvents' },
  hideNickAvatarEvents: { key: 'hideNickAvatarEvents' },
  showToolCalls: { key: 'showToolCalls' },
  // The Chats page shows it as "Disable Media Auto Load".
  mediaAutoLoad: { key: 'mediaAutoLoad', inverted: true },
  urlPreview: { key: 'urlPreview' },
  hideActivity: { key: 'hideActivity' },
  encUrlPreview: { key: 'encUrlPreview' },
  developerTools: { key: 'developerTools' },
  showHiddenEvents: { key: 'showHiddenEvents' },
  errorReports: { key: 'sendErrorReports' },
  notificationSound: { key: 'isNotificationSounds' },
};

// The palette's pages (Theme, Message Layout, App Language) and the tour's two actions offer
// these already, so they get no row of their own.
const COVERED_ELSEWHERE: ReadonlySet<string> = new Set([
  'systemTheme',
  'theme',
  'lightTheme',
  'darkTheme',
  'messageLayout',
  'language',
  'tour',
]);

export type CommandPaletteSettingRow = {
  item: CommandPaletteActionItem;
  setting: SettingDefinition;
  /** Set for a switch setting. */
  switch?: SettingSwitch;
};

/**
 * A row per setting, for the palette's search, in the registry's order. A switch setting's row
 * shows what its switch shows and keeps the palette open when chosen; another setting's row says
 * where in Settings it is.
 */
export const getCommandPaletteSettingRows = (
  settings: readonly SettingDefinition[],
  stored: Pick<Settings, BooleanSettingKey>,
  t: SettingsTranslate,
  values?: SettingsSearchValues
): CommandPaletteSettingRow[] => {
  const tag = t('settings.title');
  return settings
    .filter((setting) => !COVERED_ELSEWHERE.has(setting.id))
    .map((setting) => {
      const { label, description, keywords, location } = getSettingText(setting, t, values);
      const item: CommandPaletteActionItem = {
        id: `setting:${setting.id}`,
        kind: 'action',
        title: label,
        description: location.join(' › '),
        keywords: description ? [...keywords, description] : keywords,
        tag,
        icon: Icons.Setting,
        sortRank: 0,
      };
      const settingSwitch = COMMAND_PALETTE_SETTING_SWITCHES[setting.id];
      if (!settingSwitch) return { item, setting };
      const on = stored[settingSwitch.key] !== !!settingSwitch.inverted;
      return {
        item: { ...item, state: on ? 'on' : 'off', keepOpen: true },
        setting,
        switch: settingSwitch,
      };
    });
};
