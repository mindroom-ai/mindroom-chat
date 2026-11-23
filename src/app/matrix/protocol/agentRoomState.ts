import {
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type RoomState,
} from 'matrix-js-sdk';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { getPowersLevelFromMatrixEvent } from '../hooks/usePowerLevels';
import { getRoomCreators } from '../hooks/useRoomCreators';
import { StateEvent } from '../types/room';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';
import {
  boundRoomRoster,
  MINDROOM_ACCOUNTS_STATE_EVENT,
  MINDROOM_ROUTER_STATE_EVENT,
  trustedRoomAccountIds,
  trustedRouterUserId,
} from './routerBinding';

const EMPTY_SET: ReadonlySet<string> = new Set();

const isMemberJoinedOrUnloaded = (room: Room, userId: string): boolean => {
  const member = room.getMember(userId);
  return member === null || member.membership === 'join';
};

const getRoomStateByKey = (
  room: Room,
  eventType: string,
  stateKey: string
): MatrixEvent | undefined =>
  room.currentState
    .getStateEvents(eventType)
    .find((event) => event.getStateKey() === stateKey && !event.isRedacted?.());

/**
 * Joined accounts vouched for by the room's trusted `io.mindroom.router` binding and its
 * `io.mindroom.accounts` roster (enables custom `matrix_username` agents without `mindroom_`).
 */
export const roomTrustedAgents = (room: Room): ReadonlySet<string> => {
  const binding = getRoomStateByKey(room, MINDROOM_ROUTER_STATE_EVENT, '');
  if (!binding) return EMPTY_SET;
  const powerLevelsEvent = getRoomStateByKey(room, StateEvent.RoomPowerLevels, '');
  const powerLevels = getPowersLevelFromMatrixEvent(powerLevelsEvent);
  const createEvent = getRoomStateByKey(room, StateEvent.RoomCreate, '');
  const creators = createEvent ? getRoomCreators(createEvent) : EMPTY_SET;
  const boundUserId = trustedRouterUserId(
    binding,
    powerLevels,
    creators,
    powerLevelsEvent?.getContent()
  );
  if (!boundUserId) return EMPTY_SET;
  const rosterEvent = getRoomStateByKey(room, MINDROOM_ACCOUNTS_STATE_EVENT, boundUserId);
  const roster = boundRoomRoster(boundUserId, rosterEvent);
  const joined = new Set<string>();
  for (const id of roster) {
    if (isMemberJoinedOrUnloaded(room, id)) joined.add(id);
  }
  return trustedRoomAccountIds(boundUserId, roster, joined, EMPTY_SET);
};

/** State event types whose changes can alter which custom-username accounts are trusted in a room. */
export const isAgentTrustStateEvent = (eventType: string): boolean =>
  eventType === MINDROOM_ROUTER_STATE_EVENT ||
  eventType === MINDROOM_ACCOUNTS_STATE_EVENT ||
  eventType === (StateEvent.RoomPowerLevels as string);

export type AgentRoomStateOptions = {
  /**
   * Also accept joined accounts vouched for by the room's trusted `io.mindroom.router` binding and
   * `io.mindroom.accounts` roster (for custom-username agents). Keep `false` (default) for
   * account-wide / origin-sensitive state such as `io.mindroom.server`.
   */
  includeTrustedRoster?: boolean;
};

/**
 * Whether a state event is a MindRoom agent describing itself: keyed by its own user ID, which Matrix
 * accepts only from that user, and sent by an agent on the viewer's homeserver or (when opted in)
 * in the room's trusted MindRoom roster.
 */
export const isAgentSelfState = (
  event: MatrixEvent,
  viewerUserId: string | undefined,
  trustedAccountIds: ReadonlySet<string> = EMPTY_SET
): boolean => {
  const sender = event.getSender();
  return (
    !!sender &&
    event.getStateKey() === sender &&
    (isMindroomAgentUserIdForViewer(sender, viewerUserId) || trustedAccountIds.has(sender))
  );
};

/**
 * The state agents published about themselves, from agents still in the room. An agent known to have
 * left cannot clear its state, so it is ignored; one whose membership is not loaded yet, as with
 * lazy-loaded members, counts as joined until its member event says otherwise.
 */
