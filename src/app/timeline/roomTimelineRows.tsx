import {
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type Dispatch,
  type Key,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { EventTimelineSet, MatrixEvent } from 'matrix-js-sdk';
import type { VirtualItem } from '@tanstack/react-virtual';
import { Text, color, config } from 'folds';
import { reactionOrEditEvent } from '../matrix/room';
import { today, timeDayMonthYear, yesterday } from '../lib/time';
import { VirtualTile } from '../ui/VirtualTile';
import { MessageRowBoundary } from '../messages/content/MessageRowBoundary';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';
import { hasThreadReplies } from './message-rendering/useTimelineMessageFeature';
import type { ThreadRecord } from '../event-store/threads/types';
import {
  getRenderableEventEntries,
  type TimelineEventEntry,
} from '../event-store/timeline/roomTimelineEvents';
import {
  buildClassicRoomRowEntries,
  placeClassicWindow,
  type ClassicWindow,
} from './roomTimelineClassicRows';
import { getShownHistoryReplies } from '../event-store/timeline/classicHistoryReplies';
import type { RoomTimelineFocusItem } from './roomFocusScrollController';
import type { RecalibrateFilterOpts, Timeline } from '../event-store/timeline/timelinePagination';
import { estimateMessageRowHeight, estimateRoomRowHeight } from './timelineRowEstimate';
import { replyNeedingNoQuote } from './pluginHiddenRows';
import { foldTimelineRowContexts, isRowlessTimelineEvent } from './timelineRowFold';

/**
 * The rows of the room timeline: which events the room shows, what each row is priced at until it
 * is measured, and the tiles the virtual list mounts, with their date and unread dividers.
 */

const EMPTY_ENTRIES: TimelineEventEntry[] = [];

/**
 * The room's rows: the room timeline's own, plus in the classic view the thread replies, those its
 * threads hold and those its history pages brought, from the start of the history it holds on
 * (`placeClassicWindow` places its window). A thread shows none of them.
 */
export const useRoomRowEntries = ({
  room,
  threadId,
  timeline,
  setTimeline,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
  showThreadRepliesInRoom,
}: Omit<RecalibrateFilterOpts, 'showThreadRepliesInRoom'> & {
  timeline: Timeline;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  showThreadRepliesInRoom: boolean;
}) => {
  const { roomEntryCount, renderableEventEntries } = useMemo(() => {
    if (threadId) return { roomEntryCount: 0, renderableEventEntries: EMPTY_ENTRIES };
    const entries = getRenderableEventEntries(
      timeline.linkedTimelines,
      room,
      undefined,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      showThreadRepliesInRoom
    );
    if (!showThreadRepliesInRoom) {
      return { roomEntryCount: entries.length, renderableEventEntries: entries };
    }
    const filters = {
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
    };
    const historyReplies = getShownHistoryReplies(room, timeline.linkedTimelines, filters);
    const historyStart = timeline.linkedTimelines
      .find((part) => part.getEvents().length > 0)
      ?.getEvents()[0];
    return {
      roomEntryCount: entries.length,
      renderableEventEntries: buildClassicRoomRowEntries(
        room,
        entries,
        historyReplies,
        filters,
        historyStart
      ),
    };
  }, [
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    room,
    showHiddenEvents,
    showThreadRepliesInRoom,
    threadId,
    timeline,
  ]);
  const classicWindowRef = useRef<ClassicWindow>();
  const classic = showThreadRepliesInRoom && !threadId;
  const previousWindow = classic ? classicWindowRef.current : undefined;
  const windowTimeline = useMemo(() => {
    const range = placeClassicWindow(
      previousWindow,
      timeline,
      renderableEventEntries,
      roomEntryCount
    );
    return range === timeline.range ? timeline : { ...timeline, range };
  }, [previousWindow, renderableEventEntries, roomEntryCount, timeline]);
  useLayoutEffect(() => {
    const { range } = windowTimeline;
    classicWindowRef.current = classic
      ? {
          source: timeline.range,
          chain: timeline.linkedTimelines,
          range,
          firstRowId: renderableEventEntries[range.start]?.event.getId(),
        }
      : undefined;
    // The state follows a window that kept its first row, so pages from it start where it is.
    if (classic && range !== timeline.range) {
      const shown = timeline.range;
      setTimeline((current) => (current.range === shown ? { ...current, range } : current));
    }
  }, [
    classic,
    renderableEventEntries,
    setTimeline,
    timeline.linkedTimelines,
    timeline.range,
    windowTimeline,
  ]);
  const renderableEvents = useMemo(
    () => renderableEventEntries.map(({ event }) => event),
    [renderableEventEntries]
  );
  return { renderableEventEntries, renderableEvents, windowTimeline };
};

/**
 * Rows are priced by their content until measured (timelineRowEstimate). The Compact layout
 * prices room rows at one height, and a row the window does not know takes the comfortable one.
 */
const ROOM_ROW_ESTIMATE_PX = { compact: 96, comfortable: 68 } as const;
/**
 * Added to content-based room estimates, which are whole pixels and often exact. virtual-core
 * records a measured size only when it differs from the estimate, and the automatic fill reveals
 * the rows only once every mounted row is recorded; a row of zero estimated height would not
 * even mount to be measured.
 */
const ROOM_ROW_UNMEASURED_PX = 0.5;
const THREAD_ONE_LINE_ESTIMATE_PX = { compact: 26, comfortable: 30 } as const;

/**
 * The virtual list's row sizes and keys for this render. Room indexes count from the window's
 * first row; a fold prices rows above it (negative). The estimate reads the newest rows and window
 * through refs: the paginator folds a widened window in its layout effect, before the ledger hands
 * over this render's pricing, and a fold priced apart from the rows the virtual list then lays out
 * moves the reader.
 */
export const timelineRowSizing = ({
  threadId,
  compactLayout,
  showThreadRepliesInRoom,
  threadEvents,
  roomWindowRows,
  windowStart,
  roomRowsRef,
  activeRangeRef,
  threadRecordMapRef,
}: {
  threadId: string | undefined;
  compactLayout: boolean;
  showThreadRepliesInRoom: boolean;
  threadEvents: MatrixEvent[];
  roomWindowRows: MatrixEvent[];
  windowStart: number;
  roomRowsRef: MutableRefObject<MatrixEvent[]>;
  activeRangeRef: MutableRefObject<Timeline['range']>;
  threadRecordMapRef: MutableRefObject<ReadonlyMap<string, ThreadRecord>>;
}) => {
  const estimateSize = (index?: number): number => {
    if (!threadId) {
      if (compactLayout) return ROOM_ROW_ESTIMATE_PX.compact;
      const rows = roomRowsRef.current;
      const position = index === undefined ? undefined : activeRangeRef.current.start + index;
      const event = position === undefined ? undefined : rows[position];
      if (!event || position === undefined) {
        return ROOM_ROW_ESTIMATE_PX.comfortable + ROOM_ROW_UNMEASURED_PX;
      }
      // The threaded view shows a badge under each message that starts a thread with replies.
      const threadBadge =
        !showThreadRepliesInRoom &&
        hasThreadReplies(threadRecordMapRef.current.get(event.getId() ?? ''));
      return (
        estimateRoomRowHeight(event, rows[position - 1], { threadBadge }) + ROOM_ROW_UNMEASURED_PX
      );
    }
    const event = index === undefined ? undefined : threadEvents[index];
    if (!event) {
      return compactLayout
        ? THREAD_ONE_LINE_ESTIMATE_PX.compact
        : THREAD_ONE_LINE_ESTIMATE_PX.comfortable;
    }
    return estimateMessageRowHeight(event, { compact: compactLayout });
  };
  const getItemKey = (index: number): string | number => {
    const event = threadId ? threadEvents[index] : roomWindowRows[index];
    return event?.getId() ?? (threadId ? index : windowStart + index);
  };
  return { estimateSize, getItemKey };
};

const dividerStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  columnGap: config.space.S200,
  padding: `${config.space.S200} ${config.space.S400}`,
};

