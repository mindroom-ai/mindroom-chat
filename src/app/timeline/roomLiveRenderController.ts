import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  EventStatus,
  MatrixEventEvent,
  RelationType,
  type EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { inMainTimelineForReceipt } from 'matrix-js-sdk/lib/client';
import { isZeroReplyStandaloneThreadRootEvent } from '../event-store/threads/compactThreadRootData';
import type { ThreadFilterState } from '../event-store/threads/roomThreadOverviewModel';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../event-store/timeline/roomTimelineViewState';
import { isThreadOnlyRoomActivity } from '../event-store/threads/threadRenderUtils';
import type { ThreadSummaryWriter } from '../event-store/threads/threadSummaryState';
import { eventBelongsToThread } from '../event-store/threads/threadUtils';
import type { ThreadRecord } from '../event-store/threads/types';
import { useLiveEventArrive } from '../event-store/timeline/roomLiveEventArrive';
import { isRenderableEvent } from '../event-store/timeline/roomTimelineEvents';
import {
  getRoomUnreadInfo,
  type RoomUnreadInfo,
  type Timeline,
} from '../event-store/timeline/timelinePagination';
import {
  isScrollNearBottom,
  shouldAutoScrollThreadOnLiveEvent,
} from '../event-store/timeline/timelineScrollUtils';
import {
  getLatestThreadSummaryInfoFromEventSources,
  getThreadSummaryInfosFromEventSources,
  isThreadSummaryEvent,
} from '../matrix/protocol/threadSummary';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { hasTerminalStreamMetadata } from '../matrix/protocol/aiRun';
import {
  markMainTimelineAsRead,
  markShownThreadRepliesAsRead,
  markThreadAsRead,
} from '../notifications/readReceipts';
import type { ScrollToBottomState } from './roomFocusScrollController';
import { useRoomLocalEchoRefresh } from './roomLocalEchoRefresh';
import { isNearLatestEnd } from './roomTimelineScroll';
import { getLiveCollapsibleMessageExpandId } from './threadCollapsibleMessages';
import { useReaderSees } from './useReaderSees';

type LiveRenderOptions = {
  /** The newest "at bottom" state (Jump to Latest hidden); it follows the scroll with a delay. */
  atBottomRef: MutableRefObject<boolean>;
  /** The newest answer to whether the mounted window reaches the live end. */
  atLiveEndRef: MutableRefObject<boolean>;
  effectiveThreadFilterState?: ThreadFilterState;
  /** The reader sends private read receipts. */
  readonly hideActivity: boolean;
  /**
   * Whether a message arriving where the reader watches reads the room's main timeline. Compact
   * never does, also while a room without a thread shows its timeline under the bar. Default true.
   */
  readonly readsMainTimeline?: boolean;
  readonly hideMembershipEvents: boolean;
  readonly hideNickAvatarEvents: boolean;
  ignoredUsersSet: Set<string>;
  /** A long message marked here opens expanded once. */
  markLiveExpansionCandidate: (eventId: string) => void;
  /** Whether the room's newest row is its first, so a live row is followed at the top. */
  latestAtTopRef?: MutableRefObject<boolean>;
  /**
   * Brings the view to a room row the reader just sent, from wherever they are (Jump to Latest
   * when the window has left the live end).
   */
  onOwnSend?: () => void;
  mx: MatrixClient;
  normalThreadRecordMap?: ReadonlyMap<string, ThreadRecord>;
  onStoreThreadSummary: ThreadSummaryWriter;
  room: Room;
  roomThreadFilterActive?: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** The shared bottom-pin request, applied by the scroll controller at its next commit. */
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  /** Adds events to the open thread's rows. */
  setSupplementalThreadEvents?: (expectedThreadId: string, events: MatrixEvent[]) => void;
  observeLiveTail?: (threadId: string) => void;
  notifyThreadEventsChanged?: () => void;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  setUnreadInfo?: Dispatch<SetStateAction<RoomUnreadInfo | undefined>>;
  showHiddenEvents: boolean;
  /** The room's mounted rows, when they hold its threads' replies (the classic view). */
  classicRows?: () => MatrixEvent[];
  /** Event ID to row index, for the open thread's rows. */
  threadEventIndexMapRef?: MutableRefObject<Map<string, number>>;
  /** The open thread's root, or `undefined` in the room view. */
  threadId?: string;
  threadResolutionMap?: Map<string, { isResolved: boolean }>;
  /**
   * This render's value of `atLiveEndRef`. The handlers below always run as of the newest render,
   * so the two never differ there; they read the ref.
   */
  timelineAtLiveEnd: boolean;
  unreadInfo?: RoomUnreadInfo;
};

