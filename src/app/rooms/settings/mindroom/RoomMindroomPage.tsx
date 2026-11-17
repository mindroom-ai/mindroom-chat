import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { SettingsCard } from '../../../ui/settings/SettingsCard';
import { SettingsPageFrame } from '../../../ui/settings/SettingsPageFrame';
import { ROOM_SETTING_DEFINITIONS } from './roomSettingDefinitions';
import { RoomTextSettingTile } from './RoomTextSettingTile';

/** The room's MindRoom settings, which its agents read from room state: a card per setting. */
export function RoomMindroomPage({ room, requestClose }: { room: Room; requestClose: () => void }) {
  const { t } = useTranslation();
  return (
    <SettingsPageFrame
      title={t('featureUi.roomSettings.navigation.mindroom')}
      requestClose={requestClose}
    >
      {ROOM_SETTING_DEFINITIONS.map((definition) => (
        <SettingsCard key={definition.key}>
          <RoomTextSettingTile room={room} definition={definition} />
        </SettingsCard>
      ))}
    </SettingsPageFrame>
  );
}
