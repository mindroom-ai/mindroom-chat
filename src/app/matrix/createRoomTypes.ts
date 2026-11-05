/** Who may join a new room. */
export const CreateRoomAccess = {
  /** Invite only (or knock, when requests are allowed). */
  Private: 'private',
  /** Members of the parent space may join. */
  Restricted: 'restricted',
  /** Anyone may join. */
  Public: 'public',
} as const;
export type CreateRoomAccess = (typeof CreateRoomAccess)[keyof typeof CreateRoomAccess];

/** The kind of room to create: a chat room, or a call room people talk in. */
export const CreateRoomType = {
  TextRoom: 'text',
  VoiceRoom: 'voice',
} as const;
export type CreateRoomType = (typeof CreateRoomType)[keyof typeof CreateRoomType];
