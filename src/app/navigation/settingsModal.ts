import { atom } from 'jotai';
import { SettingsPage } from './settingsPages';

export type SettingsModalState = {
  initialPage?: SettingsPage;
  /** A setting on that page that the dialog scrolls to, highlights and focuses. */
  initialSetting?: string;
  requestId?: string;
};

export const settingsModalAtom = atom<SettingsModalState | undefined>(undefined);
