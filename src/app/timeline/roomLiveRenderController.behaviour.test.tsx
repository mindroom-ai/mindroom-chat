import type { SetStateAction } from 'react';
import {
  EventStatus,
  MatrixEvent,
  RoomEvent,
  type IEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultThreadFilterState } from '../event-store/threads/roomThreadOverviewModel';
import type { RoomUnreadInfo, Timeline } from '../event-store/timeline/timelinePagination';
import { markMainTimelineAsRead } from '../notifications/readReceipts';
import { useRoomLiveRenderController } from './roomLiveRenderController';

vi.mock('../notifications/readReceipts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../notifications/readReceipts')>()),
  markMainTimelineAsRead: vi.fn(() => Promise.resolve()),
}));

const ROOM_ID = '!live:example.org';
const ME = '@me:example.org';
const HELPER = '@helper:example.org';
const THREAD_ID = '$thread-root';
const THREAD_ROW = '$thread-reply-1';
const READ_UP_TO = '$read';

const makeEvent = (id: string, overrides: Partial<IEvent> = {}): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: HELPER,
    type: 'm.room.message',
    origin_server_ts: 2_000,
    content: { msgtype: 'm.text', body: `Message ${id}` },
    ...overrides,
  });

const threadReply = (id: string, rootId = THREAD_ID): MatrixEvent =>
  makeEvent(id, {
    content: {
      msgtype: 'm.text',
      body: `Reply ${id}`,
      'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
    },
  });

const editOf = (id: string, targetId: string): MatrixEvent =>
  makeEvent(id, {
    content: {
      msgtype: 'm.text',
      body: '* Streamed so far',
      'm.new_content': { msgtype: 'm.text', body: 'Streamed so far' },
      'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
    },
  });

const reactionTo = (id: string, targetId: string): MatrixEvent =>
  makeEvent(id, {
    type: 'm.reaction',
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: targetId, key: '👍' } },
  });

const redactionOf = (id: string, targetId: string): MatrixEvent =>
  makeEvent(id, { type: 'm.room.redaction', redacts: targetId, content: { redacts: targetId } });

const summaryNotice = (id: string, summary: string): MatrixEvent =>
  makeEvent(id, {
    content: {
      msgtype: 'm.notice',
      body: summary,
      'io.mindroom.thread_summary': {
        version: 1,
        summary,
        generated_at: '2026-11-05T10:00:00Z',
        message_count: 4,
      },
      'm.relates_to': { rel_type: 'm.thread', event_id: THREAD_ID },
    },
  });

const pending = (event: MatrixEvent): MatrixEvent => {
  event.setStatus(EventStatus.SENDING);
  return event;
};

type Scenario = {
  threadId?: string;
  atBottom?: boolean;
  atLiveEnd?: boolean;
  /** How far the reader is above the bottom of the scroll area, in px. */
  fromBottom?: number;
  filterActive?: boolean;
  hideActivity?: boolean;
  unreadInfo?: RoomUnreadInfo;
  /** Row IDs of the open thread. */
  threadRows?: string[];
  /** Events of the thread `THREAD_ID` as the room knows it. */
  knownThreadEvents?: MatrixEvent[];
};

type Listener = (...args: unknown[]) => void;

/** The window every `setTimeline` updater is applied to: rows 0 to 10 of the room. */
const BASE_WINDOW: Timeline = { linkedTimelines: [], range: { start: 0, end: 10 } };

const renderers: ReactTestRenderer[] = [];

afterEach(() => {
  renderers.splice(0).forEach((renderer) => {
    act(() => renderer.unmount());
  });
  vi.unstubAllGlobals();
  vi.mocked(markMainTimelineAsRead).mockClear();
});

