import type { MatrixEvent } from 'matrix-js-sdk';

// `membership` values of `m.room.member` (specification "m.room.member"), alphabetical.









}

// `join_rule` values of `m.room.join_rules` (specification "m.room.join_rules").
export enum JoinRule {
  /** Anyone may join. */







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


























































  total: number;
  /** For a space: the rooms whose counts are summed. */
  from?: Set<string>;
};

/** The notification counts the client reports for one room. */
export type UnreadInfo = Omit<Unread, 'from'> & { roomId: string };

/** Unread entry per room ID, including one aggregate entry per space. */








export type EventRenderer = (event: MatrixEvent) => unknown;
