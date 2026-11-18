import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomTimelineVirtualizerState,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const threadId = '$root';
const summary = (id: string, text: string, ts: number) =>
  makeEvent(id, {
    threadRootId: threadId,
    ts,
    content: {
      msgtype: 'm.notice',
      body: text,
      'io.mindroom.thread_summary': { version: 1, summary: text, message_count: 1 },
    },
  });

importBeforeTests(() => import('../RoomTimeline'));

describe('thread summary markers', () => {
  it('hides a repeated summary and marks the others in an open thread', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const { ThreadSummaryMarker } = await import(
      '../../messages/thread-summary/ThreadSummaryMarker'
    );
    const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
    const events = [
      rootEvent,
      makeEvent('$r1', { threadRootId: threadId, ts: 2_000 }),
      summary('$s1', 'Push bug', 3_000),
      makeEvent('$r2', { threadRootId: threadId, ts: 4_000 }),
      summary('$s2', 'Push bug', 5_000),
      summary('$s3', 'Fixing token refresh', 6_000),
    ];
    const timeline = makeTimeline(events, { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [rootEvent] });
    room.getThread = () =>
      ({
        rootEvent,
        events: events.slice(1),
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    threadRenderStateMock.threadEvents = events as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      events.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = [1, 2, 3, 4, 5];
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });

      expect(getRenderedEventIds(renderer!)).toEqual(['$r1', '$s1', '$r2', '$s3']);
      // Whether the first counts as the thread's first depends on the session's
      // history state, which the planner's own tests cover.
      expect(
        renderer!.root
          .findAllByType(ThreadSummaryMarker)
          .map((node) => node.props.plan?.previousSummaryText)
      ).toEqual([undefined, 'Push bug']);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('keeps a repeated summary visible after the route that opened it moves on', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
    const events = [
      rootEvent,
      summary('$s1', 'Push bug', 2_000),
      makeEvent('$r1', { threadRootId: threadId, ts: 3_000 }),
      summary('$s2', 'Push bug', 4_000),
    ];
    const timeline = makeTimeline(events, { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [rootEvent] });
    room.getThread = () =>
      ({
        rootEvent,
        events: events.slice(1),
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    threadRenderStateMock.threadEvents = events as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      events.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = [1, 2, 3];
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId, eventId: '$s2' }));
        await flushAsyncWork();
      });
      expect(getRenderedEventIds(renderer!)).toEqual(['$s1', '$r1', '$s2']);

      await act(async () => {
        renderer!.update(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });
      expect(getRenderedEventIds(renderer!)).toEqual(['$s1', '$r1', '$s2']);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('compares a summary by its latest edit, as its row shows it', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const { ThreadSummaryMarker } = await import(
      '../../messages/thread-summary/ThreadSummaryMarker'
    );
    const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
    const edited = summary('$s2', 'Push bug', 3_000);
    // The shared fixture's getEditedEvent returns this, as the SDK's replacement.
    Object.assign(edited, {
      __editedEvent: {
        getContent: () => ({
          'm.new_content': {},
          msgtype: 'm.notice',
          body: 'Token refresh',
          'io.mindroom.thread_summary': { version: 1, summary: 'Token refresh' },
        }),
      },
    });
    const events = [
      rootEvent,
      summary('$s1', 'Push bug', 2_000),
      makeEvent('$r1', { threadRootId: threadId, ts: 2_500 }),
      edited,
    ];
    const timeline = makeTimeline(events, { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [rootEvent] });
    room.getThread = () =>
      ({
        rootEvent,
        events: events.slice(1),
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    threadRenderStateMock.threadEvents = events as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      events.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = [1, 2, 3];
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });

      expect(getRenderedEventIds(renderer!)).toEqual(['$s1', '$r1', '$s2']);
      expect(
        renderer!.root
          .findAllByType(ThreadSummaryMarker)
          .map((node) => node.props.plan?.previousSummaryText)
      ).toEqual([undefined, 'Push bug']);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('shows a title and the skill review notice after it side by side in one row', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const { ThreadSummaryMarker } = await import(
      '../../messages/thread-summary/ThreadSummaryMarker'
    );
    const { SkillReviewMarker } = await import('../../messages/SkillReviewMarker');
    const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
    const review = makeEvent('$review', {
      threadRootId: threadId,
      ts: 4_000,
      sender: '@mindroom_code:example.org',
      content: {
        msgtype: 'm.notice',
        body: 'Skill review: updated `developing-mindroom-chat`',
        'io.mindroom.skill_review': { changes: { 'developing-mindroom-chat': 'updated' } },
      },
    });
    const events = [
      rootEvent,
      makeEvent('$r1', { threadRootId: threadId, ts: 2_000 }),
      summary('$s1', 'Push bug', 3_000),
      review,
    ];
    const timeline = makeTimeline(events, { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [rootEvent] });
    room.getThread = () =>
      ({
        rootEvent,
        events: events.slice(1),
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    threadRenderStateMock.threadEvents = events as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      events.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = [1, 2, 3];
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });

      expect(getRenderedEventIds(renderer!)).toEqual(['$r1', '$s1', '$review']);
      const runs = renderer!.root.findAll(
        (node) => node.type === 'div' && node.props['data-quiet-marker-run'] === 'true'
      );
      expect(runs).toHaveLength(1);
      const [run] = runs;
      expect(
        run!
          .findAll((node) => typeof node.props['data-message-id'] === 'string')
          .map((node) => node.props['data-message-id'] as string)
      ).toEqual(['$s1', '$review']);
      expect(run!.findAllByType(ThreadSummaryMarker)).toHaveLength(1);
      expect(run!.findAllByType(SkillReviewMarker)).toHaveLength(1);
      // Each marker renders once: the title's own row folds into the run's row.
      expect(renderer!.root.findAllByType(ThreadSummaryMarker)).toHaveLength(1);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  /** A thread whose events the test may add to before rendering again. */
  const mountThread = (events: ReturnType<typeof makeEvent>[]) => {
    const timeline = makeTimeline(events, { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [events[0]!] });
    room.getThread = () =>
      ({
        rootEvent: events[0],
        events: events.slice(1),
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    const show = () => {
      threadRenderStateMock.threadEvents = [...events] as never;
      threadRenderStateMock.threadEventIndexMapRef.current = new Map(
        events.map((event, index) => [event.getId(), index])
      );
      roomTimelineVirtualizerState.virtualIndexes = events.slice(1).map((_, index) => index + 1);
    };
    return { room, show };
  };
  const agentNotice = (id: string, ts: number, content: Record<string, unknown>) =>
    makeEvent(id, {
      threadRootId: threadId,
      ts,
      sender: '@mindroom_code:example.org',
      content: { msgtype: 'm.notice', body: id, ...content },
    });
  const quietRuns = (renderer: ReturnType<typeof create>) =>
    renderer.root
      .findAll((node) => node.type === 'div' && node.props['data-quiet-marker-run'] === 'true')
      .map((run) =>
        run
          .findAll((node) => typeof node.props['data-message-id'] === 'string')
          .map((node) => node.props['data-message-id'] as string)
      );

  it('keeps the title marker mounted when a skill review notice joins it', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const events = [
      makeEvent(threadId, { isThreadRoot: true, ts: 1_000 }),
      makeEvent('$r1', { threadRootId: threadId, ts: 2_000 }),
      summary('$s1', 'Push bug', 3_000),
    ];
    const { room, show } = mountThread(events);
    // Each marker trigger the renderer mounts, by the description it points at.
    const mounted: string[] = [];
    const createNodeMock = (element: React.ReactElement) => {
      const props = element.props as Record<string, unknown>;
      if (element.type === 'button' && typeof props['aria-describedby'] === 'string') {
        mounted.push(props['aria-describedby']);
      }
      // As the renderer does without a mock: no element behind other refs.
      return null;
    };
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      show();
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId }), { createNodeMock });
        await flushAsyncWork();
      });
      expect(quietRuns(renderer!)).toEqual([]);
      expect(mounted).toHaveLength(1);

      events.push(
        agentNotice('$review', 4_000, {
          'io.mindroom.skill_review': { changes: { 'developing-mindroom-chat': 'updated' } },
        })
      );
      show();
      await act(async () => {
        renderer!.update(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });
      expect(quietRuns(renderer!)).toEqual([['$s1', '$review']]);
      // Only the new marker's trigger mounted: the title's stayed in place.
      expect(mounted).toHaveLength(2);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('keeps a snooze ending on its own row beside a title', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const { SnoozeEndedMarker } = await import('../../messages/SnoozeEndedMarker');
    const events = [
      makeEvent(threadId, { isThreadRoot: true, ts: 1_000 }),
      makeEvent('$r1', { threadRootId: threadId, ts: 2_000 }),
      summary('$s1', 'Push bug', 3_000),
      agentNotice('$wake', 4_000, {
        msgtype: 'm.text',
        'io.mindroom.thread_snooze': { event: 'ended', until: '2026-11-13T09:00:00Z' },
      }),
    ];
    const { room, show } = mountThread(events);
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      show();
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });
      expect(getRenderedEventIds(renderer!)).toEqual(['$r1', '$s1', '$wake']);
      expect(renderer!.root.findAllByType(SnoozeEndedMarker)).toHaveLength(1);
      expect(quietRuns(renderer!)).toEqual([]);
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('keeps a compaction notice on its own row between a title and skill reviews', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const { CompactionNoticeSeam } = await import('../../messages/agent-run/CompactionSeam');
    const review = {
      'io.mindroom.skill_review': { changes: { 'developing-mindroom-chat': 'updated' } },
    };
    const events = [
      makeEvent(threadId, { isThreadRoot: true, ts: 1_000 }),
      makeEvent('$r1', { threadRootId: threadId, ts: 2_000 }),
      summary('$s1', 'Push bug', 3_000),
      agentNotice('$review', 4_000, review),
      agentNotice('$seam', 5_000, {
        'io.mindroom.compaction': {
          version: 3,
          mode: 'manual',
          status: 'success',
          before_tokens: 366_804,
          after_tokens: 6336,
          history_budget_tokens: 351_792,
        },
      }),
      agentNotice('$review2', 6_000, review),
    ];
    const { room, show } = mountThread(events);
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      show();
      await act(async () => {
        renderer = create(React.createElement(Harness, { room, threadId }));
        await flushAsyncWork();
      });
      expect(getRenderedEventIds(renderer!)).toEqual([
        '$r1',
        '$s1',
        '$review',
        '$seam',
        '$review2',
      ]);
      expect(renderer!.root.findAllByType(CompactionNoticeSeam)).toHaveLength(1);
      // The seam joins no run and ends the one before it: the review after it stands alone.
      expect(quietRuns(renderer!)).toEqual([['$s1', '$review']]);
    } finally {
      act(() => renderer?.unmount());
    }
  });
});
