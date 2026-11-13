import { atom } from 'jotai';

/** The pages of the room settings dialog. */
export enum RoomSettingsPage {
  GeneralPage = 'general',
  MembersPage = 'members',
  PermissionsPage = 'permissions',
  EmojisStickersPage = 'emojis-stickers',
  DeveloperToolsPage = 'developer-tools',
}

/**
 * The room or space to show and the page to open on. `request` counts the requests while the
 * dialog stays open, so each opens its page.
 */
export type RoomSettingsState = { roomId: string; page?: RoomSettingsPage; request: number };

/** The room or space whose settings dialog is open, if any. */
export const roomSettingsAtom = atom<RoomSettingsState | undefined>(undefined);
