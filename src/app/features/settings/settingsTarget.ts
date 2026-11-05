import { createContext, useContext } from 'react';

/** The setting a search result led to; `seq` tells a repeated choice of the same one apart. */
export type SettingsTarget = { id: string; seq: number };

export const SettingsTargetContext = createContext<SettingsTarget | undefined>(undefined);

export const useSettingsTarget = (): SettingsTarget | undefined =>
  useContext(SettingsTargetContext);