/** An edit changes a row that is already there; it never becomes a row of its own. */
const isEdit = (event: MatrixEvent): boolean =>
  event.getRelation()?.rel_type === RelationType.Replace;

/** Measured now, not taken from the "at bottom" state, which lags behind the reader's scroll. */
const isNearBottomNow = (area: HTMLElement): boolean =>
  isScrollNearBottom({
    scrollHeight: area.scrollHeight,
    scrollTop: area.scrollTop,
    clientHeight: area.clientHeight,
  });

/**
 * Whether `event` is the edit that finishes a streamed reply in thread `threadId`: an edit of a
 * reply there (not of the root, which is in the main timeline) whose content ends the stream.
 * The server counts the finished reply as new, so a reader who watched it finish has to read it.
 */
export const finishesStreamedThreadReply = (event: MatrixEvent, threadId: string): boolean =>
  isEdit(event) &&
  event.threadRootId === threadId &&
  !inMainTimelineForReceipt(event) &&
  hasTerminalStreamMetadata(event.getContent());

/** Calls `onClear` once the event's content can be read: now, or when it is decrypted. */
const whenDecrypted = (event: MatrixEvent, onClear: () => void): void => {
  if (event.isEncrypted() && event.getClearContent() === null) {
    event.once(MatrixEventEvent.Decrypted, () => {
      if (!event.isDecryptionFailure()) onClear();
    });
    return;
  }
  onClear();
};

/**
 * Whether `event` changes what the open thread shows: its root, a reply in it, or an event
 * related to one of its rows (a reaction or an edit).
 */
const touchesOpenThread = (
  event: MatrixEvent,
  threadId: string,
  rowIndexById: ReadonlyMap<string, number>
): boolean => {
  if (eventBelongsToThread(event, threadId)) return true;
  const targetId = event.getRelation()?.event_id;
  return !!targetId && rowIndexById.has(targetId);
};

/**
 * Paints what arrives while a room or one of its threads is open: local echoes of the reader's
 * sends, synced messages, edits, reactions, redactions, thread replies and thread summaries.
 * Each arrival may repaint the room window or grow it by the new row, add a pending reply to
 * the open thread, ask for a bottom pin when the reader follows the live end, open a long
 * message expanded once, store a thread summary, and send a read receipt or record where the
 * unread part starts. Storing events is the sync engine's job; nothing here writes them.
 *
 * RoomTimeline calls it after every other hook that listens to the room, so that its timeline
 * listener is the room's last one. The two shared listener hooks register once per room and
 * always call the handlers of the newest render.
 */
const EMPTY_MAP = new Map<never, never>();

