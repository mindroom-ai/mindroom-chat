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
  /** Shows the room's current effective `io.mindroom.thread_mode` under the tile. */
  showEffectiveThreadMode?: boolean;
};

/** A room setting holding a model reference (`key` or `key@level`), chosen from the room catalog. */
export type RoomModelSettingDefinition = {
  kind: 'model';
  /** The state key of its `io.mindroom.room_settings` event. */
  key: string;
  label: ParseKeys;
  description: ParseKeys;
  /** Whether the picker offers reasoning levels (`key@level`) alongside plain model keys. */
  allowReasoningLevels: boolean;
};

export type RoomSettingDefinition =
  | RoomTextSettingDefinition
  | RoomChoiceSettingDefinition
  | RoomModelSettingDefinition;

export type RoomSettingSection = {
  id: string;
  title: ParseKeys;
  settings: readonly RoomSettingDefinition[];
};

const SECTIONS = 'featureUi.roomSettings.mindroom.sections';
const MODEL = 'featureUi.roomSettings.mindroom.model';
const REPLY_MODE = 'featureUi.roomSettings.mindroom.replyMode';
const THREAD_MODE = 'featureUi.roomSettings.mindroom.threadMode';
const TITLES = 'featureUi.roomSettings.mindroom.threadSummaryInstructions';
const TITLE_MODEL = 'featureUi.roomSettings.mindroom.threadSummaryModel';

/** The sections and settings of the MindRoom page, in order; `docs/architecture.md` describes the event. */
export const ROOM_SETTING_SECTIONS: readonly RoomSettingSection[] = [
  {
    id: 'agents',
    title: `${SECTIONS}.agents`,
    settings: [
      {
        kind: 'model',
        key: 'model',
        label: `${MODEL}.label`,
        description: `${MODEL}.description`,
        allowReasoningLevels: true,
      },
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
        kind: 'choice',
        key: 'thread_mode',
        label: `${THREAD_MODE}.label`,
        description: `${THREAD_MODE}.description`,
        choices: [
          { value: '', label: `${THREAD_MODE}.default` },
          { value: 'thread', label: `${THREAD_MODE}.thread` },
          { value: 'room', label: `${THREAD_MODE}.room` },
        ],
        showEffectiveThreadMode: true,
      },
    ],
  },
  {
    id: 'thread_titles',
    title: `${SECTIONS}.threadTitles`,
    settings: [
      {
        kind: 'text',
        key: 'thread_summary_instructions',
        maxLength: 2000,
        label: `${TITLES}.label`,
        description: `${TITLES}.description`,
        placeholder: `${TITLES}.placeholder`,
        note: `${TITLES}.note`,
      },
      {
        kind: 'model',
        key: 'thread_summary_model',
        label: `${TITLE_MODEL}.label`,
        description: `${TITLE_MODEL}.description`,
        allowReasoningLevels: false,
      },
    ],
  },
];

/** Flat list of every setting on the MindRoom page, in display order. */
export const ROOM_SETTING_DEFINITIONS: readonly RoomSettingDefinition[] =
  ROOM_SETTING_SECTIONS.flatMap((section) => section.settings);
