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

/** What the lobby and room cards show for a room the client already has. */
export type LocalRoomSummary = {
  roomId: string;
  name: string;
  topic?: string;
  /** The `mxc://` avatar URL. */
  avatarUrl?: string;
  canonicalAlias?: string;
  worldReadable: boolean;
  guestCanJoin: boolean;



};

const readString = (event: MatrixEvent | null | undefined, key: string): string | undefined => {
  const value: unknown = event?.getContent()[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export const getLocalRoomSummary = (room: Room): LocalRoomSummary => {
  const state = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
  const stateEvent = (type: StateEvent) => state?.getStateEvents(type, '');
  return {
    roomId: room.roomId,
    name: room.name,
    topic: readString(stateEvent(StateEvent.RoomTopic), 'topic'),
    avatarUrl: room.getMxcAvatarUrl() ?? undefined,
    canonicalAlias: room.getCanonicalAlias() ?? undefined,
    worldReadable:
      readString(stateEvent(StateEvent.RoomHistoryVisibility), 'history_visibility') ===
      HistoryVisibility.WorldReadable,
    guestCanJoin:
      readString(stateEvent(StateEvent.RoomGuestAccess), 'guest_access') === GuestAccess.CanJoin,



  };
};

/** The summary of a joined room, following its state and name. */
export const useLocalRoomSummary = (room: Room): LocalRoomSummary => {
  const [summary, setSummary] = useState(() => getLocalRoomSummary(room));

  useEffect(() => {
    const refresh = () => setSummary(getLocalRoomSummary(room));
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
