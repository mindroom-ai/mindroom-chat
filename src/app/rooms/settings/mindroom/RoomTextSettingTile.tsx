import { type FormEvent, useId, useState } from 'react';
import { Box, Button, Icon, Icons, Text, TextArea, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { RoomTextSettingDefinition } from './roomSettingDefinitions';
import * as css from './RoomTextSettingTile.css';
import { useRoomSetting } from './useRoomSetting';

const STRINGS = 'featureUi.roomSettings.mindroom';

/**
 * A free-text room setting: a field with the room's value, Save for a changed text and Clear for
 * a set one. It follows the room's state, apart from what the person is typing, and is read-only
 * for those who may not send `io.mindroom.room_settings`.
 */
export function RoomTextSettingTile({
  room,
  definition,
}: {
  room: Room;
  definition: RoomTextSettingDefinition;
}) {
  const { t } = useTranslation();
  const id = useId();
  const {
    canEdit,
    value: baseline,
    sending,
    failed,
    justSaved,
    write,
    clearFeedback,
  } = useRoomSetting(room, definition.key);
  // The person's text while it differs from the baseline; undefined follows the room.
  const [draft, setDraft] = useState<string>();

  const text = draft ?? baseline;
  const tooLong = text.length > definition.maxLength;
  const dirty = draft !== undefined && draft.trim() !== baseline;
  const canSave = canEdit && dirty && !sending && !tooLong;

  const save = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (canSave) void write(draft.trim()).then((took) => took && setDraft(undefined));
  };

  const fieldId = `${id}-field`;
  const descriptionId = `${id}-description`;
  const noteId = `${id}-note`;
  const readOnlyId = `${id}-read-only`;
  const countId = `${id}-count`;
  const describedBy = [
    descriptionId,
    definition.note && noteId,
    !canEdit && readOnlyId,
    countId,
  ].filter(Boolean);
  return (
    <Box as="form" direction="Column" gap="200" onSubmit={save}>
      <Box direction="Column" gap="100">
        <Text as="label" htmlFor={fieldId} size="T300">
          {t(definition.label)}
        </Text>
        <Text id={descriptionId} size="T200" priority="300">
          {t(definition.description)}
        </Text>
      </Box>
      <TextArea
        id={fieldId}
        value={text}
        onChange={(evt) => {
          const { value } = evt.currentTarget;
          setDraft(value === baseline ? undefined : value);
          clearFeedback();
        }}
        readOnly={!canEdit || sending}
        placeholder={canEdit ? t(definition.placeholder) : undefined}
        maxLength={definition.maxLength}
        aria-describedby={describedBy.join(' ')}
        variant="Background"
        radii="300"
        rows={4}
      />
      <Box alignItems="Center" gap="200" wrap="Wrap">
        <Text
          id={countId}
          size="T200"
          priority="300"
          style={tooLong ? { color: color.Critical.Main } : undefined}
        >
          {t(`${STRINGS}.characterCount`, { length: text.length, max: definition.maxLength })}
        </Text>
        <Box grow="Yes" />
        {canEdit && baseline !== '' && (
          <Button
            type="button"
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            disabled={sending}
            onClick={() => void write('').then((took) => took && setDraft(undefined))}
          >
            <Text size="B300">{t(`${STRINGS}.clear`)}</Text>
          </Button>
        )}
        {canEdit && (
          <Button
            type="submit"
            size="300"
            radii="300"
            variant="Success"
            fill={justSaved ? 'None' : 'Solid'}
            className={justSaved ? css.Saved : undefined}
            disabled={!canSave}
            before={
              justSaved ? (
                <Icon className={css.SavedCheck} size="100" src={Icons.Check} aria-hidden />
              ) : undefined
            }
          >
            <Text size="B300">{t(justSaved ? `${STRINGS}.saved` : `${STRINGS}.save`)}</Text>
          </Button>
        )}
      </Box>
      {/* A disabled button's new text is not read out; this line says the save went through. */}
      <span role="status" className={css.VisuallyHidden}>
        {justSaved ? t(`${STRINGS}.saved`) : ''}
      </span>
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t(`${STRINGS}.saveFailed`)}
        </Text>
      )}
      {definition.note && (
        <Text id={noteId} size="T200" priority="300">
          {t(definition.note)}
        </Text>
      )}
      {!canEdit && (
        <Text id={readOnlyId} size="T200" priority="300">
          {t(`${STRINGS}.readOnly`)}
        </Text>
      )}
    </Box>
  );
}
