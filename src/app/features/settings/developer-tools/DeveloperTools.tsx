import React from 'react';
import { Box, Switch, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { SettingsPageFrame } from '../SettingsPageFrame';
import { SequenceCardStyle } from '../styles.css';










  return (
    <SettingsPageFrame
      title={t('featureUi.settings.menu.developerTools')}
      requestClose={requestClose}
    >
      <Box direction="Column" gap="100">
        <Text size="L400">{t('featureUi.settings.developerTools.options')}</Text>
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          <SettingTile
            title={t('featureUi.settings.developerTools.enable')}
            description={t('featureUi.settings.developerTools.enableDescription')}
            after={<Switch variant="Primary" value={developerTools} onChange={setDeveloperTools} />}
          />
          <SettingTile
            title={t('featureUi.settings.developerTools.session')}
            description={`${mx.getUserId() ?? ''} · ${
              mx.getDeviceId() ?? ''
            } · ${mx.getHomeserverUrl()}`}
          />
        </SequenceCard>
      </Box>
    </SettingsPageFrame>
  );
}
