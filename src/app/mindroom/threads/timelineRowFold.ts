import type { MatrixEvent } from 'matrix-js-sdk';
import { reactionOrEditEvent } from '../../utils/room';
import { inSameDay, minuteDifference } from '../../utils/time';
import { shouldRenderUnreadDividerAt } from './timelineScrollUtils';
import { primeTimelineRenderContextBefore } from './threadRenderUtils';

/** How one mounted row relates to the rows before it. */
export type TimelineRowContext = {
  /** Shown under the row above it without its own author line. */
  collapse: boolean;
  /** The row above, which a reply quote compares its target with. */
  previousEventId?: string;
  /** The day changed since the last row with output: a date divider goes above this row. */
  dayDivider: boolean;
  /** The first row after the reader's read marker. */
  unreadDivider: boolean;
};

/** Messages from one sender within this many minutes share one author line. */
const GROUP_MINUTES = 2;

/**
 * Event types that are parts of one turn: an agent's reply, the tool approval card it sends
 * between the reply's parts, and the summary notice after it all sit under one author line.
 * Other events group only with events of their own type.
 */
const TURN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'm.room.message',
  'm.room.encrypted',
  'm.sticker',
  'io.mindroom.tool_approval',
]);

const groupKind = (event: MatrixEvent): string => {
  const type = event.getType();
  return TURN_EVENT_TYPES.has(type) ? 'turn' : type;
};

/** Edits, reactions and redactions change other rows and have no row of their own. */
export const isRowlessTimelineEvent = (event: MatrixEvent): boolean =>
  reactionOrEditEvent(event) || !!event.isRedaction?.();

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
 * row above it and whether a date or unread divider goes above it. A window that starts after
 * the first row is primed from the rows before it, so a row looks the same whether or not the
 * rows above it are mounted. An edit or reaction counts as the row above (it ends a group) but
 * renders nothing, so a day change at it shows above the next message instead.
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
  // The row before the window's first one may be outside the window (index -1): without it, a
  // read marker above the window would put the unread divider over the window's first row.
  let lastRowAbsoluteIndex = getAbsoluteIndex?.(firstIndex - 1);

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
        previousEventId: above?.getId(),
        dayDivider: hasRow && dayChanged,
        unreadDivider,
      });
      if (hasRow) {
        dayChanged = false;
        lastRowAbsoluteIndex = absoluteIndex;
      }
      above = event;
      aboveHasRow = hasRow;
    }
  }
  return contexts;
};