export const selectAgentSelfState = (
  events: MatrixEvent[],
  viewerUserId: string | undefined,
  isJoined: (userId: string) => boolean,
  trustedAccountIds: ReadonlySet<string> = EMPTY_SET
): MatrixEvent[] =>
  events.filter(
    (event) =>
      isAgentSelfState(event, viewerUserId, trustedAccountIds) && isJoined(event.getSender()!)
  );

/** The room's current state of one type that its agents published about themselves. */
export const agentRoomState = (
  room: Room,
  eventType: string,
  { includeTrustedRoster = false }: AgentRoomStateOptions = {}
): MatrixEvent[] => {
  const events = room.currentState.getStateEvents(eventType);
  const needsTrustedRoster =
    includeTrustedRoster &&
    events.some((event) => {
      const sender = event.getSender();
      return (
        !!sender &&
        event.getStateKey() === sender &&
        !isMindroomAgentUserIdForViewer(sender, room.myUserId)
      );
    });
  return selectAgentSelfState(
    events,
    room.myUserId,
    (userId) => isMemberJoinedOrUnloaded(room, userId),
    needsTrustedRoster ? roomTrustedAgents(room) : EMPTY_SET
  );
};

const sameEvents = (a: MatrixEvent[], b: MatrixEvent[]): boolean =>
  a.length === b.length && a.every((event, index) => event === b[index]);

/**
 * The room's agent state of this type, read again when it, an agent's membership, or the live state
 * changes. A room the client does not know (null) has none.
 */
const useAgentRoomStateEvents = (
  room: Room | null,
  eventType: string,
  includeTrustedRoster = false
): MatrixEvent[] => {
  const [version, refresh] = useForceUpdate();
  const events = useMemo(() => {
    void version;
    return room ? agentRoomState(room, eventType, { includeTrustedRoster }) : [];
  }, [room, eventType, includeTrustedRoster, version]);
  const renderedEvents = useRef(events);
  // Synchronously with the commit, so an event that lands before passive effects compares with what is shown.
  useLayoutEffect(() => {
    renderedEvents.current = events;
  }, [events]);
  useEffect(() => {
    if (!room) return undefined;
    const onState = (event: MatrixEvent) => {
      const type = event.getType();
      if (type === eventType || (includeTrustedRoster && isAgentTrustStateEvent(type))) refresh();
    };
    // Sync hands an agent's member event over again with every batch it sends in, unchanged, so
    // render again only when a membership change adds or drops state.
    const onMember = (_event: MatrixEvent, _state: RoomState, member: RoomMember) => {
      const { userId } = member;
      if (
        !isMindroomAgentUserIdForViewer(userId, room.myUserId) &&
        !renderedEvents.current.some((e) => e.getSender() === userId) &&
        !(includeTrustedRoster && roomTrustedAgents(room).has(userId))
      )
        return;
      if (
        !sameEvents(
          agentRoomState(room, eventType, { includeTrustedRoster }),
          renderedEvents.current
        )
      )
        refresh();
    };
    room.on(RoomStateEvent.Events, onState);
    room.on(RoomStateEvent.Members, onMember);
    room.on(RoomEvent.CurrentStateUpdated, refresh);
    // Catch state or membership updates that landed between render and passive effect attachment.
    if (
      !sameEvents(agentRoomState(room, eventType, { includeTrustedRoster }), renderedEvents.current)
    )
      refresh();
    return () => {
      room.removeListener(RoomStateEvent.Events, onState);
      room.removeListener(RoomStateEvent.Members, onMember);
      room.removeListener(RoomEvent.CurrentStateUpdated, refresh);
    };
  }, [room, eventType, includeTrustedRoster, refresh]);
  return events;
};

/** What `select` makes of the room's agent state of this type, read again only when that state could have changed. */
export const useAgentRoomState = <T>(
  room: Room | null,
  eventType: string,
  select: (events: MatrixEvent[]) => T,
  options?: AgentRoomStateOptions
): T => {
  const events = useAgentRoomStateEvents(room, eventType, options?.includeTrustedRoster ?? false);
  return useMemo(() => select(events), [select, events]);
};
