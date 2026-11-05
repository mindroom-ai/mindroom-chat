// Account data event types the client reads or writes.

export enum AccountDataEvent {
  Direct = 'm.direct',
  PushRules = 'm.push_rules',
  IgnoredUserList = 'm.ignored_user_list',
  SecretStorageDefaultKey = 'm.secret_storage.default_key',
  CrossSigningMaster = 'm.cross_signing.master',
  MegolmBackupV1 = 'm.megolm_backup.v1',
  // The sidebar's space order and folders.
  MindroomSpaces = 'io.mindroom.spaces',
  // Room lists ordered by hand: `sidebar/room-nav/roomOrder.ts`.
  MindroomRoomOrder = 'io.mindroom.room_order',
  ElementRecentEmoji = 'io.element.recent_emoji',
  PoniesUserEmotes = 'im.ponies.user_emotes',
  PoniesEmoteRooms = 'im.ponies.emote_rooms',
}

/** `m.direct`: user ID to the IDs of the direct rooms shared with that user. */
export type MDirectContent = Record<string, string[]>;
