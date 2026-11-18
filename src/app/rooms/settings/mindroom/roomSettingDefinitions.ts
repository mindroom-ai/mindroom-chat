import type { ParseKeys } from 'i18next';

/** A free-text room setting: a multi-line field whose text, trimmed, becomes the value. */
export type RoomTextSettingDefinition = {
  kind: 'text';
  /** The state key of its `io.mindroom.room_settings` event. */
  key: string;
  /** The longest value, in characters, the field takes. */
  maxLength: number;
  label: ParseKeys;
  description: ParseKeys;
  placeholder: ParseKeys;
  /** A line under the field about when the setting takes effect, if any. */
  note?: ParseKeys;
};

/** A room setting with a few values: a menu whose first choice, `''`, leaves the setting unset. */
export type RoomChoiceSettingDefinition = {
  kind: 'choice';
  /** The state key of its `io.mindroom.room_settings` event. */
  key: string;
  label: ParseKeys;
  description: ParseKeys;
  choices: ReadonlyArray<{ value: string; label: ParseKeys }>;
};

export type RoomSettingDefinition = RoomTextSettingDefinition | RoomChoiceSettingDefinition;

const TITLES = 'featureUi.roomSettings.mindroom.threadSummaryInstructions';
const REPLY_MODE = 'featureUi.roomSettings.mindroom.replyMode';

/** The settings of the MindRoom page, in order; `docs/architecture.md` describes the event. */
export const ROOM_SETTING_DEFINITIONS: readonly RoomSettingDefinition[] = [
  {
    kind: 'choice',
    key: 'reply_mode',
    label: `${REPLY_MODE}.label`,
    description: `${REPLY_MODE}.description`,
    choices: [
      { value: '', label: `${REPLY_MODE}.default` },
      { value: 'auto', label: `${REPLY_MODE}.auto` },
      { value: 'mentions', label: `${REPLY_MODE}.mentions` },
    ],
  },
  {
    kind: 'text',
    key: 'thread_summary_instructions',
    maxLength: 2000,
    label: `${TITLES}.label`,
    description: `${TITLES}.description`,
    placeholder: `${TITLES}.placeholder`,
    note: `${TITLES}.note`,
  },
];
