// Matrix identifiers (client-server specification, "Identifier Grammar"): a sigil, a localpart
// without colons, then the server name, which may carry a port.
// eslint-disable-next-line no-control-regex
const ASCII_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const USER_ID = /^@[^:\s]+:\S+$/;
const ROOM_ID = /^![^:\s]+(?::\S+)?$/;
const ROOM_ALIAS = /^#[^:\s]+:\S+$/;
const EVENT_ID = /^\$\S+$/;

export const isUserId = (id: string): boolean => USER_ID.test(id);
export const isRoomId = (id: string): boolean => ROOM_ID.test(id);
export const isRoomAlias = (id: string): boolean => ROOM_ALIAS.test(id);
export const isEventId = (id: unknown): id is string =>
  typeof id === 'string' && !ASCII_CONTROL_CHARS.test(id) && EVENT_ID.test(id);
