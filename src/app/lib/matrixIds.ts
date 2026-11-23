// Matrix identifiers (client-server specification, "Identifier Grammar"): a sigil, a localpart
// without colons, then the server name, which may carry a port.
const USER_ID = /^@[^:\s]+:\S+$/;
const ROOM_ID = /^![^:\s]+(?::\S+)?$/;
const ROOM_ALIAS = /^#[^:\s]+:\S+$/;

export const isUserId = (id: string): boolean => USER_ID.test(id);
export const isRoomId = (id: string): boolean => ROOM_ID.test(id);
export const isRoomAlias = (id: string): boolean => ROOM_ALIAS.test(id);