const renderController = (scenario: Scenario = {}) => {
  const listeners = new Map<string, Set<Listener>>();
  const readEvent = makeEvent(READ_UP_TO, { sender: ME });
  const liveEvents = [readEvent];
  const room = {
    roomId: ROOM_ID,
    myUserId: ME,
    findEventById: (eventId: string) => liveEvents.find((event) => event.getId() === eventId),
    getThread: (rootId: string) => {
      const events = scenario.knownThreadEvents;
      if (rootId !== THREAD_ID || !events) return null;
      // The SDK's thread hands out the same array as `events` and `timeline`.
      return { id: rootId, events, timeline: events };
    },
    getEventReadUpTo: () => READ_UP_TO,
    getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => ({ getEvents: () => liveEvents }) }),
    on: (name: string, listener: Listener) => {
      const named = listeners.get(name) ?? new Set<Listener>();
      named.add(listener);
      listeners.set(name, named);
    },
    removeListener: (name: string, listener: Listener) => {
      listeners.get(name)?.delete(listener);
    },
  } as unknown as Room;
  const mx = { getUserId: () => ME } as unknown as MatrixClient;
  const emit = (name: string, ...args: unknown[]) => {
    act(() => {
      listeners.get(name)?.forEach((listener) => listener(...args));
    });
  };

  // A scroll area 1000 px tall with 400 px in view.
  const scrollArea = {
    clientHeight: 400,
    scrollHeight: 1_000,
    scrollTop: 600 - (scenario.fromBottom ?? 0),
  } as HTMLDivElement;
  const scrollToBottomRef = { current: { count: 0, smooth: false } };
  const setTimeline = vi.fn<(update: SetStateAction<Timeline>) => void>();
  const setUnreadInfo = vi.fn<(update: SetStateAction<RoomUnreadInfo | undefined>) => void>();
  const onStoreThreadSummary = vi.fn();
  const setSupplementalThreadEvents = vi.fn();
  const observeLiveTail = vi.fn();
  const notifyThreadEventsChanged = vi.fn();
  const markLiveExpansionCandidate = vi.fn();

  const Harness = () => {
    useRoomLiveRenderController({
      atBottomRef: { current: scenario.atBottom ?? true },
      atLiveEndRef: { current: scenario.atLiveEnd ?? true },
      effectiveThreadFilterState: createDefaultThreadFilterState(),
      hideActivity: scenario.hideActivity ?? false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      ignoredUsersSet: new Set(),
      markLiveExpansionCandidate,
      mx,
      normalThreadRecordMap: new Map(),
      onStoreThreadSummary,
      room,
      roomThreadFilterActive: scenario.filterActive ?? false,
      scrollRef: { current: scrollArea },
      scrollToBottomRef,
      setSupplementalThreadEvents,
      observeLiveTail,
      notifyThreadEventsChanged,
      setTimeline,
      setUnreadInfo,
      showHiddenEvents: false,
      threadEventIndexMapRef: {
        current: new Map((scenario.threadRows ?? []).map((rowId, index) => [rowId, index])),
      },
      threadId: scenario.threadId,
      threadResolutionMap: new Map(),
      timelineAtLiveEnd: scenario.atLiveEnd ?? true,
      unreadInfo: scenario.unreadInfo,
    });
    return null;
  };
  act(() => {
    renderers.push(create(<Harness />));
  });

  return {
    mx,
    liveEvents,
    observeLiveTail,
    notifyThreadEventsChanged,
    onStoreThreadSummary,
    setSupplementalThreadEvents,
    setTimeline,
    setUnreadInfo,
    /** Sync appends `event` (live) or a page, a cache restore or a pending echo adds it. */
    arrive: (event: MatrixEvent, liveEvent: boolean) => {
      if (liveEvent) liveEvents.push(event);
      emit(RoomEvent.Timeline, event, room, !liveEvent, false, { liveEvent });
    },
    echoAdded: (event: MatrixEvent) => emit(RoomEvent.LocalEchoUpdated, event, room),
    echoStatusChanged: (event: MatrixEvent) =>
      emit(RoomEvent.LocalEchoUpdated, event, room, event.getId(), EventStatus.SENDING),
    pin: () => ({ ...scrollToBottomRef.current }),
    /** The range each `setTimeline` call leaves; every call hands out a new window object. */
    ranges: () =>
      setTimeline.mock.calls.map(([update]) => {
        const next = typeof update === 'function' ? update(BASE_WINDOW) : update;
        expect(next).not.toBe(BASE_WINDOW);
        return next.range;
      }),
  };
};

