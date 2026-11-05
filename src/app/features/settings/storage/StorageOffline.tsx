import { Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { clearAllCacheAndReload } from '../../../../client/initMatrix';
import { MindroomPrefetchSettings } from '../../../mindroom/settings/MindroomPrefetchSettings';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { SettingsSection } from '../SettingsSection';
import { SequenceCardStyle } from '../styles.css';

/** What this device loads ahead in the background, and the cache it keeps. */
export function StorageOffline({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();

  return (
    <SettingsPageFrame
      title={t('featureUi.settings.menu.pages.storage')}
      requestClose={requestClose}
    >
      <MindroomPrefetchSettings className={SequenceCardStyle} />
      <SettingsSection>
        <SettingTile
          title={t('featureUi.settings.about.clearCacheAndReload')}
          description={t('featureUi.settings.about.clearCacheDescription')}
          after={
            <Button
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              outlined
              onClick={() => void clearAllCacheAndReload(client)}
            >
              <Text size="B300">{t('featureUi.settings.about.clearCache')}</Text>
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageFrame>
  );
}
