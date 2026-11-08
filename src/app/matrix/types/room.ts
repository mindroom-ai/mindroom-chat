import type { MatrixEvent } from 'matrix-js-sdk';

// `membership` values of `m.room.member` (specification "m.room.member"), alphabetical.
export enum Membership {
  Ban = 'ban', // Removed and kept out until unbanned.
  Invite = 'invite', // Invited and not yet joined.
  Join = 'join', // A member of the room.
  Knock = 'knock', // Asked to be let in.
  Leave = 'leave', // Not in the room: left, was removed, or turned down an invite.
}

// `join_rule` values of `m.room.join_rules` (specification "m.room.join_rules").
export enum JoinRule {
  Public = 'public', // Anyone may join.
  Invite = 'invite', // Only invited users may join.
  Private = 'private', // Reserved by the specification, without a defined behaviour.
  Knock = 'knock', // Users ask to join and a member lets them in.
  Restricted = 'restricted', // Members of the rooms listed in `allow` may join.
  KnockRestricted = 'knock_restricted', // Those members may join; others may knock.
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

// Room timeline event types (specification "Instant messaging" and "End-to-End encryption").
export enum MessageEvent {
  RoomMessage = 'm.room.message', // Its `msgtype` says what it carries, see `MsgType`.
  RoomMessageEncrypted = 'm.room.encrypted', // Decrypts to one of the other types.
  Sticker = 'm.sticker',
  RoomRedaction = 'm.room.redaction', // Removes the content of another event.
  Reaction = 'm.reaction', // An annotation on another event.
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

type UnreadCounts = {
  highlight: number;
  total: number;
};

/** Unread counts of a room, or for a space the sum over the rooms in `from`. */
export type Unread = UnreadCounts & {
  /** For a space: the rooms whose counts are summed. */
  from?: Set<string>;
};

/** The notification counts the client reports for one room. */
export type UnreadInfo = UnreadCounts & { roomId: string };

/** Unread entry per room ID, including one aggregate entry per space. */
export type RoomToUnread = Map<string, Unread>;

/** Room ID to the IDs of the spaces, and chat rooms of a sub-room, whose `m.space.child` events list it. */
export type RoomToParents = Map<string, Set<string>>;

/** Lazily reads the (possibly edited) content of the event being rendered. */
export type GetContentCallback = <Content>() => Content;

export type EventRenderer = (event: MatrixEvent) => unknown;
