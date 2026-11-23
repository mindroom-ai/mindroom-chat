import React from 'react';
import { EventEmitter } from 'events';
import { ClientEvent, MatrixEvent, Room, Thread, type MatrixClient } from 'matrix-js-sdk';
import { RelationsEvent } from 'matrix-js-sdk/lib/models/relations';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { keepSyncedEdits } from '../../matrix/client/syncedEdits';
import { isAiRunStreaming } from '../../matrix/protocol/aiRun';
import { getEditedEvent, getLatestMessageContent } from '../../matrix/room';
import {
  getThreadStreamingReplies,
  getThreadStreamingState,
  isEventStreaming,
  useThreadStreamingState,
} from './useThreadStreamingState';

const THREAD_ROOT_ID = '$root';

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

const makeThreadReplyEvent = (
  eventId: string,
  ts: number,
  content: Record<string, unknown> = {},
  sender = '@alice:example.org'
) =>
  makeMessageEvent(
    eventId,
    ts,
    {
      ...content,
      'm.relates_to': {
        event_id: THREAD_ROOT_ID,
        rel_type: 'm.thread',
      },
    },
    sender
  );

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
    setTimelineEvents: (events: MatrixEvent[]) => void;
    getUnfilteredTimelineSet: () => ReturnType<typeof makeTimelineSet>;
  };

function Harness({ room, threadRootId, onRender }: HarnessProps) {
  const value = useThreadStreamingState(room, threadRootId);
  onRender(value);
  return null;
}

const makeRelations = (): MockRelations => {
  const emitter = new EventEmitter();
  let groupedAnnotations: [string, Set<MatrixEvent>][] | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  return Object.assign(emitter, {
    setGroupedAnnotations: (annotations: [string, Set<MatrixEvent>][]) => {
      groupedAnnotations = annotations;
    },
    getSortedAnnotationsByKey: () => groupedAnnotations,
  }) as MockRelations;
};

const makeTimelineSet = (
  relationMap: Map<string, MockRelations>,
  getEvents: () => MatrixEvent[]
) => {
  const liveTimeline = {
    getEvents,
    getNeighbouringTimeline: () => null,
  };

  return {
    getLiveTimeline: () => liveTimeline,
    relations: {
      getChildEventsForEvent: vi.fn((eventId: string) => relationMap.get(eventId)),
    },
  } as {
    getLiveTimeline: () => {
      getEvents: () => MatrixEvent[];
      getNeighbouringTimeline: () => null;
    };
    relations: {
      getChildEventsForEvent: (eventId: string) => MockRelations | undefined;
    };
  };
};

