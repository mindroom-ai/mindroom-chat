import { Box, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { SettingTile } from '../../../ui/SettingTile';
import { ChoiceButton } from '../../../ui/settings/ChoiceButton';
import type { RoomChoiceSettingDefinition } from './roomSettingDefinitions';
import * as css from './RoomTextSettingTile.css';
import { useRoomSetting } from './useRoomSetting';

const STRINGS = 'featureUi.roomSettings.mindroom';

/**
 * A room setting with a few values: a menu that saves the choice as soon as it is picked, and
 * shows the unset choice for a value it does not know. Read-only for those who may not send
 * `io.mindroom.room_settings`.
 */
export function RoomChoiceSettingTile({
  room,
  definition,
}: {
  room: Room;
  definition: RoomChoiceSettingDefinition;
}) {
  const { t } = useTranslation();
  const { canEdit, value, sending, failed, justSaved, write, clearFeedback } = useRoomSetting(
    room,
    definition.key
  );
  const label = t(definition.label);
  const known = definition.choices.some((choice) => choice.value === value);

  return (
    <Box direction="Column" gap="200">
      <SettingTile
        title={label}
        description={t(definition.description)}
        after={
          <ChoiceButton
            label={label}
            value={known ? value : ''}
            choices={definition.choices.map((choice) => ({
              value: choice.value,
              label: t(choice.label),
            }))}
            onChoose={(next) => {
              clearFeedback();
              if (next !== value) void write(next);
            }}
            disabled={!canEdit || sending}
          />
        }
      />
      {/* The menu shows the new choice; this line says the save went through. */}
      <span role="status" className={css.VisuallyHidden}>
        {justSaved ? t(`${STRINGS}.saved`) : ''}
      </span>
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t(`${STRINGS}.saveFailed`)}
        </Text>
      )}
      {!canEdit && (
        <Text size="T200" priority="300">
          {t(`${STRINGS}.readOnly`)}
        </Text>
      )}
    </Box>
  );
}
