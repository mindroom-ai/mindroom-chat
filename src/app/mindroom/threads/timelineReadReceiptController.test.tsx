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

const message = (id: string, ts: number, threadId?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@bob:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
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

const render = ({
  threads,
  onScreen,
}: {
  threads: ReturnType<typeof makeThread>[];
  onScreen: MatrixEvent[];
}) => {
  const room = {
    roomId: '!room:example.org',
    findEventById: () => undefined,
    getEventReadUpTo: () => null,
    getLiveTimeline: () => ({ getEvents: () => [] }),
    getThread: (id: string) => threads.find((thread) => thread.id === id) ?? null,
  };
  const mx = {
    getRoom: () => room,
    getSafeUserId: () => ME,
    getUserId: () => ME,
    sendReceipt: vi.fn(),
  };
  const Harness = () => {
    useTimelineReadReceiptController({
      atBottom: true,
      atBottomAnchorRef: { current: null },
      atBottomRef: { current: true },
      atLiveEndRef: { current: true },
      getScrollElement: () => null,
      handleOpenEvent: vi.fn(),
      hideActivity: false,
      mx: mx as never,
      onScreenEventsRef: { current: () => onScreen },
      readUptoEventIdRef: { current: undefined },
      room: room as never,
      setAtBottom: vi.fn(),
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
  return () => mx.sendReceipt.mock.calls.map(([event, , body]) => [event.getId(), body.thread_id]);
};

describe('useTimelineReadReceiptController', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { hasFocus: () => true });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the unread threads shown on screen in classic, never a summary-only reply', async () => {
    const shownReply = message('$a-reply', 20, '$a');
    const readReply = message('$b-read', 10, '$b');
    // The bundled newest reply of `$b` is not loaded, so the classic view does not show it.
    const receipts = render({
      threads: [
        makeThread('$a', [shownReply]),
        makeThread('$b', [readReply], '$b-read', message('$b-new', 30, '$b')),
      ],
      onScreen: [message('$a', 1), shownReply, message('$b', 2), readReply],
    });

    act(() => focus.onChange(true));
    await act(async () => undefined);

    expect(receipts()).toEqual([['$a-reply', '$a']]);
  });
});
