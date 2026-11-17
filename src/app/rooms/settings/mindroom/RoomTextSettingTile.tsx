import { type FormEvent, useEffect, useId, useState } from 'react';
import { Box, Button, Text, TextArea, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useAlive } from '../../../lib/hooks/useAlive';
import { useMatrixClient } from '../../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../../matrix/hooks/useRoomPermissions';
import { useStateEvent } from '../../../matrix/hooks/useStateEvent';
import { ROOM_SETTINGS_EVENT, readRoomSettingValue } from '../../../matrix/protocol/roomSettings';
import type { RoomTextSettingDefinition } from './roomSettingDefinitions';

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
  const client = useMatrixClient();
  const alive = useAlive();
  const id = useId();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const canEdit = may.stateEvent(ROOM_SETTINGS_EVENT, client.getSafeUserId());
  const event = useStateEvent(room, ROOM_SETTINGS_EVENT, definition.key);
  const eventId = event?.getId();
  const current = readRoomSettingValue(event?.getContent()) ?? '';
  // The person's text, from their first keystroke until the room's state shows what they saved.
  const [draft, setDraft] = useState<string>();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  // After the server took a write: the event the room showed when it went out.
  const [replacing, setReplacing] = useState<{ eventId: string | undefined }>();

  // Once the room's state moves past that event, the field follows the room again.
  useEffect(() => {
    if (replacing && replacing.eventId !== eventId) {
      setReplacing(undefined);
      setDraft(undefined);
    }
  }, [replacing, eventId]);

  const text = draft ?? current;
  const trimmed = text.trim();
  const tooLong = text.length > definition.maxLength;
  const canSave = canEdit && !sending && !replacing && !tooLong && trimmed !== current;

  const write = (content: { value?: string }, shown: string) => {
    const before = eventId;
    setSending(true);
    setFailed(false);
    client
      .sendStateEvent(room.roomId, ROOM_SETTINGS_EVENT as never, content as never, definition.key)
      .then(
        () => {
          if (!alive()) return;
          setSending(false);
          setDraft(shown);
          setReplacing({ eventId: before });
        },
        () => {
          if (!alive()) return;
          setSending(false);
          setFailed(true);
        }
      );
  };

  const save = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (canSave) write(trimmed === '' ? {} : { value: trimmed }, trimmed);
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
          setDraft(evt.currentTarget.value);
          setReplacing(undefined);
          setFailed(false);
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
        {canEdit && current !== '' && (
          <Button
            type="button"
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            disabled={sending}
            onClick={() => write({}, '')}
          >
            <Text size="B300">{t(`${STRINGS}.clear`)}</Text>
          </Button>
        )}
        {canEdit && (
          <Button type="submit" size="300" radii="300" variant="Success" disabled={!canSave}>
            <Text size="B300">{t(`${STRINGS}.save`)}</Text>
          </Button>
        )}
      </Box>
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
