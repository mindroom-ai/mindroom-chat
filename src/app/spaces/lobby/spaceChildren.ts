import { EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import { StateEvent } from '../../matrix/types/room';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getPowersLevelFromMatrixEvent } from '../../matrix/hooks/usePowerLevels';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { getViaServers } from '../../matrix/via-servers';

// State events are sent untyped: the SDK's state event map does not list the space events.
type UntypedStateSender = (
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
  stateKey: string
) => Promise<unknown>;

const sendState = (client: MatrixClient): UntypedStateSender =>
  client.sendStateEvent.bind(client) as unknown as UntypedStateSender;

const liveState = (room: Room) => room.getLiveTimeline().getState(EventTimeline.FORWARDS);

/** What the signed-in user may do in `room`, from its current power levels and creators. */
export const getMyRoomPermissions = (client: MatrixClient, room: Room) => {
  const state = liveState(room);
  const levels = getPowersLevelFromMatrixEvent(
    state?.getStateEvents(StateEvent.RoomPowerLevels, '')
  );
  const createEvent = state?.getStateEvents(StateEvent.RoomCreate, '');
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  const api = getRoomPermissionsAPI(creators, levels);
  const me = client.getSafeUserId();
  return {
    stateEvent: (eventType: string) => api.stateEvent(eventType, me),
    invite: () => api.action('invite', me),
  };
};

/** Whether the signed-in user may send state of `eventType` in `room`. */
export const canSendState = (client: MatrixClient, room: Room, eventType: string): boolean =>
  getMyRoomPermissions(client, room).stateEvent(eventType);

/** Servers that can route to `room`; the user's own server when the room names none. */
const viaFor = (client: MatrixClient, room: Room | null | undefined): string[] => {
  const servers = room ? getViaServers(room) : [];
  if (servers.length > 0) return servers;
  const own = client.getDomain();
  return own ? [own] : [];
};

/**
 * Adds `childId` to `space`. Where the user may, the child also names the space as a parent,
 * so other clients find the space from the room.
 */
export const addSpaceChild = async (
  client: MatrixClient,
  space: Room,
  childId: string
): Promise<void> => {
  const child = client.getRoom(childId);
  await sendState(client)(
    space.roomId,
    StateEvent.SpaceChild,
    { via: viaFor(client, child), suggested: false },
    childId
  );
  if (
    child &&
    child.getMyMembership() === 'join' &&
    canSendState(client, child, StateEvent.SpaceParent)
  ) {
    await sendState(client)(
      childId,
      StateEvent.SpaceParent,
      { via: viaFor(client, space) },
      space.roomId
    ).catch(() => undefined);
  }
};

/**
 * Takes `childId` out of `space` (an empty `m.space.child`, as the spec says), and drops the
 * child's link back to the space where the user may.
 */
export const removeSpaceChild = async (
  client: MatrixClient,
  spaceId: string,
  childId: string
): Promise<void> => {
  await sendState(client)(spaceId, StateEvent.SpaceChild, {}, childId);
  const child = client.getRoom(childId);
  const backLink = child && liveState(child)?.getStateEvents(StateEvent.SpaceParent, spaceId);
  if (
    child &&
    backLink &&
    Object.keys(backLink.getContent()).length > 0 &&
    canSendState(client, child, StateEvent.SpaceParent)
  ) {
    await sendState(client)(childId, StateEvent.SpaceParent, {}, spaceId).catch(() => undefined);
  }
};

/** Marks a child of `space` as suggested (or not), keeping the rest of its link. */
export const setSpaceChildSuggested = async (
  client: MatrixClient,
  space: Room,
  childId: string,
  suggested: boolean
): Promise<void> => {
  const current = liveState(space)?.getStateEvents(StateEvent.SpaceChild, childId)?.getContent();
  if (!current || !Array.isArray(current.via) || current.via.length === 0) return;
  await sendState(client)(space.roomId, StateEvent.SpaceChild, { ...current, suggested }, childId);
};
