import { RelationType, type MatrixEvent } from 'matrix-js-sdk';
import { reactionOrEditEvent } from '../matrix/room';
import { inSameDay, minuteDifference } from '../lib/time';
import { shouldRenderUnreadDividerAt } from '../event-store/timeline/timelineScrollUtils';
import { primeTimelineRenderContextBefore } from '../event-store/threads/threadRenderUtils';
import { getTimelineMessageKind } from '../event-store/timeline/timelineRowTypes';

/** How one mounted row relates to the rows before it. */
type TimelineRowContext = {
  /** Shown under the row above it without its own author line. */
  collapse: boolean;
  /**
   * A reply to this event needs no quote on this row, because it shows right above: the row
   * above, or the message that every row between it and this one replies to (see `ReplyRun`).
   */
  inPlaceReplyEventId?: string;
  /** The day changed since the last row with output: a date divider goes above this row. */
  dayDivider: boolean;
  /** The first row after the reader's read marker. */
  unreadDivider: boolean;
};

/** Messages from one sender within this many minutes share one author line. */
const GROUP_MINUTES = 2;

/**
 * Message rows are parts of one turn: an agent's reply, the tool approval card it sends between
 * the reply's parts, and the summary notice after it all sit under one author line. Other events
 * group only with events of their own type.
 */
const groupKind = (event: MatrixEvent): string => {
  const type = event.getType();
  return getTimelineMessageKind(type) ? 'turn' : type;
};

/** Edits, reactions and redactions change other rows and have no row of their own. */
export const isRowlessTimelineEvent = (event: MatrixEvent): boolean =>
  reactionOrEditEvent(event) || !!event.isRedaction?.();

/**
 * The event `event` replies to, if it is a genuine reply. A thread message with an MSC3440
 * fallback (`is_falling_back: true`) names the thread's latest event only for clients without
 * threads, so it replies to nothing.
 */
export const genuineReplyEventId = (event: MatrixEvent): string | undefined => {
  const replyEventId = event.replyEventId;
  if (!replyEventId) return undefined;
  const relation = event.getWireContent?.()?.['m.relates_to'] as
    | { rel_type?: string; is_falling_back?: boolean }
    | undefined;
  if (relation?.rel_type === RelationType.Thread && relation.is_falling_back) return undefined;
  return replyEventId;
};

/** Whether `event` continues the group of the row above it: same sender, kind, day, and soon after. */
const continuesGroup = (above: MatrixEvent, event: MatrixEvent): boolean =>
  inSameDay(above.getTs(), event.getTs()) &&
  above.getSender() === event.getSender() &&
  groupKind(above) === groupKind(event) &&
  minuteDifference(above.getTs(), event.getTs()) < GROUP_MINUTES;

/**
 * Whether a message right after `above` shows its own author line. An edit or reaction above
 * ends the group, as it does in the fold below.
 */
export const startsAuthorGroup = (above: MatrixEvent | undefined, event: MatrixEvent): boolean =>
  !above || isRowlessTimelineEvent(above) || !continuesGroup(above, event);

/**
 * The reply quote state after a row. `targetId` is set while the rows down to `rowId` all reply
 * to it, starting right below it: a message, the router's transcript of it, and the agent's
 * answer to it, or two agents answering one question. A reply to `targetId` from the next row
 * continues that run, so its quote would repeat the message right above the run.
 */
type ReplyRun = { rowId?: string; targetId?: string };

/** The message a reply on `event` needs no quote for, given the run of rows above it. */
const inPlaceReplyEventId = (run: ReplyRun, event: MatrixEvent): string | undefined => {
  const replyId = genuineReplyEventId(event);
  return replyId !== undefined && replyId === run.targetId ? replyId : run.rowId;
};

const continueReplyRun = (run: ReplyRun, event: MatrixEvent): ReplyRun => {
  const replyId = genuineReplyEventId(event);
  const continues = replyId !== undefined && (replyId === run.targetId || replyId === run.rowId);
  return { rowId: event.getId(), targetId: continues ? replyId : undefined };
};

/**
 * The reply run above `index`, read backwards: the nearest row, and the message it and the rows
 * above it all reply to, if that message sits right above them. Matches folding from the top.
 */
