import React, { useState } from 'react';
import { Box, color, Switch, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import {
  useMindroomAccountSettings,
  useSetMindroomAccountSettings,
} from './useMindroomAccountSettings';

type MindroomInterfaceSettingsProps = {
  className?: string;
};

/**
 * The "Interface" group at the top of Settings → General. Hosts the Simple
 * Mode switch backed by `io.mindroom.settings` account data. This group must
 * stay visible while simple mode is ON — it is the way back out.
 */
export function MindroomInterfaceSettings({ className }: MindroomInterfaceSettingsProps) {
  const { t } = useTranslation();
  const { simpleMode } = useMindroomAccountSettings();
  const setAccountSettings = useSetMindroomAccountSettings();
  // setAccountData only resolves once the change echoes back over sync, so
  // show the requested value immediately and hand back to the store when the
  // write settles (echo arrived, or failed and the stored value still rules).
  const [pending, setPending] = useState<boolean>();
  // A failed write snaps the switch back to the stored value; the target
  // audience is non-technical, so say why instead of failing silently.
  const [saveFailed, setSaveFailed] = useState(false);

  const handleSimpleMode = (next: boolean) => {
    setPending(next);
    setSaveFailed(false);
    setAccountSettings({ simpleMode: next })
      .catch(() => setSaveFailed(true))
      .finally(() => setPending(undefined));
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('settings.general.interface.sectionTitle')}</Text>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title={t('settings.general.interface.simpleMode')}
          description={t('settings.general.interface.simpleModeDescription')}
          after={
            <Switch variant="Primary" value={pending ?? simpleMode} onChange={handleSimpleMode} />
          }
        >
          {saveFailed && (
            <Text size="T200" style={{ color: color.Critical.Main }}>
              {t('settings.general.interface.simpleModeSaveFailed')}
            </Text>
          )}
        </SettingTile>
      </SequenceCard>
    </Box>
  );
}
