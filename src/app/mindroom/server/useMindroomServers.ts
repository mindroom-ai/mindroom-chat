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
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSpecVersions } from '../../hooks/useSpecVersions';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import {
  MINDROOM_SERVER_EVENT,
  OPENID_AUDIENCE_FEATURE,
  distinctServerUrls,
  selectMindroomServers,
  type MindroomServer,
} from './mindroomServer';

// An agent whose membership is not loaded yet, as with lazy-loaded members, counts as joined.
const roomServers = (room: Room): MindroomServer[] =>
  selectMindroomServers(
    room.currentState.getStateEvents(MINDROOM_SERVER_EVENT),
    room.myUserId,
    (userId) => {
      const member = room.getMember(userId);
      return member === null || member.membership === 'join';
    }
  );

/** Whether the homeserver binds OpenID tokens, so Chat may open the origins agents publish. */
export const useBindsOpenIdTokens = (): boolean =>
  useSpecVersions().unstable_features?.[OPENID_AUDIENCE_FEATURE] === true;

/** The servers of the room's agents, read again when one changes or an agent's membership does. */
export const useRoomMindroomServers = (room: Room): MindroomServer[] => {
  const [version, refresh] = useForceUpdate();
  useEffect(() => {
    const onState = (event: MatrixEvent) => {
      if (event.getType() === MINDROOM_SERVER_EVENT) refresh();
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
    return roomServers(room);
  }, [room, version]);
};

/** Every server the agents in the user's rooms publish, newest first, while the homeserver binds tokens. */
export const useMindroomServerUrls = (): string[] => {
  const mx = useMatrixClient();
  const bindsTokens = useBindsOpenIdTokens();
  const [version, refresh] = useForceUpdate();
  useEffect(() => {
    const viewer = mx.getUserId() ?? undefined;
    const onState = (event: MatrixEvent) => {
      if (event.getType() === MINDROOM_SERVER_EVENT) refresh();
    };
    const onMember = (_event: MatrixEvent, _state: RoomState, member: RoomMember) => {
      if (isMindroomAgentUserIdForViewer(member.userId, viewer)) refresh();
    };
    mx.on(RoomStateEvent.Events, onState);
    mx.on(RoomStateEvent.Members, onMember);
    mx.on(RoomEvent.MyMembership, refresh);
    return () => {
      mx.removeListener(RoomStateEvent.Events, onState);
      mx.removeListener(RoomStateEvent.Members, onMember);
      mx.removeListener(RoomEvent.MyMembership, refresh);
    };
  }, [mx, refresh]);
  return useMemo(() => {
    void version;
    if (!bindsTokens) return [];
    return distinctServerUrls(
      mx
        .getRooms()
        .filter((room) => room.getMyMembership() === 'join')
        .flatMap(roomServers)
    );
  }, [mx, bindsTokens, version]);
};
