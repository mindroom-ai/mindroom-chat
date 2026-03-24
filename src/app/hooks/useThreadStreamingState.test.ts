import React from 'react';
import { EventEmitter } from 'events';
import { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { RelationsEvent } from 'matrix-js-sdk/lib/models/relations';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useThreadStreamingState } from './useThreadStreamingState';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  content: Record<string, unknown> = {},
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
      ...content,
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
  newContent: Record<string, unknown>,
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: eventId,
        msgtype: 'm.text',
        ...newContent,
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

type HookValue = ReturnType<typeof useThreadStreamingState>;

type HarnessProps = {
  room: Room;
  threadRootId: string;
  onRender: (value: HookValue) => void;
};

type MockRelations = EventEmitter & {
  setGroupedAnnotations: (annotations: [string, Set<MatrixEvent>][]) => void;
  getSortedAnnotationsByKey: () => [string, Set<MatrixEvent>][] | null;
};

type MockThread = Thread &
  EventEmitter & {
    setLastReply: (event: MatrixEvent | null) => void;
    getUnfilteredTimelineSet: () => {
      relations: {
        getChildEventsForEvent: (eventId: string) => MockRelations | undefined;
      };
    };
  };

function Harness({ room, threadRootId, onRender }: HarnessProps) {
  const value = useThreadStreamingState(room, threadRootId);
  onRender(value);
  return null;
}

const makeRelations = (): MockRelations => {
  const emitter = new EventEmitter();
  let groupedAnnotations: [string, Set<MatrixEvent>][] | null = null;

  return Object.assign(emitter, {
    setGroupedAnnotations: (annotations: [string, Set<MatrixEvent>][]) => {
      groupedAnnotations = annotations;
    },
    getSortedAnnotationsByKey: () => groupedAnnotations,
  }) as MockRelations;
};

const makeTimelineSet = (relationMap: Map<string, MockRelations>) =>
  ({
    relations: {
      getChildEventsForEvent: vi.fn((eventId: string) => relationMap.get(eventId)),
    },
  }) as {
    relations: {
      getChildEventsForEvent: (eventId: string) => MockRelations | undefined;
    };
  };

const makeThread = ({
  lastReply,
  timelineSet,
}: {
  lastReply?: MatrixEvent | null;
  timelineSet: ReturnType<typeof makeTimelineSet>;
}): MockThread => {
  const emitter = new EventEmitter();
  let currentLastReply = lastReply ?? null;

  return Object.assign(emitter, {
    lastReply: vi.fn(() => currentLastReply),
    setLastReply: (event: MatrixEvent | null) => {
      currentLastReply = event;
    },
    getUnfilteredTimelineSet: () => timelineSet,
  }) as unknown as MockThread;
};

const makeRoom = ({
  rootEventId,
  thread,
  roomTimelineSet,
}: {
  rootEventId: string;
  thread?: MockThread;
  roomTimelineSet: ReturnType<typeof makeTimelineSet>;
}): Room =>
  ({
    getThread: vi.fn((threadRootId: string) => (threadRootId === rootEventId ? thread : undefined)),
    getUnfilteredTimelineSet: () => roomTimelineSet,
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
    getSnapshot: () => latestValue ?? false,
    renderer: renderer as ReactTestRenderer,
  };
};

describe('useThreadStreamingState', () => {
  it('returns true for ai_run streaming metadata', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap);
    const replyEvent = makeMessageEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const thread = makeThread({ lastReply: replyEvent, timelineSet: roomTimelineSet });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('returns true when a stop reaction is added to the current last reply', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap);
    const replyEvent = makeMessageEvent('$reply', 200);
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relationMap.set('$reply', relations);

    const thread = makeThread({ lastReply: replyEvent, timelineSet: roomTimelineSet });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    act(() => {
      relations.setGroupedAnnotations([['⏹', new Set([stopReaction])]]);
      relations.emit(RelationsEvent.Add, stopReaction);
    });

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('returns false when there is no streaming metadata or stop reaction', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap);
    const replyEvent = makeMessageEvent('$reply', 200);
    const thread = makeThread({ lastReply: replyEvent, timelineSet: roomTimelineSet });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('treats terminal metadata as stronger than a stale stop reaction', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap);
    const replyEvent = makeMessageEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'completed' },
    });
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹️', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['⏹️', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({ lastReply: replyEvent, timelineSet: roomTimelineSet });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('updates when the thread switches to a new streaming reply', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap);
    const firstReply = makeMessageEvent('$reply-1', 200);
    const secondReply = makeMessageEvent('$reply-2', 300, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const thread = makeThread({ lastReply: firstReply, timelineSet: roomTimelineSet });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    act(() => {
      thread.setLastReply(secondReply);
      thread.emit(ThreadEvent.NewReply, thread, secondReply);
    });

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('updates when ai_run streaming metadata arrives via a replacement event', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap);
    const replyEvent = makeMessageEvent('$reply', 200);
    const streamingEdit = makeEditEvent('$reply-edit', 300, '$reply', {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const thread = makeThread({ lastReply: replyEvent, timelineSet: roomTimelineSet });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    act(() => {
      replyEvent.makeReplaced(streamingEdit);
    });

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('updates when stream_status changes to a terminal state via a replacement event', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap);
    const replyEvent = makeMessageEvent('$reply', 200, {
      'io.mindroom.stream_status': 'active',
    });
    const completedEdit = makeEditEvent('$reply-edit', 300, '$reply', {
      'io.mindroom.stream_status': 'completed',
    });
    const thread = makeThread({ lastReply: replyEvent, timelineSet: roomTimelineSet });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    act(() => {
      replyEvent.makeReplaced(completedEdit);
    });

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });
});
