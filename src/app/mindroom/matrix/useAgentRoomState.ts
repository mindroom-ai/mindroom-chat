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
import { isMindroomAgentUserIdForViewer } from './agentIdentity';

/**
 * What MindRoom agents publish in one room state event type, read again only when such an event, an agent's
 * membership, or the room's live state changes. Only MindRoom accounts on the viewer's homeserver that are still in
 * the room count; one known to have left cannot clear its state, so its last event is ignored, while an agent whose
 * membership is not loaded yet, as with lazy-loaded members, counts as joined until its member event says otherwise.
 * `select` reads only those events and must be a stable function.
 */
export const useAgentRoomState = <T>(
  room: Room,
  eventType: string,
  select: (events: MatrixEvent[]) => T
): T => {
  const [version, refresh] = useForceUpdate();
  useEffect(() => {
    const onState = (event: MatrixEvent) => {
      if (event.getType() === eventType) refresh();
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
  }, [room, eventType, refresh]);
  return useMemo(() => {
    void version;
    return select(
      room.currentState.getStateEvents(eventType).filter((event) => {
        const sender = event.getSender();
        if (!sender || !isMindroomAgentUserIdForViewer(sender, room.myUserId)) return false;
        const member = room.getMember(sender);
        return member === null || member.membership === 'join';
      })
    );
  }, [room, eventType, select, version]);
};
