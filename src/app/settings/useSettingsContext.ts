import { isBundledApp, isDesktopApp } from '../lib/nativeShell';
import { useAtomValue } from 'jotai';
import { useShowLocalMindroom } from '../local-mindroom/useShowLocalMindroom';
import { useOffersMacApp } from '../native/macApp';
import { isNativeIOS } from '../native/nativeSso';
import { isNativeUpdateAvailable } from '../native/nativeUpdate';
import { getDebugModeEnabled } from '../diagnostics/debugMode';
import { useOfferedRailButtons } from './railButtons';
import { useClientConfig } from '../config/useClientConfig';
import { useCapabilities } from '../matrix/hooks/useCapabilities';
import { isServerAdmin } from '../server-admin/accounts';
import { parseDsn } from '../bug-reports/error-reporting/errorReporting';
import { isPluginEnabled } from '../plugins/pluginConfig';
import { registeredPlugins } from '../plugins/registry';
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
  const clientConfig = useClientConfig();
  const errorReporting = parseDsn(clientConfig.errorReporting?.dsn) !== undefined;
  const serverAdmin = isServerAdmin(useCapabilities());
  const macApp = useOffersMacApp();
  // Check raw deployment config so default-off or user-disabled plugins still show Settings -> Plugins.
  const hasPlugins = registeredPlugins.some((plugin) => isPluginEnabled(clientConfig, plugin.id));
  return {
    native: isBundledApp(),
    nativeIOS: isNativeIOS(),
    diagnostics: isNativeIOS() || isDesktopApp() || getDebugModeEnabled(),
    localMindroom,
    serverAdmin,
    useSystemTheme,
    developerTools,
    errorReporting,
    railButtons,
    nativeUpdate: isNativeUpdateAvailable(),
    macApp,
    hasPlugins,
  };
};