/** A date or unread separator: a label between two hairlines. */
function DividerLabel({
  label,
  unread = false,
  separatorRef,
}: {
  label: string;
  unread?: boolean;
  separatorRef?: Ref<HTMLDivElement>;
}) {
  const lineColor = unread ? color.Success.ContainerLine : color.SurfaceVariant.ContainerLine;
  const rule = <span style={{ height: 1, background: lineColor }} />;
  const labelColor = unread ? color.Success.Main : color.SurfaceVariant.OnContainer;
  return (
    <div ref={separatorRef} role="separator" style={{ ...dividerStyle, color: labelColor }}>
      {rule}
      <Text size="L400">{label}</Text>
      {rule}
    </div>
  );
}

function DayDivider({ ts }: { ts: number }) {
  const { t } = useTranslation();
  let label = timeDayMonthYear(ts);
  if (today(ts)) label = t('mindroomUi.threads.mindroomRoomTimeline.today');
  else if (yesterday(ts)) label = t('mindroomUi.threads.mindroomRoomTimeline.yesterday');
  return <DividerLabel label={label} />;
}

/** The "New messages" line above the first row the reader has not read. */
function UnreadDivider({ separatorRef }: { separatorRef: Ref<HTMLDivElement> }) {
  const { t } = useTranslation();
  return (
    <DividerLabel
      unread
      separatorRef={separatorRef}
      label={t('mindroomUi.threads.mindroomRoomTimeline.newMessages')}
    />
  );
}

