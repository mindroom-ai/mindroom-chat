import {
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type RoomState,
} from 'matrix-js-sdk';
import { useEffect, useMemo } from 'react';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import {
  type BackgroundJob,
  MINDROOM_BACKGROUND_JOBS_EVENT,
  selectBackgroundJobs,
} from './backgroundJobsContract';

/**
 * Every live background job of the room, read again only when a jobs event, an agent's membership,
 * or the room's live state changes. An agent whose membership is not loaded yet, as with lazy-loaded
 * members, counts as joined until its member event says otherwise.
 */
export const useRoomBackgroundJobs = (room: Room): BackgroundJob[] => {
  const [version, refresh] = useForceUpdate();
  useEffect(() => {
    const onState = (event: MatrixEvent) => {
      if (event.getType() === MINDROOM_BACKGROUND_JOBS_EVENT) refresh();
    };
    const onMember = (_event: MatrixEvent, _state: RoomState, member: RoomMember) => {
      if (isMindroomAgentUserIdForViewer(member.userId, room.myUserId)) refresh();
    };
    room.on(RoomStateEvent.Events, onState);
    room.on(RoomStateEvent.Members, onMember);
    room.on(RoomEvent.CurrentStateUpdated, refresh);
    return () => {
      room.removeListener(RoomStateEvent.Events, onState);
      room.removeListener(RoomStateEvent.Members, onMember);
      room.removeListener(RoomEvent.CurrentStateUpdated, refresh);
    };
  }, [room, refresh]);
  return useMemo(() => {
    void version;
    return selectBackgroundJobs(
      room.currentState.getStateEvents(MINDROOM_BACKGROUND_JOBS_EVENT),
      room.myUserId,
      (userId) => {
        const member = room.getMember(userId);
        return member === null || member.membership === 'join';
      }
    );
  }, [room, version]);
};