const NO_PIN = { count: 0, smooth: false };
const UNCHANGED = { start: 0, end: 10 };

describe('useRoomLiveRenderController, room view', () => {
  it('sends a read receipt for a live message the reader sees', () => {
    vi.stubGlobal('document', { hasFocus: () => true });
    const view = renderController({ hideActivity: true });

    view.arrive(makeEvent('$news'), true);

    expect(markMainTimelineAsRead).toHaveBeenCalledTimes(1);
    expect(markMainTimelineAsRead).toHaveBeenCalledWith(view.mx, ROOM_ID, true);
    expect(view.setUnreadInfo).not.toHaveBeenCalled();
    expect(view.ranges()).toEqual([{ start: 0, end: 11 }]);
    expect(view.pin()).toEqual({ count: 1, smooth: true });
  });

  it('records where the unread part starts when the window has no focus', () => {
    vi.stubGlobal('document', { hasFocus: () => false });
    const view = renderController();

    view.arrive(makeEvent('$news'), true);

    expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    expect(view.setUnreadInfo).toHaveBeenCalledTimes(1);
    expect(view.setUnreadInfo).toHaveBeenCalledWith({
      readUptoEventId: READ_UP_TO,
      inLiveTimeline: true,
      scrollTo: false,
    });
    // The reader still follows the live end, so the row comes in and the view follows it.
    expect(view.ranges()).toEqual([{ start: 0, end: 11 }]);
    expect(view.pin()).toEqual({ count: 1, smooth: true });
  });

  it('counts a missing document as no focus', () => {
    const view = renderController();

    view.arrive(makeEvent('$news'), true);

    expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    expect(view.setUnreadInfo).toHaveBeenCalledTimes(1);
  });

  it('never replaces existing unread info', () => {
    const view = renderController({
      unreadInfo: { readUptoEventId: '$older', inLiveTimeline: true, scrollTo: false },
    });

    view.arrive(makeEvent('$news'), true);

    expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    expect(view.setUnreadInfo).not.toHaveBeenCalled();
  });

  it('stores a live thread summary with the summaries the room knows for that thread', () => {
    const known = summaryNotice('$summary-1', 'Older summary');
    const view = renderController({ knownThreadEvents: [threadReply(THREAD_ROW), known] });

    view.arrive(summaryNotice('$summary-2', 'Newer summary'), true);

    expect(view.onStoreThreadSummary).toHaveBeenCalledTimes(1);
    expect(view.onStoreThreadSummary.mock.calls[0]).toEqual([
      THREAD_ID,
      expect.objectContaining({ summaryText: 'Newer summary', eventId: '$summary-2' }),
      expect.objectContaining({ summaryText: 'Older summary', eventId: '$summary-1' }),
    ]);
    // The thread's card changes; no room row comes in.
    expect(view.ranges()).toEqual([UNCHANGED]);
    expect(view.setUnreadInfo).not.toHaveBeenCalled();
    expect(markMainTimelineAsRead).not.toHaveBeenCalled();
  });

  it('stores a summary alone when the room does not know its thread', () => {
    const view = renderController();

    view.arrive(summaryNotice('$summary-2', 'Newer summary'), true);

    expect(view.onStoreThreadSummary.mock.calls[0]).toEqual([
      THREAD_ID,
      expect.objectContaining({ summaryText: 'Newer summary' }),
    ]);
  });

  it('stores nothing for a thread summary without text', () => {
    const view = renderController();

    view.arrive(summaryNotice('$summary-blank', ' '), true);

    expect(view.onStoreThreadSummary).not.toHaveBeenCalled();
    expect(view.ranges()).toEqual([UNCHANGED]);
  });

  it('only repaints for a live redaction', () => {
    vi.stubGlobal('document', { hasFocus: () => true });
    const view = renderController();

    view.arrive(redactionOf('$redaction', READ_UP_TO), true);

    expect(view.ranges()).toEqual([UNCHANGED]);
    expect(view.pin()).toEqual(NO_PIN);
    expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    expect(view.setUnreadInfo).not.toHaveBeenCalled();
    expect(view.notifyThreadEventsChanged).not.toHaveBeenCalled();
  });

  it('pins once without growing for thread activity while the reader is at the bottom', () => {
    vi.stubGlobal('document', { hasFocus: () => true });
    const view = renderController();

    view.arrive(threadReply('$thread-reply-2'), true);

    expect(view.pin()).toEqual({ count: 1, smooth: true });
    expect(view.ranges()).toEqual([UNCHANGED]);
    expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    expect(view.setUnreadInfo).not.toHaveBeenCalled();
  });

  it('does not pin for thread activity while the "at bottom" state is off', () => {
    const view = renderController({ atBottom: false });

    view.arrive(threadReply('$thread-reply-2'), true);

    expect(view.pin()).toEqual(NO_PIN);
    expect(view.ranges()).toEqual([UNCHANGED]);
  });

  it('only repaints for a live message while the window stops short of the live end', () => {
    const view = renderController({ atLiveEnd: false });

    view.arrive(makeEvent('$news'), true);

    expect(view.ranges()).toEqual([UNCHANGED]);
    expect(view.pin()).toEqual(NO_PIN);
  });

  it('repaints instead of growing while a thread filter is active', () => {
    const view = renderController({ filterActive: true });

    view.arrive(makeEvent('$news'), true);

    expect(view.ranges()).toEqual([UNCHANGED]);
    expect(view.pin()).toEqual({ count: 1, smooth: true });
  });

  it('grows the window but leaves a reader 100 px above the bottom in place', () => {
    const view = renderController({ fromBottom: 100 });

    view.arrive(makeEvent('$news'), true);

    expect(view.ranges()).toEqual([{ start: 0, end: 11 }]);
    expect(view.pin()).toEqual(NO_PIN);
  });

  it('only repaints for a live reaction', () => {
    const view = renderController();

    view.arrive(reactionTo('$reaction', READ_UP_TO), true);

    expect(view.ranges()).toEqual([UNCHANGED]);
    expect(view.pin()).toEqual(NO_PIN);
  });

  it('repaints for a local echo and its status changes, and never pins', () => {
    const view = renderController();
    const echo = pending(threadReply('~txn-1'));

    view.echoAdded(echo);
    view.echoStatusChanged(echo);

    expect(view.ranges()).toEqual([UNCHANGED, UNCHANGED]);
    expect(view.pin()).toEqual(NO_PIN);
  });

  it('leaves a page of history alone', () => {
    const view = renderController();

    view.arrive(makeEvent('$older-message'), false);

    expect(view.setTimeline).not.toHaveBeenCalled();
    expect(view.pin()).toEqual(NO_PIN);
    expect(view.setUnreadInfo).not.toHaveBeenCalled();
  });
});

