import { EventTimeline, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { getRoomCreators } from '../../hooks/useRoomCreators';
import type { UsernameTone } from '../../components/message/layout/layout';

/** Power level from which a member leads the room, and from which one moderates it. */
const LEAD_LEVEL = 100;
const MODERATOR_LEVEL = 50;

const readState = (room: Room, type: string): MatrixEvent | undefined =>
  room.getLiveTimeline?.()?.getState?.(EventTimeline.FORWARDS)?.getStateEvents?.(type, '') ??
  undefined;

/** The sender's power level, from the member list or else the room's power levels event. */
const getPowerLevel = (room: Room, userId: string): number => {
  const memberLevel = room.getMember?.(userId)?.powerLevel;
  if (typeof memberLevel === 'number') return memberLevel;
  const content = readState(room, 'm.room.power_levels')?.getContent<{
    users?: Record<string, unknown>;
    users_default?: unknown;
  }>();
  const level = content?.users?.[userId] ?? content?.users_default;
  return typeof level === 'number' ? level : 0;
};

/**
 * How a message sender stands in the room, for the colour of their name: the room's creators
 * (privileged from room version 12 on) and members at administrator level lead it, then come
 * moderators, then everyone else.
 */
export const getSenderNameTone = (room: Room, userId: string): UsernameTone => {
  const createEvent = readState(room, 'm.room.create');
  if (createEvent && getRoomCreators(createEvent).has(userId)) return 'lead';
  const level = getPowerLevel(room, userId);
  if (level >= LEAD_LEVEL) return 'lead';
  if (level >= MODERATOR_LEVEL) return 'moderator';
  return 'member';
};
