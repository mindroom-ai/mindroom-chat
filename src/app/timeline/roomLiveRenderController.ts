import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import {
  EventStatus,
  MatrixEventEvent,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { inMainTimelineForReceipt } from 'matrix-js-sdk/lib/client';
import { isZeroReplyStandaloneThreadRootEvent } from '../event-store/threads/compactThreadRootData';
import type { ThreadFilterState } from '../event-store/threads/roomThreadOverviewModel';
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
import { markMainTimelineAsRead, markThreadAsRead } from '../notifications/readReceipts';
import type { ScrollToBottomState } from './roomFocusScrollController';
import { useRoomLocalEchoRefresh } from './roomLocalEchoRefresh';
import { isNearLatestEnd } from './roomTimelineScroll';
import { getLiveCollapsibleMessageExpandId } from './threadCollapsibleMessages';

type LiveRenderOptions = {
  /** The newest "at bottom" state (Jump to Latest hidden); it follows the scroll with a delay. */
  atBottomRef: MutableRefObject<boolean>;
  /** The newest answer to whether the mounted window reaches the live end. */
  atLiveEndRef: MutableRefObject<boolean>;
  effectiveThreadFilterState: ThreadFilterState;
  /** The reader sends private read receipts. */
  readonly hideActivity: boolean;
  readonly hideMembershipEvents: boolean;
  readonly hideNickAvatarEvents: boolean;
  ignoredUsersSet: Set<string>;
  /** A long message marked here opens expanded once. */
  markLiveExpansionCandidate: (eventId: string) => void;
  /** Whether the room's newest row is its first, so a live row is followed at the top. */
  latestAtTopRef?: MutableRefObject<boolean>;
  mx: MatrixClient;
  normalThreadRecordMap: ReadonlyMap<string, ThreadRecord>;
  onStoreThreadSummary: ThreadSummaryWriter;
  room: Room;
  roomThreadFilterActive: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  /** The shared bottom-pin request, applied by the scroll controller at its next commit. */
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  /** Adds events to the open thread's rows. */
  setSupplementalThreadEvents: (expectedThreadId: string, events: MatrixEvent[]) => void;
  observeLiveTail: (threadId: string) => void;
  notifyThreadEventsChanged: () => void;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  setUnreadInfo: Dispatch<SetStateAction<RoomUnreadInfo | undefined>>;
  showHiddenEvents: boolean;
  /** Event ID to row index, for the open thread's rows. */
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  /** The open thread's root, or `undefined` in the room view. */
  threadId: string | undefined;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  /**
   * This render's value of `atLiveEndRef`. The handlers below always run as of the newest render,
   * so the two never differ there; they read the ref.
   */
  timelineAtLiveEnd: boolean;
  unreadInfo: RoomUnreadInfo | undefined;
};

/** An edit changes a row that is already there; it never becomes a row of its own. */
const isEdit = (event: MatrixEvent): boolean =>
  event.getRelation()?.rel_type === RelationType.Replace;

/** Without a `document` (a unit test in Node) the window counts as not focused. */
const documentHasFocus = (): boolean => typeof document !== 'undefined' && document.hasFocus();

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
export const useRoomLiveRenderController = (options: LiveRenderOptions): void => {
  const {
    atBottomRef,
    atLiveEndRef,
    effectiveThreadFilterState,
    hideActivity,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    markLiveExpansionCandidate,
    latestAtTopRef,
    mx,
    normalThreadRecordMap,
    onStoreThreadSummary,
    room,
    roomThreadFilterActive,
    scrollRef,
    scrollToBottomRef,
    setSupplementalThreadEvents,
    observeLiveTail,
    notifyThreadEventsChanged,
    setTimeline,
    setUnreadInfo,
    showHiddenEvents,
    threadEventIndexMapRef,
    threadId,
    threadResolutionMap,
    unreadInfo,
  } = options;

  // A reply decrypted after the reader left its thread was not watched there.
  const openThreadIdRef = useLatestRef(threadId);

  // Same rows, same range, new object: whatever derives from the window computes again. A
  // repaint never touches the range, which another hook may have just changed (a removed row).
  const repaint = () => setTimeline((current) => ({ ...current }));

  // The window takes in the one row that arrived at its end.
  const grow = () =>
    setTimeline((current) => ({
      ...current,
      range: { start: current.range.start, end: current.range.end + 1 },
    }));

  const requestBottomPin = (smooth: boolean) => {
    const request = scrollToBottomRef.current;
    request.count += 1;
    request.smooth = smooth;
  };

  const isThreadActivity = (event: MatrixEvent, openThreadId: string): boolean =>
    touchesOpenThread(event, openThreadId, threadEventIndexMapRef.current);

  // Open-time backfill must never get here: a row mounted expanded and folded later would move
  // the reader's scroll position.
  const markExpandOnce = (event: MatrixEvent) => {
    const expandId = getLiveCollapsibleMessageExpandId({
      mEvent: event,
      room,
      threadId,
      threadFilterState: effectiveThreadFilterState,
      threadResolutionMap,
      threadRecordMap: normalThreadRecordMap,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
    });
    if (expandId) markLiveExpansionCandidate(expandId);
  };

  // Not live: history pages, cache restores, roots a thread list adds and pending local echoes.
  // Only a send still on its way is painted, so that it shows before the server confirms it.
  const paintPendingSend = (event: MatrixEvent) => {
    if (!event.isSending()) return;
    if (threadId) {
      if (!isThreadActivity(event, threadId)) return;
      if (!isEdit(event)) setSupplementalThreadEvents(threadId, [event]);
      notifyThreadEventsChanged();
      return;
    }
    // A new top-level message shows as a thread card at once in the compact view.
    if (isZeroReplyStandaloneThreadRootEvent(event)) repaint();
  };

  const paintThreadArrival = (event: MatrixEvent, openThreadId: string) => {
    if (!isThreadActivity(event, openThreadId)) return;
    const atLiveEnd = atLiveEndRef.current;
    if (!isEdit(event)) setSupplementalThreadEvents(openThreadId, [event]);
    if (atLiveEnd && eventBelongsToThread(event, openThreadId)) observeLiveTail(openThreadId);
    notifyThreadEventsChanged();

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
    if (!area || !atLiveEndRef.current || !atBottomRef.current || !documentHasFocus()) return;
    if (!isNearBottomNow(area)) return;
    void markThreadAsRead(mx, room.roomId, openThreadId, hideActivity, event);
  };

  const storeThreadSummary = (event: MatrixEvent) => {
    const rootId = event.threadRootId;
    if (!rootId || !isThreadSummaryEvent(event)) return;
    const summary = getLatestThreadSummaryInfoFromEventSources([event]);
    if (!summary?.summaryText) return;
    const thread = room.getThread(rootId);
    onStoreThreadSummary(
      rootId,
      summary,
      ...getThreadSummaryInfosFromEventSources(thread?.events, thread?.timeline)
    );
  };

  const paintRoomArrival = (event: MatrixEvent) => {
    if (isThreadOnlyRoomActivity(room, event)) {
      // A thread's card changes, but no room row comes in (the classic view's thread reply rows
      // enter the window through the hook that keeps the newest row).
      storeThreadSummary(event);
      repaint();
      if (atBottomRef.current && atLiveEndRef.current) requestBottomPin(true);
      return;
    }

    const atLiveEnd = atLiveEndRef.current;
    const isRoomRow = isRenderableEvent(
      event,
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents
    );
    // Measured at this moment, so that a streamed edit cannot hold a reader at the bottom who
    // has just scrolled away.
    const area = scrollRef.current;
    const followsLiveEnd = atLiveEnd && !!area && isNearLatestEnd(area, !!latestAtTopRef?.current);
    if (followsLiveEnd && atBottomRef.current && documentHasFocus()) {
      void markMainTimelineAsRead(mx, room.roomId, hideActivity);
    } else if (!unreadInfo && isRoomRow) {
      // The "New messages" line goes above the first message the reader has not seen. Only a
      // new row sets where it goes: a reaction, an edit or a hidden event the reader did not
      // see would put the line above the next message, though they may watch that one arrive.
      setUnreadInfo(getRoomUnreadInfo(room));
    }

    if (!atLiveEnd || !isRoomRow) {
      repaint();
      return;
    }
    // A filtered overview already holds every matching row, so its range stays.
    if (roomThreadFilterActive) repaint();
    else grow();
    if (followsLiveEnd) requestBottomPin(true);
  };

  useRoomLocalEchoRefresh(room, (event, { initial }) => {
    repaint();
    // A message the reader sends reads the room up to it. Its server echo replaces the pending
    // row instead of arriving live, so the arrival above never sends that receipt, and a message
    // that came while the reader then scrolled away would get the New Messages line above their
    // own.
    const sent = event.status === null || event.status === EventStatus.SENT;
    if (!initial && sent && !threadId && atBottomRef.current && documentHasFocus()) {
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

  useLiveEventArrive(room, (event, { liveEvent }) => {
    if (!liveEvent) {
      paintPendingSend(event);
      return;
    }
    markExpandOnce(event);
    if (event.isRedaction()) {
      if (threadId) notifyThreadEventsChanged();
      else repaint();
      return;
    }
    if (threadId) paintThreadArrival(event, threadId);
    else paintRoomArrival(event);
  });
};
