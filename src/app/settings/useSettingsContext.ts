import { Capacitor } from '@capacitor/core';
import { useAtomValue } from 'jotai';
import { useShowLocalMindroom } from '../local-mindroom/useShowLocalMindroom';
import { isNativeIOS } from '../native/nativeSso';
import { useOfferedRailButtons } from './railButtons';
import { useClientConfig } from '../config/useClientConfig';
import { parseDsn } from '../bug-reports/error-reporting/errorReporting';
import { settingsAtom } from '../preferences/settings';
import { themeSettingsAtom } from '../theme/useTheme';
import type { SettingsContext } from '../preferences/settingsRegistry';

/** What this platform, account and device offer, for the registry's page and setting filters. */
export const useSettingsContext = (): SettingsContext => {
  const localMindroom = useShowLocalMindroom();
  const railButtons = useOfferedRailButtons();
  const { developerTools } = useAtomValue(settingsAtom);
  // As the Appearance page shows it, with the deployment's default theme.
  const { useSystemTheme } = useAtomValue(themeSettingsAtom);
  const errorReporting = parseDsn(useClientConfig().errorReporting?.dsn) !== undefined;
  return {
    native: Capacitor.isNativePlatform(),
    nativeIOS: isNativeIOS(),
    localMindroom,
    useSystemTheme,
    developerTools,
    errorReporting,
    railButtons,
  };
};
