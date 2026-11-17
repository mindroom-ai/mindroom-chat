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

export type RoomSettingDefinition = RoomTextSettingDefinition;

const TITLES = 'featureUi.roomSettings.mindroom.threadSummaryInstructions';

/** The settings of the MindRoom page, in order; `docs/architecture.md` describes the event. */
export const ROOM_SETTING_DEFINITIONS: readonly RoomSettingDefinition[] = [
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