export const useRoomLiveRenderController = (o: LiveRenderOptions): void => {
  const {
    atBottomRef,
    atLiveEndRef,
    hideActivity,
    mx,
    room,
    scrollRef,
    scrollToBottomRef,
    threadId,
  } = o;
  // Automatic read receipts wait until the reader sees the timeline (`useReaderSees`).
  const readerSees = useReaderSees();

  // A reply decrypted after the reader left its thread was not watched there.
  const openThreadIdRef = useLatestRef(threadId);

  // Same rows, same range, new object: whatever derives from the window computes again. A
  // repaint never touches the range, which another hook may have just changed (a removed row).
  const repaint = () => o.setTimeline((current) => ({ ...current }));

  // The window takes in the one row that arrived at its end.
  const grow = () =>
    o.setTimeline((current) => ({
      ...current,
      range: { start: current.range.start, end: current.range.end + 1 },
    }));

  const requestBottomPin = (smooth: boolean) => {
    const request = scrollToBottomRef.current;
    request.count += 1;
    request.smooth = smooth;
  };

  const isThreadActivity = (event: MatrixEvent, openThreadId: string): boolean =>
    touchesOpenThread(event, openThreadId, o.threadEventIndexMapRef?.current ?? EMPTY_MAP);

  // Open-time backfill must never get here: a row mounted expanded and folded later would move
  // the reader's scroll position.
  const markExpandOnce = (event: MatrixEvent) => {
    const expandId = getLiveCollapsibleMessageExpandId({
      mEvent: event,
      room,
      threadId,
      threadFilterState: o.effectiveThreadFilterState ?? DIRECT_ROOM_TIMELINE_FILTER_STATE,
      threadResolutionMap: o.threadResolutionMap ?? EMPTY_MAP,
      threadRecordMap: o.normalThreadRecordMap ?? EMPTY_MAP,
      ignoredUsersSet: o.ignoredUsersSet,
      showHiddenEvents: o.showHiddenEvents,
      hideMembershipEvents: o.hideMembershipEvents,
      hideNickAvatarEvents: o.hideNickAvatarEvents,
    });
    if (expandId) o.markLiveExpansionCandidate(expandId);
  };

  // Not live: history pages, cache restores, roots a thread list adds and pending local echoes.
  // Only a send still on its way is painted, so that it shows before the server confirms it.
  const paintPendingSend = (event: MatrixEvent) => {
    if (!event.isSending()) return;
    if (threadId) {
      if (!isThreadActivity(event, threadId)) return;
      if (!isEdit(event)) o.setSupplementalThreadEvents?.(threadId, [event]);
      o.notifyThreadEventsChanged?.();
      return;
    }
    // A new top-level message shows as a thread card at once in the compact view.
    if (isZeroReplyStandaloneThreadRootEvent(event)) repaint();
  };

  const paintThreadArrival = (event: MatrixEvent, openThreadId: string) => {
    if (!isThreadActivity(event, openThreadId)) return;
    const atLiveEnd = atLiveEndRef.current;
    if (!isEdit(event)) o.setSupplementalThreadEvents?.(openThreadId, [event]);
    if (atLiveEnd && eventBelongsToThread(event, openThreadId)) o.observeLiveTail?.(openThreadId);
    o.notifyThreadEventsChanged?.();

    const area = scrollRef.current;
    if (!area) return;
    const nearBottom = isNearBottomNow(area);
    const relationType = event.getRelation()?.rel_type;
    if (
      shouldAutoScrollThreadOnLiveEvent({
        relationType,
        isNearBottom: nearBottom,
        isTimelineAtLiveEnd: atLiveEnd,
      })
    ) {
      requestBottomPin(true);
    } else if (atLiveEnd && nearBottom) {
      // A reply streams in as edits: hold the reader at the bottom without an animation.
      requestBottomPin(false);
    }
    if (isEdit(event)) whenDecrypted(event, () => readFinishedStream(event, openThreadId));
  };

  // A reader who watches a streamed reply finish has read it, as a reader who watches a new reply
  // arrive has (`useTimelineReadReceiptController`): the thread is still open, at the bottom of
  // its live end, with the window focused, measured when the edit can be read.
  const readFinishedStream = (event: MatrixEvent, openThreadId: string) => {
    if (openThreadIdRef.current !== openThreadId) return;
    if (!finishesStreamedThreadReply(event, openThreadId)) return;
    const area = scrollRef.current;
    if (!area || !atLiveEndRef.current || !atBottomRef.current || !readerSees()) return;
    if (!isNearBottomNow(area)) return;
    void markThreadAsRead(mx, room.roomId, openThreadId, hideActivity, event);
  };

  // The SDK redacts its own copy of a thread's row and moves it out of the thread, but the rows
  // can hold another copy of it (a page the open fetched again, with its edit applied), which
  // kept its text. The redacted copy replaces it.
  const showThreadRedaction = (redaction: MatrixEvent, openThreadId: string) => {
    const targetId = redaction.getAssociatedId();
    if (!targetId || !o.threadEventIndexMapRef?.current.has(targetId)) return;
    const target = room.findEventById(targetId);
    if (target?.isRedacted()) o.setSupplementalThreadEvents?.(openThreadId, [target]);
  };

  const storeThreadSummary = (event: MatrixEvent) => {
    const rootId = event.threadRootId;
    if (!rootId || !isThreadSummaryEvent(event)) return;
    const summary = getLatestThreadSummaryInfoFromEventSources([event]);
    if (!summary?.summaryText) return;
    const thread = room.getThread(rootId);
    o.onStoreThreadSummary(
      rootId,
      summary,
      ...getThreadSummaryInfosFromEventSources(thread?.events, thread?.timeline)
    );
  };

  // The classic view shows a thread's replies among the room's rows: a reader who follows its
  // live end there reads a reply that arrives, or one whose stream finishes, as they would in the
  // open thread, measured when the reply can be read.
  const readClassicReply = (reply: MatrixEvent) => {
    if (!o.classicRows) return;
    whenDecrypted(reply, () => {
      const area = scrollRef.current;
      if (!reply.threadRootId || openThreadIdRef.current || !area || !atLiveEndRef.current) return;
      if (!atBottomRef.current || !readerSees()) return;
      if (!isNearLatestEnd(area, !!o.latestAtTopRef?.current)) return;
      const shown = isRenderableEvent(
        reply,
        room,
        undefined,
        o.ignoredUsersSet,
        o.showHiddenEvents,
        o.hideMembershipEvents,
        o.hideNickAvatarEvents,
        true
      );
      if (shown) void markShownThreadRepliesAsRead(mx, room.roomId, [reply], hideActivity);
    });
  };

  // A thread nobody opened keeps its replies' edits out of its timeline until it loads, so no
  // edit arrives here: the SDK only applies it to the reply. A mounted reply whose stream it
  // finishes is read up to that edit.
  const readClassicFinishedReply = useLatestRef((reply: MatrixEvent) => {
    const edit = reply.replacingEvent();
    if (reply.getRoomId() !== room.roomId || !edit) return;
    if (!hasTerminalStreamMetadata(edit.getContent())) return;
    if (o.classicRows?.().includes(reply)) readClassicReply(reply);
  });
  const { classicRows } = o;
  useEffect(() => {
    if (!classicRows) return undefined;
    const onReplaced = (reply: MatrixEvent) => readClassicFinishedReply.current(reply);
    mx.on(MatrixEventEvent.Replaced, onReplaced);
    return () => {
      mx.removeListener(MatrixEventEvent.Replaced, onReplaced);
    };
  }, [classicRows, mx, readClassicFinishedReply]);

  const paintRoomArrival = (event: MatrixEvent, timeline: EventTimeline | undefined) => {
    if (isThreadOnlyRoomActivity(room, event)) {
      // A thread's card changes, but no room row comes in (the classic view's thread reply rows
      // enter the window through the hook that keeps the newest row).
      storeThreadSummary(event);
      repaint();
      if (atBottomRef.current && atLiveEndRef.current) requestBottomPin(true);
      if (!isEdit(event)) readClassicReply(event);
      return;
    }

    const atLiveEnd = atLiveEndRef.current;
    // A thread's own timeline takes its root too, when a thread list or a sync gap's catch-up
    // loads the thread: the root's row came with the room's timeline, if at all, and must not
    // count twice, or the window would end past the rows and fall back to the newest ones.
    const onThreadTimeline =
      !!timeline && timeline.getTimelineSet() !== room.getUnfilteredTimelineSet();
    const isRoomRow =
      !onThreadTimeline &&
      isRenderableEvent(
        event,
        room,
        threadId,
        o.ignoredUsersSet,
        o.showHiddenEvents,
        o.hideMembershipEvents,
        o.hideNickAvatarEvents
      );
    // Measured at this moment, so that a streamed edit cannot hold a reader at the bottom who
    // has just scrolled away.
    const area = scrollRef.current;
    const followsLiveEnd =
      atLiveEnd && !!area && isNearLatestEnd(area, !!o.latestAtTopRef?.current);
    if (followsLiveEnd && atBottomRef.current && readerSees()) {
      if (o.readsMainTimeline !== false) void markMainTimelineAsRead(mx, room.roomId, hideActivity);
    } else if (isRoomRow) {
      const marker = getRoomUnreadInfo(room);
      if (marker && marker.readUptoEventId !== o.unreadInfo?.readUptoEventId) {
        o.setUnreadInfo?.(marker);
      }
    }

    if (!atLiveEnd || !isRoomRow) {
      repaint();
      return;
    }
    // A filtered overview already holds every matching row, so its range stays.
    if (o.roomThreadFilterActive) repaint();
    else grow();
    if (followsLiveEnd) requestBottomPin(true);
  };

  const followedSendsRef = useRef(new WeakSet<MatrixEvent>());

  useRoomLocalEchoRefresh(room, (event, { initial }) => {
    repaint();
    // A message the reader sends in the room shows at once, wherever they were in it: its first
    // report, before its row renders, takes the view there (`onOwnSend`), and the New Messages
    // line of what came while they were away goes, as that is now in view above it. Reactions,
    // edits and deletions are no rows of their own and leave the view where it is.
    const ownRoomRow =
      initial &&
      !threadId &&
      event.isSending() &&
      isRenderableEvent(
        event,
        room,
        undefined,
        o.ignoredUsersSet,
        o.showHiddenEvents,
        o.hideMembershipEvents,
        o.hideNickAvatarEvents
      );
    if (ownRoomRow && o.onOwnSend) {
      followedSendsRef.current.add(event);
      o.setUnreadInfo?.(undefined);
      o.onOwnSend();
      return;
    }
    // It also reads the room up to it. Its server echo replaces the pending row instead of
    // arriving live, so the arrival above never sends that receipt, and a message that came
    // while the reader then scrolled away would get the New Messages line above their own. A
    // send the view followed counts before the at-bottom state catches up.
    const sent = event.status === null || event.status === EventStatus.SENT;
    const followed = followedSendsRef.current.has(event);
    if (!initial && sent && !threadId && (followed || atBottomRef.current) && readerSees()) {
      void markMainTimelineAsRead(mx, room.roomId, hideActivity);
    }
    // Only the first report of a pending thread reply pins, before its row renders, so the pin
    // follows the growth. Status changes (sent, failed, cancelled) only repaint.
    if (!initial || !threadId || !event.isSending() || !isThreadActivity(event, threadId)) return;
    const area = scrollRef.current;
    if (!area) return;
    if (
      shouldAutoScrollThreadOnLiveEvent({
        relationType: event.getRelation()?.rel_type,
        isNearBottom: isNearBottomNow(area),
        isTimelineAtLiveEnd: atLiveEndRef.current,
      })
    ) {
      requestBottomPin(true);
    }
  });

  useLiveEventArrive(room, (event, { liveEvent, timeline }) => {
    if (!liveEvent) {
      paintPendingSend(event);
      return;
    }
    markExpandOnce(event);
    if (event.isRedaction()) {
      if (threadId) {
        showThreadRedaction(event, threadId);
        o.notifyThreadEventsChanged?.();
      } else repaint();
      return;
    }
    if (threadId) paintThreadArrival(event, threadId);
    else paintRoomArrival(event, timeline);
  });
};