describe('useRoomLiveRenderController, thread open', () => {
  it('only notifies the thread of a live redaction', () => {
    const view = renderController({ threadId: THREAD_ID, threadRows: [THREAD_ID, THREAD_ROW] });

    view.arrive(redactionOf('$redaction', THREAD_ROW), true);

    expect(view.notifyThreadEventsChanged).toHaveBeenCalledTimes(1);
    expect(view.setSupplementalThreadEvents).not.toHaveBeenCalled();
    expect(view.observeLiveTail).not.toHaveBeenCalled();
    expect(view.setTimeline).not.toHaveBeenCalled();
    expect(view.pin()).toEqual(NO_PIN);
  });

  it('keeps the reader at the bottom while a reply streams in as edits, without a new row', () => {
    const view = renderController({ threadId: THREAD_ID, threadRows: [THREAD_ID, THREAD_ROW] });

    view.arrive(editOf('$edit-1', THREAD_ROW), true);

    expect(view.setSupplementalThreadEvents).not.toHaveBeenCalled();
    expect(view.notifyThreadEventsChanged).toHaveBeenCalledTimes(1);
    expect(view.pin()).toEqual({ count: 1, smooth: false });
  });

  it('does not pin a reader 100 px above the bottom for an edit', () => {
    const view = renderController({
      threadId: THREAD_ID,
      threadRows: [THREAD_ID, THREAD_ROW],
      fromBottom: 100,
    });

    view.arrive(editOf('$edit-1', THREAD_ROW), true);

    expect(view.notifyThreadEventsChanged).toHaveBeenCalledTimes(1);
    expect(view.pin()).toEqual(NO_PIN);
  });

  it('observes the live tail for a reply in the thread, not for a reaction to one of its rows', () => {
    const view = renderController({ threadId: THREAD_ID, threadRows: [THREAD_ID, THREAD_ROW] });
    const reply = threadReply('$thread-reply-2');

    view.arrive(reply, true);

    expect(view.setSupplementalThreadEvents).toHaveBeenLastCalledWith(THREAD_ID, [reply]);
    expect(view.observeLiveTail).toHaveBeenCalledTimes(1);
    expect(view.observeLiveTail).toHaveBeenCalledWith(THREAD_ID);
    expect(view.pin()).toEqual({ count: 1, smooth: true });

    const reaction = reactionTo('$reaction', THREAD_ROW);
    view.arrive(reaction, true);

    expect(view.setSupplementalThreadEvents).toHaveBeenLastCalledWith(THREAD_ID, [reaction]);
    expect(view.observeLiveTail).toHaveBeenCalledTimes(1);
    expect(view.notifyThreadEventsChanged).toHaveBeenCalledTimes(2);
    // Not a reply: the reader stays at the bottom without an animation.
    expect(view.pin()).toEqual({ count: 2, smooth: false });
  });

  it('does not observe the live tail while the window stops short of it', () => {
    const view = renderController({
      threadId: THREAD_ID,
      threadRows: [THREAD_ID, THREAD_ROW],
      atLiveEnd: false,
    });

    view.arrive(threadReply('$thread-reply-2'), true);

    expect(view.setSupplementalThreadEvents).toHaveBeenCalledTimes(1);
    expect(view.notifyThreadEventsChanged).toHaveBeenCalledTimes(1);
    expect(view.observeLiveTail).not.toHaveBeenCalled();
    expect(view.pin()).toEqual(NO_PIN);
  });

  it('ignores live events of the room outside the open thread', () => {
    const view = renderController({ threadId: THREAD_ID, threadRows: [THREAD_ID, THREAD_ROW] });

    view.arrive(makeEvent('$room-message'), true);
    view.arrive(threadReply('$other-reply', '$other-root'), true);

    expect(view.setSupplementalThreadEvents).not.toHaveBeenCalled();
    expect(view.notifyThreadEventsChanged).not.toHaveBeenCalled();
    expect(view.setTimeline).not.toHaveBeenCalled();
    expect(view.pin()).toEqual(NO_PIN);
  });

  it('adds a pending reply before the server confirms it, but not a pending edit', () => {
    const view = renderController({ threadId: THREAD_ID, threadRows: [THREAD_ID, THREAD_ROW] });
    const reply = pending(threadReply('~txn-reply'));

    view.arrive(reply, false);
    view.arrive(pending(editOf('~txn-edit', THREAD_ROW)), false);

    expect(view.setSupplementalThreadEvents).toHaveBeenCalledTimes(1);
    expect(view.setSupplementalThreadEvents).toHaveBeenCalledWith(THREAD_ID, [reply]);
    expect(view.notifyThreadEventsChanged).toHaveBeenCalledTimes(2);
    expect(view.observeLiveTail).not.toHaveBeenCalled();
    expect(view.pin()).toEqual(NO_PIN);
  });
});
