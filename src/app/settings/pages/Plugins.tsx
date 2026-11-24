import { useRef, useState } from 'react';
import { Box, Switch, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { useOptionalClientConfig } from '../../config/useClientConfig';
import { useAccountSettings, useSetAccountSettings } from '../../matrix/hooks/useAccountSettings';
import { isPluginEnabled, isPluginPreferredEnabled } from '../../plugins/pluginConfig';
import { registeredPlugins } from '../../plugins/registry';
import {
  setPluginEnabledPreference,
  type PluginPreferences,
} from '../../preferences/accountSettings';
import { SettingTile } from '../../ui/SettingTile';
import { SettingScopeLabel } from '../../ui/settings/SettingScopeLabel';
import { ScopeLine } from '../../ui/settings/scopeLabel.css';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';

/**
 * Settings -> Plugins: lists every bundled plugin left enabled by deployment config.json so the
 * account can turn individual plugins on or off across devices (`io.mindroom.settings`).
 */
export function Plugins({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const deploymentConfig = useOptionalClientConfig();
  const settings = useAccountSettings();
  const setAccountSettings = useSetAccountSettings();
  const [pending, setPending] = useState<PluginPreferences>();
  const [saveFailed, setSaveFailed] = useState(false);
  const requestGeneration = useRef(0);
  const effectivePrefs: PluginPreferences = pending ?? {
    disabledPlugins: settings.disabledPlugins,
    enabledPlugins: settings.enabledPlugins,
  };
  const latestPrefs = useRef<PluginPreferences>(effectivePrefs);
  latestPrefs.current = effectivePrefs;

  const plugins = registeredPlugins.filter((plugin) =>
    isPluginEnabled(deploymentConfig, plugin.id)
  );

  const handleToggle = (pluginId: string, enabled: boolean) => {
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    const nextPrefs = setPluginEnabledPreference(latestPrefs.current, pluginId, enabled);
    latestPrefs.current = nextPrefs;
    setPending(nextPrefs);
    setSaveFailed(false);
    setAccountSettings(nextPrefs)
      .catch(() => {
        if (requestGeneration.current === generation) setSaveFailed(true);
      })
      .finally(() => {
        if (requestGeneration.current === generation) setPending(undefined);
      });
  };

  return (
    <SettingsPageFrame title={t('featureUi.settings.plugins.title')} requestClose={requestClose}>
      <Box direction="Column" gap="100" data-setting-id="plugins">
        <Text size="L400" data-settings-heading="">
          {t('featureUi.settings.plugins.title')}
        </Text>
        <Text size="T200" priority="300" className={ScopeLine}>
          <span>{t('featureUi.settings.plugins.description')}</span>
          <SettingScopeLabel id="plugins" />
        </Text>
        {plugins.length > 0 && (
          <SettingsCard>
            {plugins.map((plugin) => (
              <div key={plugin.id} data-setting-id={`plugin:${plugin.id}`}>
                <SettingTile
                  title={plugin.displayName}
                  description={plugin.description}
                  after={
                    <Switch
                      variant="Primary"
                      aria-label={plugin.displayName}
                      value={isPluginPreferredEnabled(plugin, effectivePrefs)}
                      onChange={(enabled) => handleToggle(plugin.id, enabled)}
                    />
                  }
                />
              </div>
            ))}
          </SettingsCard>
        )}
        {saveFailed && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            {t('settings.general.interface.saveFailed')}
          </Text>
        )}
      </Box>
    </SettingsPageFrame>
  );
}
