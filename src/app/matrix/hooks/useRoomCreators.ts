import { useMemo } from 'react';
import { EventTimeline, MatrixEvent, Room } from 'matrix-js-sdk';
import { StateEvent } from '../types/room';
import { useStateEventCallback } from './useStateEventCallback';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { matchesEnum } from '../../lib/matchesEnum';

// Room versions from 12 on (and the hydra test version) make the room's creators privileged:
// they outrank every power level and cannot be demoted.
const PRIVILEGED_CREATOR_ROOM_VERSIONS = new Set(['org.matrix.hydra.11']);

const roomVersionHasPrivilegedCreators = (roomVersion: string | undefined): boolean => {
  if (!roomVersion) return false;
  if (PRIVILEGED_CREATOR_ROOM_VERSIONS.has(roomVersion)) return true;
  return /^\d+$/.test(roomVersion) && Number(roomVersion) >= 12;
};

/**
 * The privileged creators of a room from its `m.room.create` event: the sender plus
 * `additional_creators`. Empty for room versions without privileged creators.
 */
export const getRoomCreators = (createEvent: MatrixEvent): Set<string> => {
  const content = createEvent.getContent();
  const roomVersion = typeof content.room_version === 'string' ? content.room_version : '1';
  const creators = new Set<string>();
  if (!roomVersionHasPrivilegedCreators(roomVersion)) return creators;

  const sender = createEvent.getSender();
  if (sender) creators.add(sender);
  const additional: unknown = content.additional_creators;
  if (Array.isArray(additional)) {
    additional.forEach((userId) => {
      if (typeof userId === 'string') creators.add(userId);
    });
  }
  return creators;
};

const getCreateEvent = (room: Room): MatrixEvent | undefined =>
  room
    .getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents(StateEvent.RoomCreate, '') ?? undefined;

/** The room's privileged creators, following its create event. */
export const useRoomCreators = (room: Room): Set<string> => {
  const [version, refresh] = useForceUpdate();
  const refreshOnCreateEvent = useMemo(
    () => (event: MatrixEvent) => {
      if (
        event.getRoomId() === room.roomId &&
        matchesEnum(event.getType(), StateEvent.RoomCreate)
      ) {
        refresh();
      }
    },
    [room.roomId, refresh]
  );
  useStateEventCallback(room.client, refreshOnCreateEvent);

  return useMemo(() => {
    void version;
    const createEvent = getCreateEvent(room);
    return createEvent ? getRoomCreators(createEvent) : new Set<string>();
  }, [room, version]);
};
