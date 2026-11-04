import { EventTimeline, KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { withLevel } from '../room-settings/permissions/permissionLevels';

/** The state event a device publishes to be in the room's call (MatrixRTC, MSC4143). */
const CALL_MEMBER = StateEvent.GroupCallMemberPrefix as string;

/** Who may take part in a room's calls, as its power levels say. */
export type CallAccess = {
  /** This account may publish its call membership, so start or join the call. */
  canJoin: boolean;
  /** Joined members whose level is under the call membership level. */
  blocked: string[];
  /** This account may lower the call membership level to the level members get. */
  canAllow: boolean;
};

export const readCallAccess = (room: Room, myUserId: string): CallAccess => {
  const state = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
  if (!state) return { canJoin: false, blocked: [], canAllow: false };
  const canJoin = state.maySendStateEvent(CALL_MEMBER, myUserId);
  const blocked = room
    .getMembers()
    .filter((member) => member.membership === KnownMembership.Join)
    .map((member) => member.userId)
    .filter((userId) => !state.maySendStateEvent(CALL_MEMBER, userId));
  // Changing a level needs power over the levels and at least the level being changed.
  const canAllow =
    canJoin && state.maySendStateEvent(StateEvent.RoomPowerLevels as string, myUserId);
  return { canJoin, blocked, canAllow };
};

/** Sets the call membership level to the level a new member gets, keeping every other level. */
export const allowMembersToCall = (mx: MatrixClient, room: Room) => {
  const content =
    room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(StateEvent.RoomPowerLevels, '')
      ?.getContent() ?? {};
  const membersLevel = typeof content.users_default === 'number' ? content.users_default : 0;
  return mx.sendStateEvent(
    room.roomId,
    StateEvent.RoomPowerLevels as never,
    withLevel(content, { kind: 'state', type: CALL_MEMBER }, membersLevel) as never,
    ''
  );
};