/**
 * The tiles of the rows the virtual list mounts. A row groups with the one above it and gets its
 * date and unread dividers from the fold over the mounted window (timelineRowFold); rows the
 * thread's plans hide, replies a plugin hides, ignored senders and redactions take no place in
 * that walk.
 */
export const renderTimelineTiles = ({
  virtualItems,
  threadId,
  threadEvents,
  roomWindowRows,
  roomRowEntries,
  windowStart,
  readUptoAbsoluteIndex,
  ignoredUsersSet,
  showHiddenEvents,
  timelineSet,
  focusItem,
  messageData,
  isHiddenByPlugin,
  isHiddenByPluginId,
  renderEvent,
  unreadMarkerRef,
  measureElement,
  ledgerPxAtRender,
}: {
  virtualItems: VirtualItem[];
  threadId: string | undefined;
  threadEvents: MatrixEvent[];
  roomWindowRows: MatrixEvent[];
  roomRowEntries: TimelineEventEntry[];
  windowStart: number;
  readUptoAbsoluteIndex: number | undefined;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  timelineSet: EventTimelineSet;
  focusItem: RoomTimelineFocusItem | undefined;
  messageData: TimelineMessageData;
  /** Whether a plugin's message renderer leaves the event without a row (pluginHiddenRows). */
  isHiddenByPlugin: (event: MatrixEvent) => boolean;
  /** The same, of a loaded event by its ID: no row quotes such a message. */
  isHiddenByPluginId: (eventId: string) => boolean;
  renderEvent: (row: TimelineMessageRow, data: TimelineMessageData) => ReactNode | null;
  /** Receives the "New messages" line, so the timeline knows when it is in view. */
  unreadMarkerRef: Ref<HTMLDivElement>;
  measureElement: (node: Element | null) => void;
  ledgerPxAtRender: number;
}): ReactNode[] => {
  const { approvalTimeline, threadSummaryTimeline } = messageData;
  const getRowEvent = (index: number): MatrixEvent | undefined =>
    threadId ? threadEvents[index] : roomWindowRows[index];
  const isRowHidden = (event: MatrixEvent): boolean => {
    const id = event.getId() ?? '';
    if (approvalTimeline.hiddenEventIds.has(id) || threadSummaryTimeline.hiddenEventIds.has(id)) {
      return true;
    }
    const sender = event.getSender();
    if (sender && ignoredUsersSet.has(sender)) return true;
    if (event.isRedacted()) return !showHiddenEvents;
    return isHiddenByPlugin(event);
  };
  const rowContexts = foldTimelineRowContexts({
    indexes: virtualItems.map((item) => item.index),
    getEvent: getRowEvent,
    isSkipped: isRowHidden,
    getAbsoluteIndex: threadId
      ? undefined
      : (index) => roomRowEntries[windowStart + index]?.absoluteIndex,
    readUptoAbsoluteIndex: threadId ? undefined : readUptoAbsoluteIndex,
  });

  const renderTile = (item: VirtualItem): ReactNode => {
    const event = getRowEvent(item.index);
    if (!event) return null;
    // An edit or a reaction has no row of its own. A height measured before it decrypted keeps
    // its tile mounted until measuring corrects it.
    if (item.size === 0 && reactionOrEditEvent(event)) return null;
    const id = event.getId() ?? '';
    const context = rowContexts.get(item.index);
    let content: ReactNode = null;
    if (context && !isRowlessTimelineEvent(event)) {
      const row: TimelineMessageRow = {
        eventId: id,
        event,
        index: item.index,
        timelineSet,
        collapse: context.collapse,
        highlighted: focusItem?.eventId === id && focusItem.highlight,
        previousEventId: replyNeedingNoQuote(
          event,
          context.inPlaceReplyEventId,
          isHiddenByPluginId
        ),
      };
      // A row that fails to render shows as broken; the rows around it stay.
      content = (
        <MessageRowBoundary
          render={() => {
            const rendered = renderEvent(row, messageData);
            if (rendered === null) return null;
            return (
              <>
                {context.unreadDivider && <UnreadDivider separatorRef={unreadMarkerRef} />}
                {context.dayDivider && <DayDivider ts={event.getTs()} />}
                {rendered}
              </>
            );
          }}
        />
      );
    }
    return (
      <VirtualTile
        key={item.key as Key}
        ref={measureElement}
        virtualItem={item}
        style={{ top: item.start + ledgerPxAtRender }}
      >
        <div data-room-row-index={threadId ? undefined : item.index}>{content}</div>
      </VirtualTile>
    );
  };
  return virtualItems.map(renderTile);
};
