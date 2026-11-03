import React from 'react';
import { Box, Switch, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { SettingsPageFrame } from '../SettingsPageFrame';
import { SequenceCardStyle } from '../styles.css';









  return (
    <SettingsPageFrame title={t('settings.nav.developerTools')} requestClose={requestClose}>
      <Box direction="Column" gap="100">
        <Text size="L400">{t('featureUi.settings.developerTools.developTools.options')}</Text>
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          gap="400"
        >
          <SettingTile
            title={t('featureUi.settings.developerTools.developTools.enableDeveloperTools')}
            after={<Switch variant="Primary" value={developerTools} onChange={setDeveloperTools} />}
          />
        </SequenceCard>
      </Box>
    </SettingsPageFrame>
  );
}
