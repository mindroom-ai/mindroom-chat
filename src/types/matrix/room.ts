import type { MatrixEvent } from 'matrix-js-sdk';







}

export enum JoinRule {





  KnockRestricted = 'knock_restricted',
}

export enum HistoryVisibility {
  Invited = 'invited',
  Joined = 'joined',
  Shared = 'shared',
  WorldReadable = 'world_readable',
}

/** The `type` of an `m.room.create` event. */
export enum RoomType {
  Space = 'm.space',
  // MSC3417 call rooms.
  Call = 'org.matrix.msc3417.call',
  // The room that holds a homeserver's shared emoji pack.
  MindroomEmoji = 'io.mindroom.emoji',
}

/**
 * Room state event types, grouped by purpose (specification "Room events" and "Spaces"
 * chapters), alphabetical inside a group. The last group holds the extensions this client reads.
 */
export enum StateEvent {
  // Creation, membership and encryption of the room.
  RoomCreate = 'm.room.create',
  RoomEncryption = 'm.room.encryption',
  RoomMember = 'm.room.member',
  RoomThirdPartyInvite = 'm.room.third_party_invite',
  RoomTombstone = 'm.room.tombstone',

  // Who may join, see history and act in the room.
  RoomGuestAccess = 'm.room.guest_access',
  RoomHistoryVisibility = 'm.room.history_visibility',
  RoomJoinRules = 'm.room.join_rules',
  RoomPowerLevels = 'm.room.power_levels',
  RoomServerAcl = 'm.room.server_acl',

  // How the room presents itself.
  RoomAvatar = 'm.room.avatar',
  RoomCanonicalAlias = 'm.room.canonical_alias',
  RoomName = 'm.room.name',
  RoomPinnedEvents = 'm.room.pinned_events',
  RoomTopic = 'm.room.topic',

  // Space hierarchy.
  SpaceChild = 'm.space.child',
  SpaceParent = 'm.space.parent',

  // MSC3401 group calls.
  GroupCallMemberPrefix = 'org.matrix.msc3401.call.member',
  // MSC2545 image packs.
  PoniesRoomEmotes = 'im.ponies.room_emotes',
  // MindRoom's agent voice call in a call room (backend `matrix_rtc/call_origin.py`).
  MindroomAgentCall = 'io.mindroom.agent_call',
  // Names, colours and icons for power levels, shown by the room's permission settings.
  PowerLevelTags = 'io.mindroom.power_level_tags',
}

export enum MessageEvent {
  RoomMessage = 'm.room.message',
  RoomMessageEncrypted = 'm.room.encrypted',
  Sticker = 'm.sticker',
  RoomRedaction = 'm.room.redaction',
  Reaction = 'm.reaction',
}

export enum MsgType {
  Text = 'm.text',
  Emote = 'm.emote',
  Notice = 'm.notice',
  Image = 'm.image',
  File = 'm.file',
  Audio = 'm.audio',
  Video = 'm.video',
  Location = 'm.location',
}

/** Unread counts of a room, or for a space the sum over the rooms in `from`. */



















export type EventRenderer = (event: MatrixEvent) => unknown;
