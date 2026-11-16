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
  },
}));
vi.mock('../../threads/fork/useThreadForkPrefix', () => ({
  useThreadForkPrefix: () => forkPrefix.value,
}));
// While `gate` is pending, the thread's open waits on the server.
const opening = vi.hoisted(() => ({ gate: undefined as Promise<void> | undefined }));
vi.mock('../../threads/open/threadOpenSdkBootstrap', async (original) => {
  const actual = await original<typeof import('../../threads/open/threadOpenSdkBootstrap')>();
  return {
    ...actual,
    runThreadOpenSdkBootstrap: async (
      ...args: Parameters<typeof actual.runThreadOpenSdkBootstrap>
    ) => {
      await opening.gate;
      return actual.runThreadOpenSdkBootstrap(...args);
    },
  };
});
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

describe('a fork draft', () => {
  it('shows the thread up to its fork point, read-only, with the Forking divider under that row', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const { Message } = await import('../../messages/Message');
    const root = makeEvent('$parent', { isThreadRoot: true, ts: 1_000 });
    const a = makeEvent('$a', { threadRootId: '$parent', ts: 2_000 });
    const b = makeEvent('$b', { threadRootId: '$parent', ts: 3_000 });
    const later = makeEvent('$later', { threadRootId: '$parent', ts: 4_000 });
    forkPrefix.value = { events: [], parent: undefined };
    const rows = [root, a, b];
    const timeline = makeTimeline([root, a, b, later], { backwardToken: null });
    const timelineSet = {
      getLiveTimeline: () => timeline,
      getTimelineForEvent: () => undefined,
    };
    const room = makeRoom({ liveEvents: [root] });
    room.getThread = () =>
      ({
        rootEvent: root,
        events: [a, b, later],
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    // The render state cut the thread at $b; its own events stay whole.
    threadRenderStateMock.threadEvents = rows as never;
    threadRenderStateMock.ownThreadEvents = [...rows, later] as never;
    threadRenderStateMock.forkPointIndex = 2;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      rows.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = rows.map((_, index) => index);
    const onForkPointShown = vi.fn();
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(Harness, {
            room,
            threadId: '$parent',
            forkAt: '$b',
            onForkPointShown,
          })
        );
        await flushAsyncWork();
      });

      const dividers = renderer!.root
        .findAll((node) => node.type === 'div' && node.props['data-virtual-index'] !== undefined)
        .map((tile: ReactTestInstance) => [
          tile.props['data-virtual-index'],
          tile
            .findAll((node) => (node.type as unknown) === 'fork-divider')
            .map((divider) => divider.props.variant),
        ]);
      expect(dividers).toEqual([
        [0, []],
        [1, []],
        [2, ['forking']],
      ]);
      const divider = renderer!.root.find((node) => (node.type as unknown) === 'fork-divider');
      expect(divider.props.parent).toEqual({ threadId: '$parent', eventId: '$b' });
      expect(onForkPointShown).toHaveBeenLastCalledWith('$b');

      // What the fork will show of its parent, as the fork shows it: nothing to answer here.
      const messages = renderer!.root.findAllByType(Message);
      expect(messages).toHaveLength(3);
      messages.forEach(({ props }) => {
        expect(props.onReplyClick).toBeUndefined();
        expect(props.onOpenInOriginalThread).toBeDefined();
      });
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('says it shows no fork point once the thread opened without it, and not before', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const root = makeEvent('$parent', { isThreadRoot: true, ts: 1_000 });
    forkPrefix.value = { events: [], parent: undefined };
    const timeline = makeTimeline([root], { backwardToken: null });
    const room = makeRoom({ liveEvents: [root] });
    room.getThread = () =>
      ({
        rootEvent: root,
        events: [],
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => timeline,
          getTimelineForEvent: () => undefined,
        }),
      } as never);
    threadRenderStateMock.threadEvents = [root] as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map([['$parent', 0]]);
    roomTimelineVirtualizerState.virtualIndexes = [0];
    const onForkPointShown = vi.fn();
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    let open: () => void = () => undefined;
    opening.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    try {
      await act(async () => {
        renderer = create(
          React.createElement(Harness, {
            room,
            threadId: '$parent',
            forkAt: '$elsewhere',
            onForkPointShown,
          })
        );
        await flushAsyncWork();
      });
      // The point may still come with the thread's loads.
      expect(onForkPointShown).not.toHaveBeenCalled();

      await act(async () => {
        open();
        await flushAsyncWork();
      });
      expect(renderer!.root.findAll((node) => (node.type as unknown) === 'fork-divider')).toEqual(
        []
      );
      expect(onForkPointShown).toHaveBeenLastCalledWith(undefined);
    } finally {
      opening.gate = undefined;
      act(() => renderer?.unmount());
    }
  });

  it('waits for its own open after switching from a thread that already opened', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const root = makeEvent('$parent', { isThreadRoot: true, ts: 1_000 });
    const other = makeEvent('$other', { isThreadRoot: true, ts: 2_000 });
    forkPrefix.value = { events: [], parent: undefined };
    const timeline = makeTimeline([root, other], { backwardToken: null });
    const room = makeRoom({ liveEvents: [root, other] });
    room.getThread = (id: string) =>
      ({
        rootEvent: id === '$other' ? other : root,
        events: [],
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => timeline,
          getTimelineForEvent: () => undefined,
        }),
      } as never);
    threadRenderStateMock.threadEvents = [root] as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map([['$parent', 0]]);
    roomTimelineVirtualizerState.virtualIndexes = [0];
    const onForkPointShown = vi.fn();
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;
    let open: () => void = () => undefined;
    try {
      // The previous thread opened in this same view.
      await act(async () => {
        renderer = create(
          React.createElement(Harness, { room, threadId: '$other', onForkPointShown })
        );
        await flushAsyncWork();
      });
      opening.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      await act(async () => {
        renderer!.update(
          React.createElement(Harness, {
            room,
            threadId: '$parent',
            forkAt: '$elsewhere',
            onForkPointShown,
          })
        );
        await flushAsyncWork();
      });
      // The previous thread's settled open says nothing about this one.
      expect(onForkPointShown).not.toHaveBeenCalled();

      await act(async () => {
        open();
        await flushAsyncWork();
      });
      expect(onForkPointShown).toHaveBeenLastCalledWith(undefined);
    } finally {
      opening.gate = undefined;
      act(() => renderer?.unmount());
    }
  });
});
