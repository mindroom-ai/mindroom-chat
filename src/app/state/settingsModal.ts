import { atom } from 'jotai';
import { SettingsPages } from '../features/settings/settingsPages';

export type SettingsModalState = {
  initialPage?: SettingsPages;
};

export const settingsModalAtom = atom<SettingsModalState | undefined>(undefined);