const makeThread = ({
  lastReply,
  relationMap,
  timelineEvents,
}: {
  lastReply?: MatrixEvent | null;
  relationMap: Map<string, MockRelations>;
  timelineEvents?: MatrixEvent[];
}): MockThread => {
  const emitter = new EventEmitter();
  let currentLastReply = lastReply ?? null;
  let currentTimelineEvents = timelineEvents ?? (lastReply ? [lastReply] : []);
  const timelineSet = makeTimelineSet(relationMap, () => currentTimelineEvents);

  return Object.assign(emitter, {
    lastReply: vi.fn(() => currentLastReply),
    setLastReply: (event: MatrixEvent | null) => {
      currentLastReply = event;
    },
    setTimelineEvents: (events: MatrixEvent[]) => {
      currentTimelineEvents = events;
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

const renderHookHarness = (
  room: Room,
  threadRootId = '$root'
): {
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

describe('getThreadStreamingReplies', () => {
  it('finds every reply that streams, and none once they finished', () => {
    const relationMap = new Map<string, MockRelations>();
    const earlier = makeThreadReplyEvent('$earlier', 100);
    const first = makeThreadReplyEvent('$first', 200, {
      'io.mindroom.stream_status': 'streaming',
    });
    const second = makeThreadReplyEvent('$second', 250, {
      'io.mindroom.stream_status': 'streaming',
    });
    const thread = makeThread({ relationMap, timelineEvents: [earlier, first, second] });
    const room = makeRoom({
      rootEventId: '$root',
      thread,
      roomTimelineSet: makeTimelineSet(relationMap, () => []),
    });

    expect(getThreadStreamingReplies(room, '$root')).toEqual([first, second]);
    expect(getThreadStreamingReplies(room, '$other')).toEqual([]);

    [first, second].forEach((reply) =>
      reply.setUnsigned({
        'm.relations': {
          'm.replace': makeEditEvent(`${reply.getId()}-done`, 300, reply.getId()!, {
            'io.mindroom.stream_status': 'completed',
          }).event,
        },
      })
    );
    expect(getThreadStreamingReplies(room, '$root')).toEqual([]);
  });
});

describe('useThreadStreamingState', () => {
  it('copies bundled edits shallowly without changing them and observes newer bundles', () => {
    const relationMap = new Map<string, MockRelations>();
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.stream_status': 'pending',
    });
    const attach = (id: string, ts: number, status: string) => {
      replyEvent.setUnsigned({
        'm.relations': {
          'm.replace': makeEditEvent(id, ts, '$reply', {
            'io.mindroom.stream_status': status,
          }).event,
        },
      });
    };
    attach('$streaming', 300, 'streaming');
    // An older live edit carries metadata the bundle lacks, so resolving the
    // bundled winner fills that metadata into its copy.
    const olderEdit = makeEditEvent('$older', 250, '$reply', {
      'io.mindroom.tool_trace': { version: 1, events: [] },
    });
    relationMap.set('$reply', Object.assign(makeRelations(), { getRelations: () => [olderEdit] }));
    const thread = makeThread({ lastReply: replyEvent, relationMap });
    const room = makeRoom({
      rootEventId: '$root',
      thread,
      roomTimelineSet: makeTimelineSet(relationMap, () => []),
    });
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      const streamingBundle = JSON.stringify(replyEvent.getUnsigned());
      expect(getThreadStreamingState(room, '$root')).toBe(true);
      expect(JSON.stringify(replyEvent.getUnsigned())).toBe(streamingBundle);
      attach('$completed', 400, 'completed');
      const bundle = JSON.stringify(replyEvent.getUnsigned());
      expect(getThreadStreamingState(room, '$root')).toBe(false);
      // Every record rebuild runs this check for each thread's tail.
      expect(clone).not.toHaveBeenCalled();
      expect(JSON.stringify(replyEvent.getUnsigned())).toBe(bundle);
    } finally {
      clone.mockRestore();
    }
  });

  it('returns true for ai_run streaming metadata', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('returns true when a stop reaction is added to the current last reply', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
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

  it("recognizes the backend's current 🛑 stop key as a streaming signal", () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '🛑', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['🛑', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('ignores a redacted stop reaction shell after reload', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const redactedStopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹', rel_type: 'm.annotation' },
    });
    vi.spyOn(redactedStopReaction, 'isRedacted').mockReturnValue(true);
    const relations = makeRelations();
    relations.setGroupedAnnotations([['⏹', new Set([redactedStopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('returns false when there is no streaming metadata or stop reaction', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('treats terminal metadata as stronger than a stale stop reaction', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'completed' },
    });
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹️', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['⏹️', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it("treats the 'cached' ai_run terminal status as ending the stream despite a stale 🛑", () => {
    // 'cached' is terminal only in the ai_run status set — a divergence from
    // TERMINAL_STREAM_STATUSES here would wedge a permanent spinner while
    // the stop chip (gated on the shared helper) is hidden.
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'cached' },
    });
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '🛑', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['🛑', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('reads the tail once for a burst of thread updates, as history loading sends', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const reply = makeThreadReplyEvent('$reply', 200);
    const thread = makeThread({ lastReply: reply, relationMap, timelineEvents: [reply] });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);
    const lookups = vi.mocked(thread.getUnfilteredTimelineSet().relations.getChildEventsForEvent);
    lookups.mockClear();

    act(() => {
      thread.emit(ThreadEvent.Update, thread);
    });
    const lookupsForOneUpdate = lookups.mock.calls.length;
    expect(lookupsForOneUpdate).toBeGreaterThan(0);
    lookups.mockClear();

    // The SDK sends one update for every event a page of older history adds.
    act(() => {
      for (let i = 0; i < 50; i += 1) thread.emit(ThreadEvent.Update, thread);
    });
    expect(lookups.mock.calls.length).toBe(lookupsForOneUpdate);
    expect(getSnapshot()).toBe(false);

    // An update the burst carries still shows.
    const streamingReply = makeThreadReplyEvent('$streaming', 300, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    act(() => {
      thread.setTimelineEvents([reply, streamingReply]);
      thread.setLastReply(streamingReply);
      for (let i = 0; i < 50; i += 1) thread.emit(ThreadEvent.Update, thread);
    });
    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('checks a thread it switches to again once it listens to it', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const first = makeThread({ lastReply: makeThreadReplyEvent('$first-reply', 200), relationMap });
    const quietReply = makeThreadReplyEvent('$second-reply', 200);
    const second = makeThread({ lastReply: quietReply, relationMap });
    const threads: Record<string, MockThread> = { $first: first, $second: second };
    const room = {
      getThread: (threadRootId: string) => threads[threadRootId],
      getUnfilteredTimelineSet: () => roomTimelineSet,
    } as unknown as Room;
    let latest: HookValue = false;
    // A reply of the new thread starts streaming after the switch rendered, before the hook
    // listens to that thread.
    function Switching({ threadRootId }: { threadRootId: string }) {
      latest = useThreadStreamingState(room, threadRootId);
      React.useLayoutEffect(() => {
        if (threadRootId !== '$second') return;
        const streaming = makeThreadReplyEvent('$second-streaming', 300, {
          'io.mindroom.ai_run': { version: 1, status: 'streaming' },
        });
        second.setTimelineEvents([quietReply, streaming]);
        second.setLastReply(streaming);
        second.emit(ThreadEvent.NewReply, second, streaming);
      }, [threadRootId]);
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(Switching, { threadRootId: '$first' }));
    });
    expect(latest).toBe(false);

    act(() => renderer!.update(React.createElement(Switching, { threadRootId: '$second' })));
    expect(latest).toBe(true);
    act(() => renderer!.unmount());
  });

  it('updates when the thread switches to a new streaming reply', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const firstReply = makeThreadReplyEvent('$reply-1', 200);
    const secondReply = makeThreadReplyEvent('$reply-2', 300, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const thread = makeThread({
      lastReply: firstReply,
      relationMap,
      timelineEvents: [firstReply],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    act(() => {
      thread.setTimelineEvents([firstReply, secondReply]);
      thread.setLastReply(secondReply);
      thread.emit(ThreadEvent.NewReply, thread, secondReply);
    });

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('updates when ai_run streaming metadata arrives via a replacement event', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const streamingEdit = makeEditEvent('$reply-edit', 300, '$reply', {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    act(() => {
      replyEvent.makeReplaced(streamingEdit);
    });

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('treats completed ai_run metadata on a replacement as stronger than stale raw streaming metadata', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const completedEdit = makeEditEvent('$reply-edit', 300, '$reply', {
      'io.mindroom.ai_run': { version: 1, status: 'completed' },
    });
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent, completedEdit],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    act(() => {
      replyEvent.makeReplaced(completedEdit);
    });

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('updates when stream_status changes to a terminal state via a replacement event', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.stream_status': 'active',
    });
    const completedEdit = makeEditEvent('$reply-edit', 300, '$reply', {
      'io.mindroom.stream_status': 'completed',
    });
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    act(() => {
      replyEvent.makeReplaced(completedEdit);
    });

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('returns true when a non-last reply in the scanned tail is streaming', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const firstReply = makeThreadReplyEvent('$reply-1', 200, {
      'io.mindroom.ai_run': { version: 1, status: 'streaming' },
    });
    const secondReply = makeThreadReplyEvent('$reply-2', 250);
    const thread = makeThread({
      lastReply: secondReply,
      relationMap,
      timelineEvents: [firstReply, secondReply],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    renderer.unmount();
  });

  it('updates when a stop reaction is added to a non-last reply in the scanned tail', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const firstReply = makeThreadReplyEvent('$reply-1', 200);
    const secondReply = makeThreadReplyEvent('$reply-2', 250);
    const stopReaction = makeMessageEvent('$reaction', 260, {
      'm.relates_to': { event_id: '$reply-1', key: '⏹', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relationMap.set('$reply-1', relations);

    const thread = makeThread({
      lastReply: secondReply,
      relationMap,
      timelineEvents: [firstReply, secondReply],
    });
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

  it('refreshes when a stop reaction is redacted away', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['⏹', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });
    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(true);

    act(() => {
      vi.spyOn(stopReaction, 'isRedacted').mockReturnValue(true);
      relations.emit(RelationsEvent.Redaction);
    });

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('ignores streaming metadata on messages older than the last 10 scanned thread messages', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replies = Array.from({ length: 11 }, (_, index) =>
      makeThreadReplyEvent(
        `$reply-${index + 1}`,
        200 + index,
        index === 0 ? { 'io.mindroom.ai_run': { version: 1, status: 'streaming' } } : {}
      )
    );
    const thread = makeThread({
      lastReply: replies[replies.length - 1],
      relationMap,
      timelineEvents: replies,
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });
  it('treats cancelled stream_status as terminal (no false positive with stop reaction)', () => {
    const relationMap = new Map<string, MockRelations>();
    const roomTimelineSet = makeTimelineSet(relationMap, () => []);
    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      'io.mindroom.stream_status': { status: 'cancelled' },
    });
    const stopReaction = makeMessageEvent('$reaction', 210, {
      'm.relates_to': { event_id: '$reply', key: '⏹️', rel_type: 'm.annotation' },
    });
    const relations = makeRelations();
    relations.setGroupedAnnotations([['⏹️', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({ rootEventId: '$root', thread, roomTimelineSet });

    const { getSnapshot, renderer } = renderHookHarness(room);

    expect(getSnapshot()).toBe(false);

    renderer.unmount();
  });

  it('tracks the early ai_run edit lifecycle across placeholder, approval pause, resume, and terminal notes', () => {
    const earlyAiRun = {
      version: 1,
      model: {
        config: 'gemini4_neon',
        display_name: 'Gemini 4 Neon',
        id: 'google/gemini-4-neon',
        provider: 'openrouter',
      },
    };
    const relationMap = new Map<string, MockRelations>();
    const loadedEdits: MatrixEvent[] = [];
    const stopReaction = makeMessageEvent('$stop-reaction', 205, {
      'm.relates_to': { event_id: '$reply', key: '🛑', rel_type: 'm.annotation' },
    });
    const relations = Object.assign(makeRelations(), { getRelations: () => loadedEdits });
    relations.setGroupedAnnotations([['🛑', new Set([stopReaction])]]);
    relationMap.set('$reply', relations);

    const replyEvent = makeThreadReplyEvent('$reply', 200, {
      body: 'Thinking...',
      'io.mindroom.stream_status': 'pending',
      'io.mindroom.ai_run': earlyAiRun,
    });
    const thread = makeThread({
      lastReply: replyEvent,
      relationMap,
      timelineEvents: [replyEvent],
    });
    const room = makeRoom({
      rootEventId: '$root',
      thread,
      roomTimelineSet: makeTimelineSet(relationMap, () => []),
    });

    const pushEdit = (id: string, ts: number, newContent: Record<string, unknown>) => {
      const edit = makeEditEvent(id, ts, '$reply', newContent);
      loadedEdits.push(edit);
      replyEvent.makeReplaced(edit);
    };

    // 1. Placeholder with early ai_run
    expect(getThreadStreamingState(room, '$root')).toBe(true);

    // 2. Progress edit with early ai_run
    pushEdit('$edit-progress', 220, {
      body: 'Working on it...',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.ai_run': earlyAiRun,
    });
    expect(getThreadStreamingState(room, '$root')).toBe(true);

    // 3. Approval pause edit (even with a stop reaction still present)
    pushEdit('$edit-approval', 240, {
      body: 'Waiting for approval...',
      'io.mindroom.stream_status': 'approval_pending',
      'io.mindroom.ai_run': earlyAiRun,
    });
    expect(getThreadStreamingState(room, '$root')).toBe(false);

    // 4. Resume streaming (including an edit carrying explicit streaming ai_run.status)
    pushEdit('$edit-resume', 260, {
      body: 'Resumed...',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.ai_run': { ...earlyAiRun, status: 'streaming' },
    });
    expect(getThreadStreamingState(room, '$root')).toBe(true);

    // 5a. Terminal stop note WITHOUT ai_run (borrows ai_run from earlier loaded edit via getEditedEvent)
    pushEdit('$edit-stop-borrowed', 280, {
      body: 'Stopped.',
      'io.mindroom.stream_status': 'cancelled',
    });
    expect(getThreadStreamingState(room, '$root')).toBe(false);

    // 5b. Terminal error note WITH ai_run
    pushEdit('$edit-error', 300, {
      body: 'Failed.',
      'io.mindroom.stream_status': 'error',
      'io.mindroom.ai_run': { ...earlyAiRun, status: 'error' },
    });
    expect(getThreadStreamingState(room, '$root')).toBe(false);

    // 5c. Terminal restart/interrupted note WITH ai_run
    pushEdit('$edit-interrupted', 320, {
      body: 'Interrupted by restart.',
      'io.mindroom.stream_status': 'cancelled',
      'io.mindroom.ai_run': { ...earlyAiRun, status: 'interrupted' },
    });
    expect(getThreadStreamingState(room, '$root')).toBe(false);
  });

  it('does not let an older cached finishing edit veto a newer revision whose run status is streaming', () => {
    const roomStub = { redactedBundledEdits: new Set<string>() };
    const mx = Object.assign(new EventEmitter(), {
      getRoom: () => roomStub,
    }) as unknown as MatrixClient;
    const stop = keepSyncedEdits(mx);
    try {
      const relationMap = new Map<string, MockRelations>();
      const timelineSet = makeTimelineSet(relationMap, () => []);
      const makeSyncedEdit = (
        id: string,
        ts: number,
        targetId: string,
        content: Record<string, unknown>
      ) => makeEditEvent(id, ts, targetId, content);

      // Case A: completed synced edit followed by a newer edit with ai_run.status === 'streaming'
      const replyA = makeThreadReplyEvent('$regen-a', 200, {
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
      });
      const finishA = makeSyncedEdit('$regen-a-done', 300, '$regen-a', {
        body: 'First answer',
        'io.mindroom.stream_status': 'completed',
        'io.mindroom.ai_run': { version: 1, status: 'completed' },
      });
      mx.emit(ClientEvent.Event, finishA);
      replyA.makeReplaced(finishA);
      expect(isEventStreaming(replyA, undefined, timelineSet as never)).toBe(false);

      const regenStreamingA = makeSyncedEdit('$regen-a-retry', 400, '$regen-a', {
        body: 'Retrying...',
        'io.mindroom.ai_run': { version: 1, status: 'streaming' },
      });
      mx.emit(ClientEvent.Event, regenStreamingA);
      replyA.makeReplaced(regenStreamingA);
      expect(isEventStreaming(replyA, undefined, timelineSet as never)).toBe(true);

      // Case B: redacted finishing edit with no newer edit still returns false
      const replyC = makeThreadReplyEvent('$redacted-finish', 200, {
        body: 'Streaming...',
        'io.mindroom.stream_status': 'streaming',
      });
      const finishC = makeSyncedEdit('$redacted-finish-done', 300, '$redacted-finish', {
        body: 'Done',
        'io.mindroom.stream_status': 'completed',
      });
      mx.emit(ClientEvent.Event, finishC);
      replyC.makeReplaced(finishC);
      finishC.makeRedacted(
        makeMessageEvent('$redaction-c', 310, { redacts: '$redacted-finish-done' }),
        {} as Parameters<MatrixEvent['makeRedacted']>[1]
      );
      replyC.makeReplaced();
      expect(isEventStreaming(replyC, undefined, timelineSet as never)).toBe(false);

      // Case C: streaming edit followed by terminal edit returns false
      const replyD = makeThreadReplyEvent('$stream-then-end', 200, {
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
      });
      const streamingD = makeSyncedEdit('$stream-then-end-1', 250, '$stream-then-end', {
        body: 'Working...',
        'io.mindroom.stream_status': 'streaming',
        'io.mindroom.ai_run': { version: 1, status: 'streaming' },
      });
      mx.emit(ClientEvent.Event, streamingD);
      replyD.makeReplaced(streamingD);
      expect(isEventStreaming(replyD, undefined, timelineSet as never)).toBe(true);

      const terminalD = makeSyncedEdit('$stream-then-end-2', 300, '$stream-then-end', {
        body: 'Stopped.',
        'io.mindroom.stream_status': 'cancelled',
      });
      mx.emit(ClientEvent.Event, terminalD);
      replyD.makeReplaced(terminalD);
      expect(isEventStreaming(replyD, undefined, timelineSet as never)).toBe(false);
    } finally {
      stop();
    }
  });
});

// `getEditedEvent` lends the edit a reply shows the metadata it lacks from the older edits, so what
// the edit says itself counts for more than what it borrowed: for the thread's spinner
// (`isEventStreaming`) as for the reply's own indicator (`isAiRunStreaming` of the shown content).
// Each reply here has a stale 🛑 unless the test says otherwise.
describe('a reply whose shown edit borrows metadata from its older edits', () => {
  const COMPLETED = { 'io.mindroom.stream_status': 'completed' };
  const STREAMING = { 'io.mindroom.stream_status': 'streaming' };
  const APPROVAL_PENDING = { 'io.mindroom.stream_status': 'approval_pending' };
  const EARLY_AI_RUN = { 'io.mindroom.ai_run': { version: 1, model: { config: 'gemini4_neon' } } };
  const runStatus = (status: string) => ({ 'io.mindroom.ai_run': { version: 1, status } });

  /** A reply, the edits the sync brings it, and those its relations hold. */
  const setup = (replyId: string, staleStopReaction = true) => {
    const roomStub = { redactedBundledEdits: new Set<string>() };
    const mx = Object.assign(new EventEmitter(), {
      getRoom: () => roomStub,
    }) as unknown as MatrixClient;
    keepSyncedEdits(mx);
    const loaded: MatrixEvent[] = [];
    const relations = Object.assign(makeRelations(), { getRelations: () => loaded });
    if (staleStopReaction) {
      const stopReaction = makeMessageEvent('$stop-reaction', 205, {
        'm.relates_to': { event_id: replyId, key: '🛑', rel_type: 'm.annotation' },
      });
      relations.setGroupedAnnotations([['🛑', new Set([stopReaction])]]);
    }
    const timelineSet = makeTimelineSet(new Map([[replyId, relations]]), () => []);
    const reply = makeThreadReplyEvent(replyId, 200, {
      body: 'Thinking...',
      'io.mindroom.stream_status': 'pending',
    });
    /** Puts `event` among the reply's loaded relations; the reply shows it. */
    const load = (event: MatrixEvent) => {
      loaded.push(event);
      reply.makeReplaced(event);
    };
    /** An edit the sync brings, which the reply's relations load too unless `syncedOnly`. */
    const edit = (
      id: string,
      ts: number,
      newContent: Record<string, unknown>,
      syncedOnly = false
    ) => {
      const event = makeEditEvent(id, ts, replyId, newContent);
      mx.emit(ClientEvent.Event, event);
      if (!syncedOnly) load(event);
      return event;
    };
    const isStreaming = () => isEventStreaming(reply, relations as never, timelineSet as never);
    /** Whether the reply's shown content says that it streams, as its message row reads it. */
    const isRunStreaming = () =>
      isAiRunStreaming(
        getLatestMessageContent(reply, getEditedEvent(replyId, reply, timelineSet as never))
      );
    return { edit, load, isStreaming, isRunStreaming };
  };

  it('streams again by the run status of a regenerated edit, though the finished edit is loaded', () => {
    const { edit, isStreaming, isRunStreaming } = setup('$regenerated');
    edit('$done', 300, { ...COMPLETED, ...runStatus('completed') });
    expect(isStreaming()).toBe(false);
    expect(isRunStreaming()).toBe(false);

    // The retry says that it streams by its run status alone; the `completed` it shows is borrowed.
    edit('$retry', 400, runStatus('streaming'));
    expect(isStreaming()).toBe(true);
    expect(isRunStreaming()).toBe(true);
  });

  it('streams again by the run status of a retry after a stop note', () => {
    const { edit, isStreaming, isRunStreaming } = setup('$retried-after-stop');
    edit('$stop-note', 300, { body: 'Stopped.', 'io.mindroom.stream_status': 'cancelled' });
    edit('$retry', 400, runStatus('streaming'));
    expect(isStreaming()).toBe(true);
    expect(isRunStreaming()).toBe(true);
  });

  it('streams again by the run status of a retry in the same millisecond as the finish', () => {
    const { edit, isStreaming, isRunStreaming } = setup('$tied');
    edit('$a-finish', 300, COMPLETED);
    expect(isStreaming()).toBe(false);

    edit('$z-retry', 300, runStatus('streaming'));
    expect(isStreaming()).toBe(true);
    expect(isRunStreaming()).toBe(true);
  });

  it('stays stopped by a stop note that borrows the streaming run of the edit before it', () => {
    const { edit, isStreaming, isRunStreaming } = setup('$stopped');
    edit('$progress', 300, runStatus('streaming'));
    expect(isStreaming()).toBe(true);
    expect(isRunStreaming()).toBe(true);

    edit('$stop-note', 400, { body: 'Stopped.', 'io.mindroom.stream_status': 'cancelled' });
    expect(isStreaming()).toBe(false);
    expect(isRunStreaming()).toBe(false);
  });

  it('stays finished through a later correction of its text', () => {
    const { edit, load, isStreaming } = setup('$corrected');
    const progress = edit('$progress', 250, { ...STREAMING, ...EARLY_AI_RUN }, true);
    expect(isStreaming()).toBe(true);
    // Only the sync knows the edit that finished the reply; its relations never load it.
    edit('$done', 300, COMPLETED, true);
    edit('$correction', 400, { body: 'Corrected text' });
    expect(isStreaming()).toBe(false);

    // Nor does the correction stream by the status it borrows from an edit before the finish.
    load(progress);
    expect(isStreaming()).toBe(false);
  });

  it('pauses for an approval, whichever run the pausing edit carries or borrows', () => {
    const borrowed = setup('$paused-borrowed-run');
    borrowed.edit('$progress', 300, { ...STREAMING, ...runStatus('streaming') });
    expect(borrowed.isStreaming()).toBe(true);
    borrowed.edit('$pause', 400, APPROVAL_PENDING);
    expect(borrowed.isStreaming()).toBe(false);
    expect(borrowed.isRunStreaming()).toBe(false);

    const { edit, isStreaming, isRunStreaming } = setup('$paused');
    edit('$pause', 300, { ...APPROVAL_PENDING, ...EARLY_AI_RUN });
    expect(isStreaming()).toBe(false);
    expect(isRunStreaming()).toBe(false);
    // A correction of the text borrows the pause.
    edit('$correction', 400, { body: 'Corrected text' });
    expect(isStreaming()).toBe(false);
    expect(isRunStreaming()).toBe(false);
    // A retry that says by its run status that it streams borrows it too, and streams.
    edit('$retry', 500, runStatus('streaming'));
    expect(isStreaming()).toBe(true);
    expect(isRunStreaming()).toBe(true);
  });

  it('streams by the stream status that an edit with another run status borrows', () => {
    const { edit, isStreaming } = setup('$running', false);
    edit('$progress', 300, STREAMING);
    edit('$running-run', 400, runStatus('running'));
    expect(isStreaming()).toBe(true);
  });
});
