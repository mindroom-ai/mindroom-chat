// @vitest-environment jsdom
import React from 'react';
import { EventEmitter } from 'events';
import { MatrixEvent, MatrixEventEvent, RelationType } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markThreadAsRead } from '../notifications/readReceipts';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';

vi.mock('../notifications/readReceipts', async (original) => ({
  ...(await original<typeof import('../notifications/readReceipts')>()),
  markThreadAsRead: vi.fn(),
}));

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$root';

const streamedReply = (streamStatus: string) => {
  const reply = new MatrixEvent({
    event_id: '$reply',
    room_id: ROOM_ID,
    sender: '@mindroom_mind:example.org',
    type: 'm.room.message',
    content: {
      msgtype: 'm.notice',
      body: 'Thinking...',
      'm.relates_to': { rel_type: RelationType.Thread, event_id: THREAD_ID },
    },
  });
  reply.makeReplaced(
    new MatrixEvent({
      event_id: '$edit',
      room_id: ROOM_ID,
      sender: '@mindroom_mind:example.org',
      type: 'm.room.message',
      content: {
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
        'm.new_content': {
          msgtype: 'm.text',
          body: 'Done',
          'io.mindroom.stream_status': streamStatus,
        },
      },
    })
  );
  return reply;
};

const renderController = (mx: EventEmitter) => {
  // Stable inputs, as the timeline passes them; new callbacks each render would loop the observer.
  const props = {
    atBottom: false,
    atBottomAnchorRef: { current: null },
    atBottomRef: { current: true },
    atLiveEndRef: { current: true },
    getScrollElement: () => null,
    handleOpenEvent: () => undefined,
    hideActivity: false,
    mx: mx as never,
    readUptoEventIdRef: { current: undefined },
    room: { roomId: ROOM_ID } as never,
    setAtBottom: () => undefined,
    threadEventsLength: 2,
    threadId: THREAD_ID,
    threadInitialRenderMode: 'live' as const,
    threadTailLoaded: true,
    timelineAtLiveEnd: true,
  };
  function Harness() {
    useTimelineReadReceiptController(props);
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness />);
  });
  return renderer;
};

describe('useTimelineReadReceiptController', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();

        unobserve = vi.fn();

        disconnect = vi.fn();
      }
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.mocked(markThreadAsRead).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['completed', 1],
    ['streaming', 0],
  ])('marks the open thread read when a reply stream ends (%s)', (streamStatus, calls) => {
    const mx = new EventEmitter();
    const renderer = renderController(mx);

    act(() => {
      mx.emit(MatrixEventEvent.Replaced, streamedReply(streamStatus));
    });

    expect(markThreadAsRead).toHaveBeenCalledTimes(calls);
    renderer.unmount();
  });
});
