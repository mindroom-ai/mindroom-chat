import { atom } from 'jotai';
import { SettingsPage } from './settingsPages';

export type SettingsModalState = {
  initialPage?: SettingsPage;
  requestId?: string;
};

export const settingsModalAtom = atom<SettingsModalState | undefined>(undefined);
