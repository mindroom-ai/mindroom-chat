import { MINDROOM_TOOL_APPROVAL_EVENT } from '../messages/toolApproval';
import type { TimelineMessageKind } from './message-rendering/types';

/**
 * Which events get a row in the timeline, and how big media rows get. The renderer, the row
 * grouping and the height estimates all read these, so what is estimated is what renders.
 */

/** State events the timeline shows as a one-line notice; other state events get no row. */
export const NOTICE_STATE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'm.room.member',
  'm.room.name',
  'm.room.topic',
  'm.room.avatar',
]);

const MESSAGE_KINDS: ReadonlyMap<string, TimelineMessageKind> = new Map([
  ['m.room.message', 'message'],
  [MINDROOM_TOOL_APPROVAL_EVENT, 'approval'],
  ['m.sticker', 'sticker'],
  ['m.room.encrypted', 'encrypted'],
]);

/** How the timeline draws a message event, or undefined for a type it shows no message row for. */
export const getTimelineMessageKind = (eventType: string): TimelineMessageKind | undefined =>
  MESSAGE_KINDS.get(eventType);

/** Text message types; their body is only as wide as their text. */
export const TEXT_MSGTYPES: ReadonlySet<string> = new Set(['m.text', 'm.notice', 'm.emote']);

/** Pictures and videos show in a box of at most this size. */
export const MEDIA_MAX_SIZE = { width: 400, height: 300 } as const;
