import React from 'react';
import { act, create } from 'react-test-renderer';
import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';

const { focus } = vi.hoisted(() => ({ focus: { onChange: (_inFocus: boolean) => {} } }));

vi.mock('../../hooks/useIntersectionObserver', () => ({
  getIntersectionObserverEntry: () => undefined,
  useIntersectionObserver: () => undefined,
}));
vi.mock('../../hooks/useDebounce', () => ({ useDebounce: (callback: unknown) => callback }));
vi.mock('../../hooks/useDocumentFocusChange', () => ({
  useDocumentFocusChange: (onChange: (inFocus: boolean) => void) => {
    focus.onChange = onChange;
  },
}));

const ME = '@me:example.org';

const message = (id: string, ts: number, threadId?: string, msgtype = 'm.text') =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@bob:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype,
      body: id,
      ...(threadId
        ? { 'm.relates_to': { rel_type: RelationType.Thread, event_id: threadId } }
        : {}),
    },
  });

const makeThread = (
  id: string,
  events: MatrixEvent[],
  readUpTo?: string,
  summary = events[events.length - 1]
) => ({
  id,
  events,
  replyToEvent: summary,
  getEventReadUpTo: () => readUpTo ?? null,
  getReadReceiptForUserId: () => null,
  getLastUnthreadedReceiptFor: () => undefined,
});

const setup = (liveEvents: MatrixEvent[], threads: ReturnType<typeof makeThread>[] = []) => {
  const room = {
    roomId: '!room:example.org',
    findEventById: () => undefined,
    getEventReadUpTo: () => null,
    getLiveTimeline: () => ({ getEvents: () => liveEvents }),
    getThread: (id: string) => threads.find((thread) => thread.id === id) ?? null,
  };
  const mx = {
    getRoom: () => room,
    getSafeUserId: () => ME,
    getUserId: () => ME,
    sendReceipt: vi.fn(),
  };
  const render = ({
    shownEvents = [],
    compactCardRootIds,
  }: {
    shownEvents?: MatrixEvent[];
    compactCardRootIds?: string[];
  }) => {
    const Harness = () => {
      useTimelineReadReceiptController({
        atBottom: true,
        atBottomAnchorRef: { current: null },
        atBottomRef: { current: true },
        atLiveEndRef: { current: true },
        compactCardRootIds,
        getScrollElement: () => null,
        handleOpenEvent: vi.fn(),
        hideActivity: false,
        mainEventsLength: liveEvents.length,
        mx: mx as never,
        readUptoEventIdRef: { current: undefined },
        room: room as never,
        setAtBottom: vi.fn(),
        shownEventsRef: { current: shownEvents },
        threadEventsLength: 0,
        threadInitialRenderMode: 'live',
        threadTailLoaded: false,
        timelineAtLiveEnd: true,
      });
      return null;
    };
    act(() => {
      create(<Harness />);
    });
  };
  const receiptTargets = () =>
    mx.sendReceipt.mock.calls.map(([event, , body]) => [event.getId(), body.thread_id]);
  return { render, receiptTargets };
};

describe('useTimelineReadReceiptController', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { hasFocus: () => true });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the unread threads the classic view displays inline, and no others', async () => {
    const shownReply = message('$a-reply', 20, '$a');
    const readReply = message('$b-read', 10, '$b');
    // The bundled newest reply of `$b` is not loaded, so the classic view does not show it.
    const summaryOnly = makeThread('$b', [readReply], '$b-read', message('$b-new', 30, '$b'));
    const outsideWindow = makeThread('$c', [message('$c-reply', 40, '$c')]);
    const { render, receiptTargets } = setup(
      [],
      [makeThread('$a', [shownReply]), summaryOnly, outsideWindow]
    );
    render({ shownEvents: [message('$a', 1), shownReply, message('$b', 2), readReply] });

    act(() => focus.onChange(true));
    await act(async () => undefined);

    expect(receiptTargets()).toEqual([['$a-reply', '$a']]);
  });

  it('reads the newest card the compact view displays with a main receipt', async () => {
    const card = message('$card', 1);
    const filteredCard = message('$filtered-card', 2);
    const notice = message('$notice', 3, undefined, 'm.notice');
    const { render, receiptTargets } = setup([card, filteredCard, notice]);

    render({ compactCardRootIds: ['$card'] });
    await act(async () => undefined);

    expect(receiptTargets()).toEqual([['$card', 'main']]);
  });
});
