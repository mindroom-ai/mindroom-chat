import { useRef, useState } from 'react';
import { Box, Switch, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { useOptionalClientConfig } from '../../config/useClientConfig';
import { useAccountSettings, useSetAccountSettings } from '../../matrix/hooks/useAccountSettings';
import { isPluginEnabled } from '../../plugins/pluginConfig';
import { registeredPlugins } from '../../plugins/registry';
import { setPluginDisabled } from '../../preferences/accountSettings';
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
  const [pending, setPending] = useState<readonly string[]>();
  const [saveFailed, setSaveFailed] = useState(false);
  const requestGeneration = useRef(0);
  const effectiveDisabled = pending ?? settings.disabledPlugins;
  const latestDisabled = useRef<readonly string[]>(effectiveDisabled);
  latestDisabled.current = effectiveDisabled;

  const plugins = registeredPlugins.filter((plugin) =>
    isPluginEnabled(deploymentConfig, plugin.id)
  );
  const disabledSet = new Set(effectiveDisabled);

  const handleToggle = (pluginId: string, enabled: boolean) => {
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    const nextDisabled = setPluginDisabled(latestDisabled.current, pluginId, !enabled);
    latestDisabled.current = nextDisabled;
    setPending(nextDisabled);
    setSaveFailed(false);
    setAccountSettings({ disabledPlugins: nextDisabled })
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
                      value={!disabledSet.has(plugin.id)}
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
