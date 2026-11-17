import { type FormEvent, useEffect, useId, useState } from 'react';
import { Box, Button, Icon, Icons, Text, TextArea, color } from 'folds';
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
import * as css from './RoomTextSettingTile.css';

const STRINGS = 'featureUi.roomSettings.mindroom';
// How long Save reads Saved after a write went through.
const SAVED_FOR_MS = 2000;

type Saved = { value: string; eventId: string; older: ReadonlySet<string | undefined> };

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
  const live = readRoomSettingValue(event?.getContent()) ?? '';
  // The latest save's value and event, and the events older than it: those the room showed when
  // this tile's saves went out, and the saves' own. While the room shows one of those, the save
  // counts; its own echo or anyone else's event ends that.
  const [saved, setSaved] = useState<Saved>();
  const baseline =
    saved && eventId !== saved.eventId && saved.older.has(eventId) ? saved.value : live;
  // The person's text while it differs from the baseline; undefined follows the room.
  const [draft, setDraft] = useState<string>();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  // Save reads Saved for a moment after a write, until the person types again. Each write sets a
  // new object, so a second one within the moment restarts the timer even in the same render.
  const [justSaved, setJustSaved] = useState<object>();
  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => setJustSaved(undefined), SAVED_FOR_MS);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const text = draft ?? baseline;
  const tooLong = text.length > definition.maxLength;
  const dirty = draft !== undefined && draft.trim() !== baseline;
  const canSave = canEdit && dirty && !sending && !tooLong;

  const write = (value: string) => {
    const before = eventId;
    setSending(true);
    setFailed(false);
    setJustSaved(undefined);
    const content = value === '' ? {} : { value };
    client
      .sendStateEvent(room.roomId, ROOM_SETTINGS_EVENT as never, content as never, definition.key)
      .then(
        ({ event_id: sentId }) => {
          if (!alive()) return;
          setSaved((last) => ({
            value,
            eventId: sentId,
            older: new Set([...(last?.older ?? []), last?.eventId, before]),
          }));
          setDraft(undefined);
          setSending(false);
          setJustSaved({});
        },
        () => {
          if (!alive()) return;
          setFailed(true);
          setSending(false);
        }
      );
  };

  const save = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (canSave) write(draft.trim());
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
          setFailed(false);
          setJustSaved(undefined);
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
            onClick={() => write('')}
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
