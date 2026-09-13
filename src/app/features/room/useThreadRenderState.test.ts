import React from 'react';
import { EventTimelineSet, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useThreadRenderState } from './useThreadRenderState';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = 'original'
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: eventId,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

type HookSnapshot = ReturnType<typeof useThreadRenderState>;

type HarnessProps = {
  room: Room;
  roomTimelineSet: EventTimelineSet;
  threadTimelineSet?: EventTimelineSet;
  threadId?: string;
  thread: Thread | null;
  threadInitialCacheHydrated: boolean;
  onRender: (snapshot: HookSnapshot) => void;
};

function Harness({ onRender, ...props }: HarnessProps) {
  const snapshot = useThreadRenderState(props);
  onRender(snapshot);
  return null;
}

const makeTimelineSet = (): EventTimelineSet =>
  ({
    relations: {
      aggregateChildEvent: vi.fn(),
    },
  } as unknown as EventTimelineSet);

const makeRoom = (rootEvent?: MatrixEvent): Room =>
  ({
    findEventById: vi.fn((eventId: string) =>
      rootEvent?.getId() === eventId ? rootEvent : undefined
    ),
  } as unknown as Room);

const makeThread = (rootEvent: MatrixEvent, events: MatrixEvent[]): Thread =>
  ({
    rootEvent,
    events,
  } as unknown as Thread);

const renderHookHarness = (props: Omit<HarnessProps, 'onRender'>): {
  getSnapshot: () => HookSnapshot;
  update: (nextProps: Omit<HarnessProps, 'onRender'>) => void;
  renderer: ReactTestRenderer;
} => {
  let latestSnapshot: HookSnapshot | undefined;
  const onRender = (snapshot: HookSnapshot) => {
    latestSnapshot = snapshot;
  };

  const renderer = create(React.createElement(Harness, { ...props, onRender }));

  return {
    getSnapshot: () => {
      if (!latestSnapshot) {
        throw new Error('Hook snapshot was not captured');
      }
      return latestSnapshot;
    },
    update: (nextProps) => {
      act(() => {
        renderer.update(React.createElement(Harness, { ...nextProps, onRender }));
      });
    },
    renderer,
  };
};

describe('useThreadRenderState', () => {
  it('renders cached fallback events before initial cache hydration finishes', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const replyEvent = makeMessageEvent('$reply', 2);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('loading');
    expect(getSnapshot().threadEvents).toEqual([]);

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [replyEvent]);
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('cached');
    expect(getSnapshot().threadEvents).toEqual([replyEvent]);
    expect(getSnapshot().threadEventIndexMapRef.current.get('$reply')).toBe(0);

    renderer.unmount();
  });

  it('keeps the richer fallback event when live thread hydration brings a stale duplicate', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const staleLiveReply = makeMessageEvent('$reply', 2);
    const correctedFallbackReply = makeMessageEvent('$reply', 2);
    correctedFallbackReply.makeReplaced(makeEditEvent('$edit-2', 3, '$reply'));
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [staleLiveReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [correctedFallbackReply]);
    });

    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('live');
    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual([
      '$root',
      '$reply',
    ]);
    expect(getSnapshot().threadEvents[1]).toBe(correctedFallbackReply);
    expect(getSnapshot().threadEvents[1].replacingEvent()?.getId()).toBe('$edit-2');

    renderer.unmount();
  });

  it('resets supplemental thread state cleanly', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const replyEvent = makeMessageEvent('$reply', 2);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [replyEvent]);
    });
    expect(getSnapshot().threadEvents).toEqual([replyEvent]);

    act(() => {
      getSnapshot().resetThreadRenderState('$root');
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('loading');
    expect(getSnapshot().threadEvents).toEqual([]);
    expect(getSnapshot().threadEventIndexMapRef.current.size).toBe(0);

    renderer.unmount();
  });
});
