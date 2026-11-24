import {
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type Dispatch,
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
import { isRowlessTimelineEvent } from '../event-store/timeline/timelineRowTypes';
import { foldTimelineRowContexts } from './timelineRowFold';
import type { ThreadTurnFold, ThreadTurnFoldView } from './threadTurnFolds';
import { TurnBreak } from './TurnBreak';
import {
  heldFoldHeight,
  type RenderedRoomRows,
  type MembershipFold,
  type MembershipFoldView,
} from './membershipFolds';
import { MembershipBreak } from './MembershipBreak';

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
  const classicWindowRef = useRef<ClassicWindow>(undefined);
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
/** A turn's break (`TurnBreak`): its pill and the padding around it. */
const TURN_BREAK_ESTIMATE_PX = 42;

/**
 * The virtual list's row sizes and keys for this render. Room indexes count from the window's
 * first row; a fold prices rows above it (negative). The estimate reads the newest rows and window
 * through refs: the paginator folds a widened window in its layout effect, before the ledger hands
 * over this render's pricing, and a fold priced apart from the rows the virtual list then lays out
 * moves the reader.
 */
export const THREAD_LOAD_OLDER_KEY = '__thread_load_older__';
const THREAD_LOAD_OLDER_ESTIMATE_PX = 40;
export const ROOM_INTRO_KEY = '__room_intro__';
// Non-integer so virtual-core records the first DOM measurement even when RoomIntro is 160 px.
export const ROOM_INTRO_ESTIMATE_PX = 160 + ROOM_ROW_UNMEASURED_PX;

export const timelineRowSizing = ({
  threadId,
  compactLayout,
  showThreadRepliesInRoom,
  threadEvents,
  hasThreadLoadOlder = false,
  hasRoomIntro = false,
  roomWindowRows,
  windowStart,
  roomRowsRef,
  activeRangeRef,
  threadRecordMapRef,
  turnFolds,
  hiddenIds,
  membershipFoldsRef,
  renderedRoomRowsRef,
}: {
  threadId: string | undefined;
  compactLayout: boolean;
  showThreadRepliesInRoom: boolean;
  threadEvents: MatrixEvent[];
  /** Whether index 0 of the thread virtualizer is the Load Older chip. */
  hasThreadLoadOlder?: boolean;
  /** Whether index 0 of the room virtualizer is the room start intro. */
  hasRoomIntro?: boolean;
  roomWindowRows: MatrixEvent[];
  windowStart: number;
  roomRowsRef: MutableRefObject<MatrixEvent[]>;
  activeRangeRef: MutableRefObject<Timeline['range']>;
  threadRecordMapRef: MutableRefObject<ReadonlyMap<string, ThreadRecord>>;
  /** The open thread's folded turns: a break adds its height to its row, which it alone fills. */
  turnFolds?: ThreadTurnFoldView;
  /** The open thread's rows that show nothing: priced as nothing, like the size they then get. */
  hiddenIds?: ReadonlySet<string>;
  /**
   * The room's folded membership runs, as a closed fold's row is its break alone and an open
   * fold's first row holds its break too. Read through refs, as the rows are.
   */
  membershipFoldsRef?: MutableRefObject<MembershipFoldView>;
  /** The room's list as it last rendered (`useMembershipFoldRowSizes`). */
  renderedRoomRowsRef?: MutableRefObject<RenderedRoomRows>;
}) => {
  const threadLeadingOffset = threadId && hasThreadLoadOlder ? 1 : 0;
  const roomLeadingOffset = !threadId && hasRoomIntro ? 1 : 0;
  const estimateSize = (index?: number): number => {
    if (!threadId) {
      if (roomLeadingOffset && index === 0) return ROOM_INTRO_ESTIMATE_PX;
      const rows = roomRowsRef.current;
      // Negative indexes come from room-fold pricing above the current window; non-negative
      // virtual indexes follow the leading room intro item when present.
      const rowIndex =
        index === undefined ? undefined : index < 0 ? index : index - roomLeadingOffset;
      const position = rowIndex === undefined ? undefined : activeRangeRef.current.start + rowIndex;
      const event = position === undefined ? undefined : rows[position];
      const membershipFold = event && membershipFoldsRef?.current.breaks.get(event.getId() ?? '');
      if (membershipFold?.open === false) {
        // A fold that closed over rows of the last render takes their place at their height.
        const heldPx = renderedRoomRowsRef
          ? heldFoldHeight(renderedRoomRowsRef.current.sizes, membershipFold.fold)
          : 0;
        return heldPx > 0 ? heldPx : TURN_BREAK_ESTIMATE_PX + ROOM_ROW_UNMEASURED_PX;
      }
      const breakPx = membershipFold ? TURN_BREAK_ESTIMATE_PX : 0;
      if (compactLayout) return ROOM_ROW_ESTIMATE_PX.compact + breakPx;
      if (!event || position === undefined) {
        return ROOM_ROW_ESTIMATE_PX.comfortable + ROOM_ROW_UNMEASURED_PX;
      }
      // The threaded view shows a badge under each message that starts a thread with replies.
      const threadBadge =
        !showThreadRepliesInRoom &&
        hasThreadReplies(threadRecordMapRef.current.get(event.getId() ?? ''));
      return (
        estimateRoomRowHeight(event, rows[position - 1], { threadBadge }) +
        ROOM_ROW_UNMEASURED_PX +
        breakPx
      );
    }
    if (threadLeadingOffset && index === 0) return THREAD_LOAD_OLDER_ESTIMATE_PX;
    const event = index === undefined ? undefined : threadEvents[index - threadLeadingOffset];
    if (!event) {
      return compactLayout
        ? THREAD_ONE_LINE_ESTIMATE_PX.compact
        : THREAD_ONE_LINE_ESTIMATE_PX.comfortable;
    }
    const id = event.getId() ?? '';
    if (hiddenIds?.has(id)) return 0;
    const open = turnFolds?.breaks.get(id)?.open;
    if (open === false) return TURN_BREAK_ESTIMATE_PX;
    const row = estimateMessageRowHeight(event, { compact: compactLayout });
    return open ? row + TURN_BREAK_ESTIMATE_PX : row;
  };
  const getItemKey = (index: number): string | number => {
    if (threadLeadingOffset && index === 0) return THREAD_LOAD_OLDER_KEY;
    if (roomLeadingOffset && index === 0) return ROOM_INTRO_KEY;
    const event = threadId
      ? threadEvents[index - threadLeadingOffset]
      : roomWindowRows[index - roomLeadingOffset];
    return (
      event?.getId() ??
      (threadId ? index - threadLeadingOffset : windowStart + index - roomLeadingOffset)
    );
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
 * Whether the approval, voice echo, reply card or model change plan or a plugin hides the row,
 * its sender is ignored, or it is redacted and hidden events are not shown. Callers handle
 * hiding by the title, secret request and turn fold plans.
 */
export const isTimelineRowHidden = (
  event: MatrixEvent,
  {
    messageData: { approvalTimeline, voiceTranscripts, replyCards, modelChanges },
    ignoredUsersSet,
    showHiddenEvents,
    isHiddenByPlugin,
  }: {
    messageData: Pick<
      TimelineMessageData,
      'approvalTimeline' | 'voiceTranscripts' | 'modelChanges' | 'replyCards'
    >;
    ignoredUsersSet: ReadonlySet<string>;
    showHiddenEvents: boolean;
    isHiddenByPlugin: (event: MatrixEvent) => boolean;
  }
): boolean => {
  const id = event.getId() ?? '';
  if (
    approvalTimeline.hiddenEventIds.has(id) ||
    voiceTranscripts.hiddenEventIds.has(id) ||
    modelChanges.hiddenEventIds.has(id) ||
    !!replyCards?.hiddenEventIds.has(id)
  ) {
    return true;
  }
  const sender = event.getSender();
  if (sender && ignoredUsersSet.has(sender)) return true;
  if (event.isRedacted()) return !showHiddenEvents;
  return isHiddenByPlugin(event);
};

/**
 * The tiles of the rows the virtual list mounts. A row groups with the one above it and gets its
 * date and unread dividers from the fold over the mounted window (timelineRowFold); rows the
 * thread's plans hide, replies a plugin hides, ignored senders and redactions take no place in
 * that walk. A fork's divider goes above the row it names, before that row's own dividers; a fork
 * draft's divider goes under the row it names. A thread's folded turn hides its middle rows, and
 * the first of them draws the turn's break, open or not, above its own dividers. A closed fold of
 * the room's membership events is one row (`RoomRowProjection`), which draws its break under the
 * unread divider; an open one draws its break above its first row.
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
  isQuietMarkerRow,
  joinsQuietMarkerRun,
  forkDivider,
  forkingDivider,
  turnFolds,
  membershipFolds,
  threadLoadOlderNode,
  roomIntroNode,
  unreadMarkerRef,
  measureElement,
  ledgerPxAtRender,
}: {
  virtualItems: VirtualItem[];
  threadId: string | undefined;
  threadEvents: MatrixEvent[];
  /** When set in a thread, index 0 renders this Load Older chip as a virtual tile. */
  threadLoadOlderNode?: ReactNode;
  /** When set in a room, index 0 renders the room start intro as a virtual tile. */
  roomIntroNode?: ReactNode;
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
  /** Whether a row renders as a quiet marker line, which reply quotes look past. */
  isQuietMarkerRow: (
    event: MatrixEvent,
    data: TimelineMessageData,
    timelineSet: EventTimelineSet
  ) => boolean;
  /** Of those, whether it shows beside the quiet markers next to it, in one row. */
  joinsQuietMarkerRun?: (
    event: MatrixEvent,
    data: TimelineMessageData,
    timelineSet: EventTimelineSet
  ) => boolean;
  /** In a fork, the line between its parent's messages and its first row of its own (`index`). */
  forkDivider?: { index: number; node: ReactNode };
  /** In a fork draft, the line under its fork point (`index`), the last row it shows. */
  forkingDivider?: { index: number; node: ReactNode };
  /** The open thread's folded turns (`threadTurnFolds.ts`) and what their breaks do on a click. */
  turnFolds?: { view: ThreadTurnFoldView; toggle: (fold: ThreadTurnFold) => void };
  /** The room's folded membership runs (`membershipFolds.ts`) and what their breaks do on a click. */
  membershipFolds?: { view: MembershipFoldView; toggle: (fold: MembershipFold) => void };
  /** Receives the "New messages" line, so the timeline knows when it is in view. */
  unreadMarkerRef: Ref<HTMLDivElement>;
  measureElement: (node: Element | null) => void;
  ledgerPxAtRender: number;
}): ReactNode[] => {
  const leadingNode = threadId ? threadLoadOlderNode : roomIntroNode;
  const leadingOffset = leadingNode ? 1 : 0;
  const getRowEvent = (index: number): MatrixEvent | undefined =>
    threadId ? threadEvents[index] : roomWindowRows[index];
  // A folded turn's rows show nothing, the one that draws its break included.
  const isRowHidden = (event: MatrixEvent): boolean => {
    const id = event.getId() ?? '';
    return (
      !!turnFolds?.view.hiddenIds.has(id) ||
      turnFolds?.view.breaks.get(id)?.open === false ||
      messageData.threadSummaryTimeline.hiddenEventIds.has(id) ||
      messageData.secretRequestTimeline.hiddenEventIds.has(id) ||
      isTimelineRowHidden(event, {
        messageData,
        ignoredUsersSet,
        showHiddenEvents,
        isHiddenByPlugin,
      })
    );
  };
  const membershipFoldAt = (event: MatrixEvent | undefined) =>
    threadId ? undefined : membershipFolds?.view.breaks.get(event?.getId() ?? '');
  const rowContexts = foldTimelineRowContexts({
    indexes: virtualItems
      .filter((item) => item.index >= leadingOffset)
      .map((item) => item.index - leadingOffset),
    getEvent: getRowEvent,
    isSkipped: isRowHidden,
    isFoldBreak: membershipFolds
      ? (index) => membershipFoldAt(getRowEvent(index))?.open === false
      : undefined,
    getAbsoluteIndex: threadId
      ? undefined
      : (index) => roomRowEntries[windowStart + index]?.absoluteIndex,
    readUptoAbsoluteIndex: threadId ? undefined : readUptoAbsoluteIndex,
    // The fork's first own row starts its group under the divider, whoever wrote the row above.
    groupStartIndex: forkDivider?.index,
    isQuietMarker: (event) => isQuietMarkerRow(event, messageData, timelineSet),
    joinsQuietRun: joinsQuietMarkerRun
      ? (event) => joinsQuietMarkerRun(event, messageData, timelineSet)
      : undefined,
  });

  const renderTile = (item: VirtualItem): ReactNode => {
    if (leadingOffset && item.index === 0) {
      return (
        <VirtualTile
          key={item.key}
          ref={measureElement}
          virtualItem={item}
          style={{ top: item.start + ledgerPxAtRender }}
        >
          {leadingNode}
        </VirtualTile>
      );
    }
    const eventIndex = item.index - leadingOffset;
    const event = getRowEvent(eventIndex);
    if (!event) return null;
    // An edit or a reaction has no row of its own. A height measured before it decrypted keeps
    // its tile mounted until measuring corrects it.
    const id = event.getId() ?? '';
    // So has a row a folded turn hides, once sized as nothing; the row that draws its break stays.
    if (item.size === 0 && (reactionOrEditEvent(event) || turnFolds?.view.hiddenIds.has(id))) {
      return null;
    }
    const context = rowContexts.get(eventIndex);
    // Outside the row's boundary, so the break keeps its focus when its fold opens or closes.
    const turnBreak = turnFolds?.view.breaks.get(id);
    const membershipFold = membershipFoldAt(event);
    let breakNode: ReactNode;
    if (turnBreak) {
      breakNode = (
        <TurnBreak
          count={turnBreak.fold.count}
          open={turnBreak.open}
          onToggle={() => turnFolds?.toggle(turnBreak.fold)}
        />
      );
    } else if (membershipFold) {
      breakNode = (
        <MembershipBreak
          summary={membershipFold.fold.summary}
          open={membershipFold.open}
          onToggle={() => membershipFolds?.toggle(membershipFold.fold)}
        />
      );
    }
    // A closed membership fold's row is its break, under the unread divider when the fold holds
    // the first unread event.
    const foldClosed = membershipFold?.open === false;
    let content: ReactNode = null;
    // A quiet marker folded into the run's first row, which shows it, renders nothing.
    if (!foldClosed && context && !context.inQuietRun && !isRowlessTimelineEvent(event)) {
      const quietRun = context.quietRunIndexes?.flatMap((index): TimelineMessageRow[] => {
        const marker = getRowEvent(index);
        const eventId = marker?.getId();
        return marker && eventId
          ? [{ eventId, event: marker, index, timelineSet, collapse: false, highlighted: false }]
          : [];
      });
      const row: TimelineMessageRow = {
        eventId: id,
        event,
        index: eventIndex,
        timelineSet,
        collapse: context.collapse,
        highlighted: focusItem?.eventId === id && focusItem.highlight,
        previousEventId: replyNeedingNoQuote(
          event,
          context.inPlaceReplyEventId,
          // Nor one of a voice echo shown under its voice message.
          (replyId) =>
            isHiddenByPluginId(replyId) || messageData.voiceTranscripts.hiddenEventIds.has(replyId)
        ),
        quietRun,
      };
      // A fork draft's line goes under its fork point, or under the run of markers it is in.
      const forkingHere =
        forkingDivider !== undefined &&
        (forkingDivider.index === eventIndex ||
          !!context.quietRunIndexes?.includes(forkingDivider.index));
      // A row that fails to render shows as broken; the rows around it stay.
      content = (
        <MessageRowBoundary
          render={() => {
            const rendered = renderEvent(row, messageData);
            if (rendered === null) return null;
            return (
              <>
                {forkDivider?.index === eventIndex && forkDivider.node}
                {context.unreadDivider && <UnreadDivider separatorRef={unreadMarkerRef} />}
                {context.dayDivider && <DayDivider ts={event.getTs()} />}
                {rendered}
                {forkingHere && forkingDivider.node}
              </>
            );
          }}
        />
      );
    }
    return (
      <VirtualTile
        key={item.key}
        ref={measureElement}
        virtualItem={item}
        style={{ top: item.start + ledgerPxAtRender }}
      >
        <div data-room-row-index={threadId ? undefined : eventIndex}>
          {foldClosed && context?.unreadDivider && <UnreadDivider separatorRef={unreadMarkerRef} />}
          {breakNode}
          {content}
        </div>
      </VirtualTile>
    );
  };
  return virtualItems.map(renderTile);
};
