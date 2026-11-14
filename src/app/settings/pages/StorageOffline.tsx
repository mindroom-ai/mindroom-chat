import { Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SettingTile } from '../../ui/SettingTile';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { clearAllCacheAndReload } from '../../account/lifecycle/sessionLifecycle';
import { PrefetchSettings } from './PrefetchSettings';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SequenceCardStyle } from '../../ui/settings/styles.css';

/** What this device loads ahead in the background, and the cache it keeps. */
export function StorageOffline({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();

  return (
    <SettingsPageFrame
      title={t('featureUi.settings.menu.pages.storage')}
      requestClose={requestClose}
    >
      <PrefetchSettings className={SequenceCardStyle} />
      <SettingsSection>
        <SettingTile
          focusId="clearCache"
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