const primeReplyRun = (
  getEvent: (index: number) => MatrixEvent | undefined,
  index: number,
  isSkipped: (event: MatrixEvent) => boolean
): ReplyRun => {
  let rowId: string | undefined;
  let targetId: string | undefined;
  for (let above = index - 1; above >= 0; above -= 1) {
    const event = getEvent(above);
    if (event?.getId() && !isSkipped(event) && !isRowlessTimelineEvent(event)) {
      if (rowId === undefined) {
        rowId = event.getId();
        targetId = genuineReplyEventId(event);
        if (targetId === undefined) break;
      } else if (event.getId() === targetId) {
        return { rowId, targetId };
      } else if (genuineReplyEventId(event) !== targetId) {
        break;
      }
    }
  }
  return { rowId };
};

type FoldOptions = {
  /** The virtual indexes that render, ascending. */
  indexes: readonly number[];
  getEvent: (index: number) => MatrixEvent | undefined;
  /** Events that render nothing and do not count as the row above the next one. */
  isSkipped: (event: MatrixEvent) => boolean;
  /** Position of a row's event in the loaded timeline, for the unread divider. */
  getAbsoluteIndex?: (index: number) => number | undefined;
  readUptoAbsoluteIndex?: number;
};

/**
 * Walks the rows of a virtual window in order and decides, for each, whether it groups with the
 * row above it, whether a date or unread divider goes above it, and which reply needs no quote
 * there. A window that starts after the first row is primed from the rows before it, so a row
 * looks the same whether or not the rows above it are mounted. An edit or reaction counts as the
 * row above (it ends a group) but renders nothing, so a day change at it shows above the next
 * message instead, and a reply quote looks past it.
 */
export const foldTimelineRowContexts = ({
  indexes,
  getEvent,
  isSkipped,
  getAbsoluteIndex,
  readUptoAbsoluteIndex,
}: FoldOptions): Map<number, TimelineRowContext> => {
  const contexts = new Map<number, TimelineRowContext>();
  const firstIndex = indexes[0];
  const lastIndex = indexes.at(-1);
  if (firstIndex === undefined || lastIndex === undefined) return contexts;
  const primed = primeTimelineRenderContextBefore(getEvent, firstIndex, isSkipped);
  let above: MatrixEvent | undefined = primed?.prevEvent;
  let aboveHasRow = primed?.isPrevRendered ?? false;
  let dayChanged = primed?.pendingDayDivider ?? false;
  // The last row with output before the window, past the events it skips, as the walk below
  // keeps it; that row may be outside the window (index -1): without it, a read marker above the
  // window would put the unread divider over the window's first row.
  let before = firstIndex - 1;
  for (; before >= 0; before -= 1) {
    const event = getEvent(before);
    if (!event?.getId() || (!isSkipped(event) && !isRowlessTimelineEvent(event))) break;
  }
  let lastRowAbsoluteIndex = getAbsoluteIndex?.(before);
  let replyRun = primeReplyRun(getEvent, firstIndex, isSkipped);

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const event = getEvent(index);
    if (event?.getId() && !isSkipped(event)) {
      if (above && !inSameDay(above.getTs(), event.getTs())) dayChanged = true;
      const hasRow = !isRowlessTimelineEvent(event);
      const absoluteIndex = getAbsoluteIndex?.(index);
      const groupsWithAbove =
        hasRow && aboveHasRow && !dayChanged && !!above && continuesGroup(above, event);
      const unreadDivider =
        hasRow &&
        shouldRenderUnreadDividerAt({
          readUptoAbsoluteIndex,
          eventAbsoluteIndex: absoluteIndex,
          prevRenderedEventAbsoluteIndex: lastRowAbsoluteIndex,
        });
      contexts.set(index, {
        collapse: groupsWithAbove && !unreadDivider,
        inPlaceReplyEventId: hasRow ? inPlaceReplyEventId(replyRun, event) : undefined,
        dayDivider: hasRow && dayChanged,
        unreadDivider,
      });
      if (hasRow) {
        dayChanged = false;
        lastRowAbsoluteIndex = absoluteIndex;
        replyRun = continueReplyRun(replyRun, event);
      }
      above = event;
      aboveHasRow = hasRow;
    }
  }
  return contexts;
};
