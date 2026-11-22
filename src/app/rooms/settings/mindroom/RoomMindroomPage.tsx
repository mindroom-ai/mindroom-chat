import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { useRoomModelCatalog } from '../../../models/useModelPicker';
import { SettingsPageFrame } from '../../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../../ui/settings/SettingsSection';
import { ROOM_SETTING_SECTIONS, type RoomSettingDefinition } from './roomSettingDefinitions';
import { RoomChoiceSettingTile } from './RoomChoiceSettingTile';
import { RoomModelSettingTile } from './RoomModelSettingTile';
import { RoomTextSettingTile } from './RoomTextSettingTile';

/** The room's MindRoom settings, which its agents read from room state, grouped into sections. */
export function RoomMindroomPage({ room, requestClose }: { room: Room; requestClose: () => void }) {
  const { t } = useTranslation();
  const catalog = useRoomModelCatalog(room);

  const renderTile = (definition: RoomSettingDefinition) => {
    switch (definition.kind) {
      case 'choice':
        return <RoomChoiceSettingTile key={definition.key} room={room} definition={definition} />;
      case 'model':
        return (
          <RoomModelSettingTile
            key={definition.key}
            room={room}
            definition={definition}
            catalog={catalog}
          />
        );
      case 'text':
        return <RoomTextSettingTile key={definition.key} room={room} definition={definition} />;
    }
  };

  return (
    <SettingsPageFrame
      title={t('featureUi.roomSettings.navigation.mindroom')}
      requestClose={requestClose}
    >
      {ROOM_SETTING_SECTIONS.map((section) => (
        <SettingsSection key={section.id} title={t(section.title)}>
          {section.settings.map(renderTile)}
        </SettingsSection>
      ))}
    </SettingsPageFrame>
  );
}
