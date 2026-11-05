import { Capacitor } from '@capacitor/core';
import { useAtomValue } from 'jotai';
import { useShowLocalMindroom } from '../../mindroom/local-mindroom/useShowLocalMindroom';
import { isNativeIOS } from '../../mindroom/native/nativeSso';
import { useOfferedRailButtons } from '../../pages/client/sidebar/railButtons';
import { useClientConfig } from '../../hooks/useClientConfig';
import { parseDsn } from '../error-reporting/errorReporting';
import { settingsAtom } from '../../state/settings';
import type { SettingsContext } from './settingsRegistry';

/** What this platform, account and device offer, for the registry's page and setting filters. */
export const useSettingsContext = (): SettingsContext => {
  const localMindroom = useShowLocalMindroom();
  const railButtons = useOfferedRailButtons();
  const { useSystemTheme, developerTools } = useAtomValue(settingsAtom);
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
