import React from 'react';
import { EventEmitter } from 'events';
import { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useThreadLastActivityTs } from './useThreadLastActivityTs';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = eventId
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

type HookValue = ReturnType<typeof useThreadLastActivityTs>;

type HarnessProps = {
  room: Room;
  threadRootId: string;
  onRender: (value: HookValue) => void;
};

type MockThread = Thread &
  EventEmitter & {
    setLastReply: (event: MatrixEvent | null) => void;
  };

function Harness({ room, threadRootId, onRender }: HarnessProps) {
  const value = useThreadLastActivityTs(room, threadRootId);
  onRender(value);
  return null;
}

const makeThread = ({
  rootEvent,
  lastReply,
  replyToEvent,
}: {
  rootEvent: MatrixEvent;
  lastReply?: MatrixEvent | null;
  replyToEvent?: MatrixEvent | null;
}): MockThread => {
  const emitter = new EventEmitter();
  let currentLastReply = lastReply ?? null;

  return Object.assign(emitter, {
    rootEvent,
    replyToEvent,
    lastReply: vi.fn(() => currentLastReply),
    setLastReply: (event: MatrixEvent | null) => {
      currentLastReply = event;
    },
  }) as unknown as MockThread;
};

const makeRoom = (rootEvent: MatrixEvent, thread?: MockThread): Room =>
  ({
    findEventById: vi.fn((eventId: string) => (eventId === rootEvent.getId() ? rootEvent : undefined)),
    getThread: vi.fn((threadRootId: string) =>
      threadRootId === rootEvent.getId() ? thread : undefined
    ),
  } as unknown as Room);

const renderHookHarness = (room: Room, threadRootId = '$root'): {
  getSnapshot: () => HookValue;
  renderer: ReactTestRenderer;
} => {
  let latestValue: HookValue | undefined;
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(
      React.createElement(Harness, {
        room,
        threadRootId,
        onRender: (value) => {
          latestValue = value;
        },
      })
    );
  });

  return {
    getSnapshot: () => latestValue,
    renderer: renderer as ReactTestRenderer,
  };
};

describe('useThreadLastActivityTs', () => {
  it('uses a newer reply when the thread emits a new reply event', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replyEvent = makeMessageEvent('$reply', 200);
    const thread = makeThread({ rootEvent });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(100);

    act(() => {
      thread.setLastReply(replyEvent);
      thread.emit(ThreadEvent.NewReply, thread, replyEvent);
    });

    expect(getSnapshot()).toBe(200);

    renderer.unmount();
  });

  it('prefers the latest edit timestamp over the original reply timestamp', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replyEvent = makeMessageEvent('$reply', 200);
    const replyEdit = makeEditEvent('$edit', 300, '$reply');
    const thread = makeThread({ rootEvent, lastReply: replyEvent });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(200);

    act(() => {
      replyEvent.makeReplaced(replyEdit);
    });

    expect(getSnapshot()).toBe(300);

    renderer.unmount();
  });

  it('uses a root edit timestamp when there is no newer reply', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const rootEdit = makeEditEvent('$root-edit', 250, '$root');
    const thread = makeThread({ rootEvent, lastReply: null });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(100);

    act(() => {
      rootEvent.makeReplaced(rootEdit);
    });

    expect(getSnapshot()).toBe(250);

    renderer.unmount();
  });

  it('re-subscribes when a new last reply has the same activity timestamp', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const firstReply = makeMessageEvent('$reply-1', 200);
    const secondReply = makeMessageEvent('$reply-2', 200);
    const secondReplyEdit = makeEditEvent('$reply-2-edit', 320, '$reply-2');
    const thread = makeThread({ rootEvent, lastReply: firstReply });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(200);

    act(() => {
      thread.setLastReply(secondReply);
      thread.emit(ThreadEvent.NewReply, thread, secondReply);
    });

    expect(getSnapshot()).toBe(200);

    act(() => {
      secondReply.makeReplaced(secondReplyEdit);
    });

    expect(getSnapshot()).toBe(320);

    renderer.unmount();
  });

  it('falls back to replyToEvent when lastReply is unavailable', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replyToEvent = makeMessageEvent('$latest-known', 180);
    const thread = makeThread({ rootEvent, lastReply: null, replyToEvent });
    const room = makeRoom(rootEvent, thread);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(180);

    renderer.unmount();
  });

  it('falls back to the root timestamp when the thread model is missing', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const room = makeRoom(rootEvent, undefined);

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(100);

    renderer.unmount();
  });
});
