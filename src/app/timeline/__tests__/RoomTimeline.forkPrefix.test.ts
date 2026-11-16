import React from 'react';
import { act, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomTimelineVirtualizerState,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const forkPrefix = vi.hoisted(() => ({
  value: {
    events: [] as unknown[],
    parent: undefined as { threadId: string; eventId: string } | undefined,
    complete: true,
    loading: false,
  },
}));
vi.mock('../../threads/fork/useThreadForkPrefix', () => ({
  useThreadForkPrefix: () => forkPrefix.value,
}));
vi.mock('../../threads/fork/ThreadForkDivider', async () => {
  const ReactImport = await import('react');
  return {
    ThreadForkDivider: (props: Record<string, unknown>) =>
      ReactImport.createElement('fork-divider', props),
  };
});

importBeforeTests(() => import('../RoomTimeline'));

const summary = (id: string, threadRootId: string, text: string, ts: number) =>
  makeEvent(id, {
    threadRootId,
    ts,
    content: {
      msgtype: 'm.notice',
      body: text,
      'io.mindroom.thread_summary': { version: 1, summary: text, message_count: 2 },
    },
  });

describe('a forked thread', () => {
  it("shows the parent's messages above its own, the divider over its root, and counts only its own", async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const parentRoot = makeEvent('$parent', { isThreadRoot: true, ts: 1_000 });
    const prefix = [
      parentRoot,
      makeEvent('$p1', { threadRootId: '$parent', ts: 2_000 }),
      summary('$p2', '$parent', 'Lisbon trip', 2_500),
    ];
    const root = makeEvent('$fork', {
      ts: 3_000,
      content: {
        body: 'What about Porto?',
        'io.mindroom.fork': { thread_id: '$parent', event_id: '$p2' },
      },
    });
    const reply = makeEvent('$r1', { threadRootId: '$fork', ts: 4_000 });
    const own = [root, reply];
    const rows = [...prefix, ...own];
    forkPrefix.value = {
      events: prefix,
      parent: { threadId: '$parent', eventId: '$p2' },
      complete: true,
      loading: false,
    };
    const timeline = makeTimeline(own, { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [root] });
    room.getThread = () =>
      ({
        rootEvent: root,
        events: [reply],
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    threadRenderStateMock.threadEvents = rows as never;
    threadRenderStateMock.ownThreadEvents = own as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      rows.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = rows.map((_, index) => index);
    const onStoreThreadSummary = vi.fn();
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(Harness, { room, threadId: '$fork', onStoreThreadSummary })
        );
        await flushAsyncWork();
      });

      // Each tile: its row's message and whether the divider sits above it.
      const tiles = renderer!.root
        .findAll((node) => node.type === 'div' && node.props['data-virtual-index'] !== undefined)
        .map((tile: ReactTestInstance) => [
          tile.props['data-virtual-index'],
          tile.findAll((node) => (node.type as unknown) === 'fork-divider').length,
        ]);
      expect(tiles).toEqual([
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 1],
        [4, 0],
      ]);
      const divider = renderer!.root.find((node) => (node.type as unknown) === 'fork-divider');
      expect(divider.props.parent).toEqual({ threadId: '$parent', eventId: '$p2' });
      expect(divider.props.root).toBe(parentRoot);

      // The fork's title and count come from its own messages, never from the parent's.
      const stored = onStoreThreadSummary.mock.calls.filter(([threadId]) => threadId === '$fork');
      expect(stored.length).toBeGreaterThan(0);
      const storedInfos = stored.flatMap(
        ([, ...infos]) => infos as (ThreadSummaryInfo | undefined)[]
      );
      expect(storedInfos.some((info) => info?.summaryText === 'Lisbon trip')).toBe(false);
    } finally {
      act(() => renderer?.unmount());
    }
  });
});
