import type { MatrixEvent } from 'matrix-js-sdk';
import { Trans } from 'react-i18next';

const KEYS = 'mindroomUi.threads.roomTimelineStateEventRenderers';

/** The sentence a room name, topic or avatar row says, and the new name or topic it quotes. */
export type RoomStateChange = {
  key: string;
  value?: string;
};

/** A field's text, trimmed; undefined when it is missing, not a string or blank. */
const textOf = (content: Record<string, unknown>, field: string): string | undefined => {
  const value = content[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/** Sentences for a field that a state event sets to a text or clears. */
const TEXT_FIELDS: Record<
  string,
  { field: string; changedTo: string; removed: string; changed: string }
> = {
  'm.room.name': {
    field: 'name',
    changedTo: `${KEYS}.changedRoomNameTo`,
    removed: `${KEYS}.removedRoomName`,
    changed: `${KEYS}.changedRoomName`,
  },
  'm.room.topic': {
    field: 'topic',
    changedTo: `${KEYS}.changedRoomTopicTo`,
    removed: `${KEYS}.removedRoomTopic`,
    changed: `${KEYS}.changedRoomTopic`,
  },
};

/**
 * Describes a room name, topic or avatar event: a new name or topic is quoted, a missing or
 * blank one reads as removed. A redacted event no longer says what it set, so its row only says
 * that the name or topic changed. Other event types answer undefined.
 */
export const describeRoomStateChange = (event: MatrixEvent): RoomStateChange | undefined => {
  const type = event.getType();
  if (type === 'm.room.avatar') return { key: `${KEYS}.changedRoomAvatar` };
  const sentences = TEXT_FIELDS[type];
  if (!sentences) return undefined;
  if (event.isRedacted()) return { key: sentences.changed };
  const value = textOf(event.getContent(), sentences.field);
  return value ? { key: sentences.changedTo, value } : { key: sentences.removed };
};

/**
 * A room state row's sentence. The sender's name renders bold and the quoted name or topic in a
 * `bdi`, so each keeps its own direction inside the sentence. Values are escaped before the
 * sentence's markup is parsed and unescaped in the rendered text, so a name such as `<3` stays
 * text.
 */
export function RoomStateSentence({ change, sender }: { change: RoomStateChange; sender: string }) {
  return (
    <Trans
      i18nKey={change.key as never}
      values={{ sender, value: change.value ?? '' }}
      components={{ sender: <b dir="auto" />, value: <bdi /> }}
      tOptions={{ interpolation: { escapeValue: true } }}
      shouldUnescape
    />
  );
}
