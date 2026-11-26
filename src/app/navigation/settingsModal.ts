import { atom } from 'jotai';
import { SettingsPage } from './settingsPages';

export type SettingsModalState = {
  initialPage?: SettingsPage;
  /** A setting on that page that the dialog scrolls to, highlights and focuses. */
  initialSetting?: string;
  requestId?: string;
};

export const settingsModalAtom = atom<SettingsModalState | undefined>(undefined);

let activeSettingsStepBack: (() => void) | undefined;

/** Registers a mobile Settings subpage back action until the returned cleanup runs. */
export const registerSettingsStepBack = (stepBack: () => void): (() => void) => {
  activeSettingsStepBack = stepBack;
  return () => {
    if (activeSettingsStepBack === stepBack) activeSettingsStepBack = undefined;
  };
};

/** Steps back from a mobile Settings subpage to the Settings menu when one is active. */
export const stepBackSettings = (): boolean => {
  if (!activeSettingsStepBack) return false;
  activeSettingsStepBack();
  return true;
};
