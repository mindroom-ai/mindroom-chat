/**
 * Room state with the room's MindRoom settings, set by its moderators and admins and read by its
 * agents: one event per setting, keyed by the setting's name, with content `{"value": <string>}`.
 * Matrix keeps state forever, so clearing a setting sends `{}`.
 */
export const ROOM_SETTINGS_EVENT = 'io.mindroom.room_settings';

/**
 * The value an `io.mindroom.room_settings` content holds, trimmed. A missing content, `{}`, a
 * `value` that is not a string, or one with nothing but white space all leave the setting unset.
 */
export const readRoomSettingValue = (content: unknown): string | undefined => {
  if (typeof content !== 'object' || content === null) return undefined;
  const { value } = content as { value?: unknown };
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};
