import {
  memo,
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
import {
  getEditedEvent,
  getEventReactions,
  hasUndecryptedNewerEdit,
  reactionOrEditEvent,
} from '../matrix/room';
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
import {
  estimateMessageRowHeight,
  estimateRoomRowHeight,
  roomWrapCharsForWidth,
} from './timelineRowEstimate';
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

const EMPTY_EVENTS: MatrixEvent[] = [];
const NEVER_HIDDEN = () => false;

/**
 * The room's rows: the room timeline's own, plus in the classic view the thread replies, those its
 * threads hold and those its history pages brought, from the start of the history it holds on
 * (`placeClassicWindow` places its window). A thread shows none of them.
 */
export const useRoomRowEntries = (
  o: Omit<RecalibrateFilterOpts, 'showThreadRepliesInRoom' | 'threadId'> & {
    timeline: Timeline;
    setTimeline: Dispatch<SetStateAction<Timeline>>;
    showThreadRepliesInRoom: boolean;
  }
) => {
  const { room, timeline, setTimeline, showThreadRepliesInRoom: classic } = o;
  const { roomEntryCount, renderableEventEntries } = useMemo(() => {
    const entries = getRenderableEventEntries(
      timeline.linkedTimelines,
      room,
      undefined,
      o.ignoredUsersSet,
      o.showHiddenEvents,
      o.hideMembershipEvents,
      o.hideNickAvatarEvents,
      classic
    );
    if (!classic) return { roomEntryCount: entries.length, renderableEventEntries: entries };
    const filters = {
      ignoredUsersSet: o.ignoredUsersSet,
      showHiddenEvents: o.showHiddenEvents,
      hideMembershipEvents: o.hideMembershipEvents,
      hideNickAvatarEvents: o.hideNickAvatarEvents,
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
    classic,
    o.hideMembershipEvents,
    o.hideNickAvatarEvents,
    o.ignoredUsersSet,
    o.showHiddenEvents,
    room,
    timeline,
  ]);
  const classicWindowRef = useRef<ClassicWindow>(undefined);
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
 * The virtual list's row sizes and keys for this render. Room indexes follow the leading room
 * intro item when present, then count from the window's first row. Estimates read the newest rows
 * and window through refs so a widened window is priced consistently with the rows laid out.
 */
export const THREAD_LOAD_OLDER_KEY = '__thread_load_older__';
const THREAD_LOAD_OLDER_ESTIMATE_PX = 40;
export const ROOM_INTRO_KEY = '__room_intro__';
/** Height of `ExpandAllLine` (`paddingBlockStart` 4 px + 18 px button) in item 0. */
export const EXPAND_ALL_LINE_ESTIMATE_PX = 22;
// Non-integer so virtual-core records the first DOM measurement on mount.
const ROOM_LEADING_ESTIMATE_PX = EXPAND_ALL_LINE_ESTIMATE_PX + ROOM_ROW_UNMEASURED_PX;

export const timelineRowSizing = (o: {
  threadId?: string;
  compactLayout: boolean;
  showThreadRepliesInRoom?: boolean;
  threadEvents?: MatrixEvent[];
  /** Whether index 0 of the thread virtualizer is the Load Older chip. */
  hasThreadLoadOlder?: boolean;
  /** Whether index 0 of the room virtualizer is the room start intro. */
  hasRoomIntro?: boolean;
  roomWindowRows?: MatrixEvent[];
  windowStart?: number;
  roomRowsRef?: MutableRefObject<MatrixEvent[]>;
  activeRangeRef?: MutableRefObject<Timeline['range']>;
  threadRecordMapRef?: MutableRefObject<ReadonlyMap<string, ThreadRecord>>;
  /** The open thread's folded turns: a break adds its height to its row, which it alone fills. */
  turnFolds?: ThreadTurnFoldView;
  /** The open thread's rows that show nothing: priced as nothing, like the size they then get. */
  hiddenIds?: ReadonlySet<string>;
  /** The room's folded membership runs, read through refs as the rows are. */
  membershipFoldsRef?: MutableRefObject<MembershipFoldView>;
  /** The room's list as it last rendered (`useMembershipFoldRowSizes`). */
  renderedRoomRowsRef?: MutableRefObject<RenderedRoomRows>;
  columnWidth?: number;
}) => {
  const threadLeadingOffset = o.threadId && o.hasThreadLoadOlder ? 1 : 0;
  const roomLeadingOffset = !o.threadId && o.hasRoomIntro ? 1 : 0;
  const roomWrapChars = roomWrapCharsForWidth(o.columnWidth);
  const estimateSize = (index?: number): number => {
    if (!o.threadId) {
      if (roomLeadingOffset && index === 0) return ROOM_LEADING_ESTIMATE_PX;
      const rows = o.roomRowsRef?.current ?? EMPTY_EVENTS;
      const rowIndex = index === undefined ? undefined : index - roomLeadingOffset;
      const position =
        rowIndex === undefined ? undefined : (o.activeRangeRef?.current.start ?? 0) + rowIndex;
      const event = position === undefined ? undefined : rows[position];
      const membershipFold = event && o.membershipFoldsRef?.current.breaks.get(event.getId() ?? '');
      if (membershipFold?.open === false) {
        const heldPx = o.renderedRoomRowsRef
          ? heldFoldHeight(o.renderedRoomRowsRef.current.sizes, membershipFold.fold)
          : 0;
        return heldPx > 0 ? heldPx : TURN_BREAK_ESTIMATE_PX + ROOM_ROW_UNMEASURED_PX;
      }
      const breakPx = membershipFold ? TURN_BREAK_ESTIMATE_PX : 0;
      if (o.compactLayout) return ROOM_ROW_ESTIMATE_PX.compact + breakPx;
      if (!event || position === undefined) {
        return ROOM_ROW_ESTIMATE_PX.comfortable + ROOM_ROW_UNMEASURED_PX;
      }
      const threadBadge =
        !o.showThreadRepliesInRoom &&
        hasThreadReplies(o.threadRecordMapRef?.current.get(event.getId() ?? ''));
      return (
        estimateRoomRowHeight(event, rows[position - 1], {
          threadBadge,
          wrapChars: roomWrapChars,
        }) +
        ROOM_ROW_UNMEASURED_PX +
        breakPx
      );
    }
    if (threadLeadingOffset && index === 0) return THREAD_LOAD_OLDER_ESTIMATE_PX;
    const event = index === undefined ? undefined : o.threadEvents?.[index - threadLeadingOffset];
    if (!event) {
      return o.compactLayout
        ? THREAD_ONE_LINE_ESTIMATE_PX.compact
        : THREAD_ONE_LINE_ESTIMATE_PX.comfortable;
    }
    const id = event.getId() ?? '';
    if (o.hiddenIds?.has(id)) return 0;
    const open = o.turnFolds?.breaks.get(id)?.open;
    if (open === false) return TURN_BREAK_ESTIMATE_PX;
    const row = estimateMessageRowHeight(event, { compact: o.compactLayout });
    return open ? row + TURN_BREAK_ESTIMATE_PX : row;
  };
  const getItemKey = (index: number): string | number => {
    if (threadLeadingOffset && index === 0) return THREAD_LOAD_OLDER_KEY;
    if (roomLeadingOffset && index === 0) return ROOM_INTRO_KEY;
    const event = o.threadId
      ? o.threadEvents?.[index - threadLeadingOffset]
      : o.roomWindowRows?.[index - roomLeadingOffset];
    return (
      event?.getId() ??
      (o.threadId ? index - threadLeadingOffset : (o.windowStart ?? 0) + index - roomLeadingOffset)
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
    isHiddenByPlugin = NEVER_HIDDEN,
  }: {
    messageData: Pick<TimelineMessageData, 'approvalTimeline' | 'voiceTranscripts'> &
      Partial<Pick<TimelineMessageData, 'modelChanges' | 'replyCards'>>;
    ignoredUsersSet: ReadonlySet<string>;
    showHiddenEvents: boolean;
    isHiddenByPlugin?: (event: MatrixEvent) => boolean;
  }
): boolean => {
  const id = event.getId() ?? '';
  if (
    approvalTimeline.hiddenEventIds.has(id) ||
    voiceTranscripts.hiddenEventIds.has(id) ||
    !!modelChanges?.hiddenEventIds.has(id) ||
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
type TimelineRowSnapshot = readonly unknown[];

const readRowSnapshot = (
  event: MatrixEvent,
  eventId: string,
  timelineSet: EventTimelineSet,
  threadId: string | undefined,
  messageData: TimelineMessageData
): TimelineRowSnapshot => {
  const eventContent: Record<string, unknown> | undefined = event.getContent?.();
  const replacing = event.replacingEvent?.() ?? undefined;
  const edited = getEditedEvent(eventId, event, timelineSet);
  const editedContent: Record<string, unknown> | undefined = edited?.getContent?.();
  const editedNewContent = editedContent?.['m.new_content'] as Record<string, unknown> | undefined;
  const reactions = getEventReactions(timelineSet, eventId);
  const voiceEcho = messageData.voiceTranscripts?.byVoiceId?.get(eventId);
  const voiceEchoId = voiceEcho?.getId?.() ?? '';
  return [
    event.getType?.() ?? '',
    event.status,
    Boolean(event.isRedacted?.()),
    Boolean(event.isDecryptionFailure?.()),
    eventContent,
    eventContent?.body,
    eventContent?.formatted_body,
    event.getOriginalContent?.(),
    event.sender?.name,
    event.sender?.events?.member?.getId?.(),
    replacing,
    replacing?.getId?.(),
    replacing?.getType?.(),
    replacing?.status,
    replacing?.getContent?.(),
    edited,
    edited?.getId?.(),
    edited?.status,
    editedContent,
    editedNewContent?.body,
    editedNewContent?.formatted_body,
    editedNewContent?.['io.mindroom.stream_status'],
    editedNewContent?.['io.mindroom.tool_trace'],
    editedNewContent ? Object.keys(editedNewContent).length : 0,
    hasUndecryptedNewerEdit(eventId, event, timelineSet, edited),
    reactions,
    reactions?.getRelations().length ?? 0,
    threadId ? undefined : messageData.threadRecordMap?.get(eventId),
    messageData.approvalTimeline?.historyByResponseId?.get(eventId),
    messageData.approvalTimeline?.fallbackGroupsByEventId?.get(eventId),
    messageData.threadSummaryTimeline?.markersByEventId?.get(eventId),
    voiceEcho,
    voiceEcho?.getContent?.(),
    voiceEcho ? getEditedEvent(voiceEchoId, voiceEcho, timelineSet)?.getContent?.() : undefined,
    Boolean(messageData.voiceTranscripts?.pendingVoiceIds?.has(eventId)),
    messageData.replyCards?.byReply?.get(eventId),
    messageData.modelChanges?.byAckId?.get(eventId),
    Boolean(messageData.forkPrefixEventIds?.has(eventId)),
  ];
};

const snapshotsEqual = (a: TimelineRowSnapshot, b: TimelineRowSnapshot): boolean =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

type MemoizedTimelineRowProps = {
  row: TimelineMessageRow;
  messageData: TimelineMessageData;
  renderEvent: (row: TimelineMessageRow, data: TimelineMessageData) => ReactNode | null;
  unreadDivider: boolean;
  unreadMarkerRef: Ref<HTMLDivElement> | null;
  dayDivider: boolean;
  forkDividerNode: ReactNode;
  forkingDividerNode: ReactNode;
  forkDraftPrefixClassName: string | undefined;
  snapshot: TimelineRowSnapshot;
};

const areTimelineRowPropsEqual = (
  prev: MemoizedTimelineRowProps,
  next: MemoizedTimelineRowProps
): boolean =>
  prev.renderEvent === next.renderEvent &&
  prev.row.event === next.row.event &&
  prev.row.eventId === next.row.eventId &&
  prev.row.index === next.row.index &&
  prev.row.timelineSet === next.row.timelineSet &&
  prev.row.collapse === next.row.collapse &&
  prev.row.highlighted === next.row.highlighted &&
  prev.row.previousEventId === next.row.previousEventId &&
  prev.row.quietRun === undefined &&
  next.row.quietRun === undefined &&
  prev.unreadDivider === next.unreadDivider &&
  prev.unreadMarkerRef === next.unreadMarkerRef &&
  prev.dayDivider === next.dayDivider &&
  prev.forkDividerNode === next.forkDividerNode &&
  prev.forkingDividerNode === next.forkingDividerNode &&
  prev.forkDraftPrefixClassName === next.forkDraftPrefixClassName &&
  prev.messageData.handleOpenReply === next.messageData.handleOpenReply &&
  snapshotsEqual(prev.snapshot, next.snapshot);

const MemoizedTimelineRow = memo(function MemoizedTimelineRow({
  row,
  messageData,
  renderEvent,
  unreadDivider,
  unreadMarkerRef,
  dayDivider,
  forkDividerNode,
  forkingDividerNode,
  forkDraftPrefixClassName,
}: MemoizedTimelineRowProps) {
  return (
    <MessageRowBoundary
      render={() => {
        const rendered = renderEvent(row, messageData);
        if (rendered === null) return null;
        return (
          <>
            {forkDividerNode}
            {unreadDivider && <UnreadDivider separatorRef={unreadMarkerRef} />}
            {dayDivider && <DayDivider ts={row.event.getTs()} />}
            {forkDraftPrefixClassName ? (
              <div className={forkDraftPrefixClassName} data-fork-draft-prefix="true">
                {rendered}
              </div>
            ) : (
              rendered
            )}
            {forkingDividerNode}
          </>
        );
      }}
    />
  );
}, areTimelineRowPropsEqual);

export const renderTimelineTiles = (p: {
  virtualItems: VirtualItem[];
  threadId?: string;
  threadEvents?: MatrixEvent[];
  /** When set in a thread, index 0 renders this Load Older chip as a virtual tile. */
  threadLoadOlderNode?: ReactNode;
  /** When set in a room, index 0 renders the room start intro as a virtual tile. */
  roomIntroNode?: ReactNode;
  roomWindowRows?: MatrixEvent[];
  roomRowEntries?: TimelineEventEntry[];
  windowStart?: number;
  readUptoAbsoluteIndex?: number;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  timelineSet: EventTimelineSet;
  focusItem: RoomTimelineFocusItem | undefined;
  messageData: TimelineMessageData;
  /** Whether a plugin's message renderer leaves the event without a row (pluginHiddenRows). */
  isHiddenByPlugin?: (event: MatrixEvent) => boolean;
  /** The same, of a loaded event by its ID: no row quotes such a message. */
  isHiddenByPluginId?: (eventId: string) => boolean;
  renderEvent: (row: TimelineMessageRow, data: TimelineMessageData) => ReactNode | null;
  /** Retains decryption subscriptions for rows whose memoized tile skips re-rendering. */
  retainRenderedRow?: (rowKey: string) => void;
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
  /** In a fork draft, class styling each read-only parent context row above the fork divider. */
  forkDraftPrefixClassName?: string;
  /** The open thread's folded turns (`threadTurnFolds.ts`) and what their breaks do on a click. */
  turnFolds?: { view: ThreadTurnFoldView; toggle: (fold: ThreadTurnFold) => void };
  /** The room's folded membership runs (`membershipFolds.ts`) and what their breaks do on a click. */
  membershipFolds?: { view: MembershipFoldView; toggle: (fold: MembershipFold) => void };
  /** Receives the "New messages" line, so the timeline knows when it is in view. */
  unreadMarkerRef?: Ref<HTMLDivElement>;
  measureElement: (node: Element | null) => void;
}): ReactNode[] => {
  const { threadId, timelineSet, messageData, turnFolds, membershipFolds } = p;
  const unreadMarkerRef = p.unreadMarkerRef ?? null;
  const leadingNode = threadId ? p.threadLoadOlderNode : p.roomIntroNode;
  const leadingOffset = leadingNode ? 1 : 0;
  const getRowEvent = (index: number): MatrixEvent | undefined =>
    threadId ? p.threadEvents?.[index] : p.roomWindowRows?.[index];
  const isRowHidden = (event: MatrixEvent): boolean => {
    const id = event.getId() ?? '';
    return (
      !!turnFolds?.view.hiddenIds.has(id) ||
      turnFolds?.view.breaks.get(id)?.open === false ||
      messageData.threadSummaryTimeline.hiddenEventIds.has(id) ||
      messageData.secretRequestTimeline.hiddenEventIds.has(id) ||
      isTimelineRowHidden(event, {
        messageData,
        ignoredUsersSet: p.ignoredUsersSet,
        showHiddenEvents: p.showHiddenEvents,
        isHiddenByPlugin: p.isHiddenByPlugin ?? NEVER_HIDDEN,
      })
    );
  };
  const membershipFoldAt = (event: MatrixEvent | undefined) =>
    threadId ? undefined : membershipFolds?.view.breaks.get(event?.getId() ?? '');
  const rowContexts = foldTimelineRowContexts({
    indexes: p.virtualItems
      .filter((item) => item.index >= leadingOffset)
      .map((item) => item.index - leadingOffset),
    getEvent: getRowEvent,
    isSkipped: isRowHidden,
    isFoldBreak: membershipFolds
      ? (index) => membershipFoldAt(getRowEvent(index))?.open === false
      : undefined,
    getAbsoluteIndex: threadId
      ? undefined
      : (index) => p.roomRowEntries?.[(p.windowStart ?? 0) + index]?.absoluteIndex,
    readUptoAbsoluteIndex: threadId ? undefined : p.readUptoAbsoluteIndex,
    groupStartIndex: p.forkDivider?.index,
    isQuietMarker: (event) => p.isQuietMarkerRow(event, messageData, timelineSet),
    joinsQuietRun: p.joinsQuietMarkerRun
      ? (event) => p.joinsQuietMarkerRun!(event, messageData, timelineSet)
      : undefined,
  });

  const renderTile = (item: VirtualItem): ReactNode => {
    if (leadingOffset && item.index === 0) {
      return (
        <VirtualTile
          key={item.key}
          ref={p.measureElement}
          virtualItem={item}
          style={{ top: item.start }}
        >
          {leadingNode}
        </VirtualTile>
      );
    }
    const eventIndex = item.index - leadingOffset;
    const event = getRowEvent(eventIndex);
    if (!event) return null;
    const id = event.getId() ?? '';
    if (item.size === 0 && (reactionOrEditEvent(event) || turnFolds?.view.hiddenIds.has(id))) {
      return null;
    }
    const context = rowContexts.get(eventIndex);
    const turnBreak = turnFolds?.view.breaks.get(id);
    const membershipFold = membershipFoldAt(event);
    const breakNode: ReactNode = turnBreak ? (
      <TurnBreak
        count={turnBreak.fold.count}
        open={turnBreak.open}
        onToggle={() => turnFolds?.toggle(turnBreak.fold)}
      />
    ) : membershipFold ? (
      <MembershipBreak
        summary={membershipFold.fold.summary}
        open={membershipFold.open}
        onToggle={() => membershipFolds?.toggle(membershipFold.fold)}
      />
    ) : undefined;
    const foldClosed = membershipFold?.open === false;
    let content: ReactNode = null;
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
        highlighted: p.focusItem?.eventId === id && p.focusItem.highlight,
        previousEventId: replyNeedingNoQuote(
          event,
          context.inPlaceReplyEventId,
          (replyId) =>
            (p.isHiddenByPluginId ?? NEVER_HIDDEN)(replyId) ||
            messageData.voiceTranscripts.hiddenEventIds.has(replyId)
        ),
        quietRun,
      };
      const forkingHere =
        p.forkingDivider !== undefined &&
        (p.forkingDivider.index === eventIndex ||
          !!context.quietRunIndexes?.includes(p.forkingDivider.index));
      p.retainRenderedRow?.(id || `__idx_${eventIndex}`);
      const snapshot = readRowSnapshot(event, id, timelineSet, threadId, messageData);
      content = (
        <MemoizedTimelineRow
          row={row}
          messageData={messageData}
          renderEvent={p.renderEvent}
          unreadDivider={context.unreadDivider}
          unreadMarkerRef={context.unreadDivider ? unreadMarkerRef : null}
          dayDivider={context.dayDivider}
          forkDividerNode={p.forkDivider?.index === eventIndex ? p.forkDivider.node : undefined}
          forkingDividerNode={forkingHere ? p.forkingDivider?.node : undefined}
          forkDraftPrefixClassName={p.forkDraftPrefixClassName}
          snapshot={snapshot}
        />
      );
    }
    return (
      <VirtualTile
        key={item.key}
        ref={p.measureElement}
        virtualItem={item}
        style={{ top: item.start }}
      >
        <div data-room-row-index={threadId ? undefined : eventIndex}>
          {foldClosed && context?.unreadDivider && <UnreadDivider separatorRef={unreadMarkerRef} />}
          {breakNode}
          {content}
        </div>
      </VirtualTile>
    );
  };
  return p.virtualItems.map(renderTile);
};
