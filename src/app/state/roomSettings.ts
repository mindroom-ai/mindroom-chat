import { atom } from 'jotai';

/** The pages of the room settings dialog. */
export enum RoomSettingsPage {
  GeneralPage = 'general',
  MembersPage = 'members',
  PermissionsPage = 'permissions',
  EmojisStickersPage = 'emojis-stickers',
  DeveloperToolsPage = 'developer-tools',
}

/** The room to show; `spaceId` is the Space it was opened from, for navigating in the dialog. */
export type RoomSettingsState = { roomId: string; spaceId?: string; page?: RoomSettingsPage };

/** The room whose settings dialog is open, if any. */
export const roomSettingsAtom = atom<RoomSettingsState | undefined>(undefined);
