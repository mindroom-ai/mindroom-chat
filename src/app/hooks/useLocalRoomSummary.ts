import { useEffect, useState } from 'react';
import {
  EventTimeline,
  GuestAccess,
  HistoryVisibility,
  JoinRule,
  MatrixEvent,
  Room,
  RoomEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';

type RoomIdentity = {
  roomId: string;
  name: string;
  topic?: string;
  /** The `mxc://` avatar URL. */
  avatarUrl?: string;
  canonicalAlias?: string;
};

/** What the room allows people who are not in it: its join rule, public history, guest entry. */
type OutsiderAccess = { joinRule: JoinRule; worldReadable: boolean; guestCanJoin: boolean };

/**
 * What the lobby and room cards show for a room the client already has. `memberCount` is the
 * joined members as the client counts them; `roomType` is the `m.room.create` `type`, such as
 * `m.space`.
 */
export type LocalRoomSummary = RoomIdentity &
  OutsiderAccess & { memberCount: number; roomType?: string };

const readString = (event: MatrixEvent | null | undefined, key: string): string | undefined => {
  const value: unknown = event?.getContent()[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

type StateEventReader = (type: StateEvent) => MatrixEvent | null | undefined;

const readOutsiderAccess = (room: Room, stateEvent: StateEventReader): OutsiderAccess => ({
  joinRule: room.getJoinRule(),
  worldReadable:
    readString(stateEvent(StateEvent.RoomHistoryVisibility), 'history_visibility') ===
    HistoryVisibility.WorldReadable,
  guestCanJoin:
    readString(stateEvent(StateEvent.RoomGuestAccess), 'guest_access') === GuestAccess.CanJoin,
});

const readLocalRoomSummary = (room: Room): LocalRoomSummary => {
  const state = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
  const stateEvent: StateEventReader = (type) => state?.getStateEvents(type, '');
  return {
    roomId: room.roomId,
    name: room.name,
    topic: readString(stateEvent(StateEvent.RoomTopic), 'topic'),
    avatarUrl: room.getMxcAvatarUrl() || undefined,
    canonicalAlias: room.getCanonicalAlias() || undefined,
    memberCount: room.getJoinedMemberCount(),
    roomType: room.getType(),
    ...readOutsiderAccess(room, stateEvent),
  };
};

/** The summary of a joined room, following its state and name. */
export const useLocalRoomSummary = (room: Room): LocalRoomSummary => {
  const [summary, setSummary] = useState(() => readLocalRoomSummary(room));

  useEffect(() => {
    const refresh = () => setSummary(readLocalRoomSummary(room));
    refresh();
    room.on(RoomStateEvent.Events, refresh);
    room.on(RoomEvent.Name, refresh);
    return () => {
      room.removeListener(RoomStateEvent.Events, refresh);
      room.removeListener(RoomEvent.Name, refresh);
    };
  }, [room]);

  return summary;
};
