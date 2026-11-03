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




















  PoniesRoomEmotes = 'im.ponies.room_emotes',
  // Names, colours and icons for power levels, shown by the room's permission settings.
  PowerLevelTags = 'io.mindroom.power_level_tags',
  // MindRoom's agent voice call in a call room (backend `matrix_rtc/call_origin.py`).
  MindroomAgentCall = 'io.mindroom.agent_call',
  GroupCallMemberPrefix = 'org.matrix.msc3401.call.member',
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
