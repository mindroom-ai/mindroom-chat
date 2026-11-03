import { atom } from 'jotai';

/** The pages of the Space settings dialog. */
export enum SpaceSettingsPage {
  GeneralPage = 'general',
  MembersPage = 'members',
  PermissionsPage = 'permissions',
  EmojisStickersPage = 'emojis-stickers',
  DeveloperToolsPage = 'developer-tools',
}

/** The Space to show, by its room ID, and the page to open on. */
export type SpaceSettingsState = { roomId: string; page?: SpaceSettingsPage };

/** The Space whose settings dialog is open, if any. */
export const spaceSettingsAtom = atom<SpaceSettingsState | undefined>(undefined);
