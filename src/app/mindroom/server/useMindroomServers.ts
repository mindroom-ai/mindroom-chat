import {
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { useEffect, useMemo, useState } from 'react';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { agentRoomState, useAgentRoomStateVersion } from '../matrix/agentRoomState';
import { confirmOpenIdBinding } from '../matrix/openidAudience';
import {
  MINDROOM_SERVER_EVENT,
  distinctServerUrls,
  selectMindroomServers,
  type MindroomServer,
} from './mindroomServer';

const roomServers = (room: Room): MindroomServer[] =>
  selectMindroomServers(agentRoomState(room, MINDROOM_SERVER_EVENT));

// One check per client for what Chat shows; a token for a published origin is only ever requested after a new one.
const bindingChecks = new WeakMap<MatrixClient, Promise<boolean>>();

/** Whether the homeserver binds OpenID tokens, asked once per client, so Chat may offer the origins agents publish. */
export const useBindsOpenIdTokens = (): boolean => {
  const mx = useMatrixClient();
  const [binds, setBinds] = useState(false);
  useEffect(() => {
    let current = true;
    let check = bindingChecks.get(mx);
    if (!check) {
      check = confirmOpenIdBinding(mx);
      bindingChecks.set(mx, check);
    }
    check.then((value) => {
      if (current) setBinds(value);
    });
    return () => {
      current = false;
    };
  }, [mx]);
  return binds;
};

/** The servers of the room's agents, read again when one changes or an agent's membership does. */
export const useRoomMindroomServers = (room: Room): MindroomServer[] => {
  const version = useAgentRoomStateVersion(room, MINDROOM_SERVER_EVENT);
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
    const onState = (event: MatrixEvent) => {
      if (event.getType() === MINDROOM_SERVER_EVENT) refresh();
    };
    // Membership changes in any room can change which agents' servers count.
    mx.on(RoomStateEvent.Events, onState);
    mx.on(RoomStateEvent.Members, refresh);
    mx.on(RoomEvent.MyMembership, refresh);
    return () => {
      mx.removeListener(RoomStateEvent.Events, onState);
      mx.removeListener(RoomStateEvent.Members, refresh);
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
