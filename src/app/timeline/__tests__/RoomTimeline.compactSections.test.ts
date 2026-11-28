import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
// First, for the doubles it puts in place of the hooks the modules below read.
import {
  Direction,
  compactPlaceholderType,
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomThreadOverviewType,
} from '../test-utils/RoomTimeline.test.shared';
import {
  createDefaultThreadFilterState,
  selectThreadWorkflowTab,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const renderCompact = async (
  extraProps: Record<string, unknown>,
  initialThreadFilterState?: ThreadFilterState
) => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  const root = makeEvent('$root', { isThreadRoot: true });
  const room = makeRoom({
    liveEvents: [root],
    threads: [{ id: root.getId(), rootEvent: root }] as never,
  });
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
        initialViewMode: 'compact',
        initialThreadFilterState,
        extraProps,
      })
    );
    await flushAsyncWork(5);
  });
  if (!renderer) throw new Error('the room timeline did not render');
  const bar = () => renderer!.root.findByType(roomThreadOverviewType).props;
  const cards = () => renderer!.root.findByType(compactPlaceholderType).props;
  return { renderer, bar, cards };
};

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline Compact sections wiring', () => {
  it('offers the switch in an agent room and gives the cards the snooze clock of the list', async () => {
    const onToggleThreadSections = vi.fn();
    const { renderer, bar, cards } = await renderCompact({
      threadSections: true,
      onToggleThreadSections,
    });

    expect(bar().threadSections).toBe(true);
    expect(bar().onToggleThreadSections).toBe(onToggleThreadSections);
    expect(typeof cards().sectionsNow).toBe('number');
    act(() => renderer.unmount());
  });

  it('offers no switch and shows no sections in a room without agents', async () => {
    const { renderer, bar, cards } = await renderCompact({
      hasMindroomAgents: false,
      threadSections: true,
      onToggleThreadSections: vi.fn(),
    });

    expect(bar().threadSections).toBe(false);
    expect(bar().onToggleThreadSections).toBeUndefined();
    expect(cards().sectionsNow).toBeUndefined();
    act(() => renderer.unmount());
  });

  it.each(['done', 'working'] as const)(
    'passes singleBucketTab=%s for a single-bucket workflow tab when sections are shown',
    async (tab) => {
      const { renderer, cards } = await renderCompact(
        { threadSections: true, onToggleThreadSections: vi.fn() },
        selectThreadWorkflowTab(createDefaultThreadFilterState(), tab)
      );

      expect(cards().singleBucketTab).toBe(tab);
      act(() => renderer.unmount());
    }
  );

  it('leaves singleBucketTab undefined for the All tab and when no workflow tab is active', async () => {
    const allView = await renderCompact(
      { threadSections: true, onToggleThreadSections: vi.fn() },
      selectThreadWorkflowTab(createDefaultThreadFilterState(), 'all')
    );
    expect(allView.cards().singleBucketTab).toBeUndefined();
    act(() => allView.renderer.unmount());

    const untabbedView = await renderCompact(
      { threadSections: true, onToggleThreadSections: vi.fn() },
      createDefaultThreadFilterState()
    );
    expect(untabbedView.cards().singleBucketTab).toBeUndefined();
    act(() => untabbedView.renderer.unmount());
  });

  it('leaves singleBucketTab undefined when threadSections is false or hasMindroomAgents is false', async () => {
    const doneFilter = selectThreadWorkflowTab(createDefaultThreadFilterState(), 'done');

    const sectionsOff = await renderCompact(
      { threadSections: false, onToggleThreadSections: vi.fn() },
      doneFilter
    );
    expect(sectionsOff.cards().singleBucketTab).toBeUndefined();
    act(() => sectionsOff.renderer.unmount());

    const agentless = await renderCompact(
      { hasMindroomAgents: false, threadSections: true, onToggleThreadSections: vi.fn() },
      doneFilter
    );
    expect(agentless.cards().singleBucketTab).toBeUndefined();
    act(() => agentless.renderer.unmount());
  });

  it("wires threadColumns into the toolbar and CompactRoomView on All/untabbed views, and hides on single-bucket tabs", async () => {
    const onToggleThreadColumns = vi.fn();
    const wide = await renderCompact({
      threadSections: true,
      onToggleThreadSections: vi.fn(),
      threadColumns: true,
      onToggleThreadColumns,
    });
    expect(wide.bar().threadColumns).toBe(true);
    expect(wide.bar().onToggleThreadColumns).toBe(onToggleThreadColumns);
    expect(wide.cards().columnsMode).toBe(true);
    act(() => wide.renderer.unmount());

    const singleTab = await renderCompact(
      {
        threadSections: true,
        onToggleThreadSections: vi.fn(),
        threadColumns: true,
        onToggleThreadColumns,
      },
      selectThreadWorkflowTab(createDefaultThreadFilterState(), "done")
    );
    expect(singleTab.bar().threadColumns).toBe(false);
    expect(singleTab.bar().onToggleThreadColumns).toBeUndefined();
    expect(singleTab.cards().columnsMode).toBe(false);
    act(() => singleTab.renderer.unmount());
  });

  it('stops compact history pagination after 1 call on a terminal empty page without RoomSurface re-rendering', async () => {
    const { CompactRoomSurface } = await import('../CompactRoomSurface');
    const root = makeEvent('$root', { isThreadRoot: true });
    const firstRoomTimeline = makeTimeline([root], { backwardToken: 'page-1' });
    const room = makeRoom({
      liveTimeline: firstRoomTimeline,
      threads: [{ id: root.getId(), rootEvent: root }] as never,
    });
    const paginateRoom = vi.fn(async () => {
      // Terminal empty page: SDK clears backward token without adding events or re-rendering RoomSurface.
      firstRoomTimeline.setPaginationToken(null, Direction.Backward);
    });

    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const view = {
      scrollTop: 100,
      scrollHeight: 600,
      clientHeight: 600,
      hasAttribute: () => false,
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (event: unknown) => void) => {
        listeners.get(type)?.delete(fn);
      },
    };
    const host = {
      querySelector: (selector: string) => (selector === '[data-compact-room-view]' ? view : null),
    };

    // Match browser frame timing: React commits setPagesSettled before the next animation frame runs.
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    let nextFrameId = 1;
    const queuedFrames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      queuedFrames.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      queuedFrames.delete(id);
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      const frozenState = {
        env: { navigateRoomThread: vi.fn() },
        firstRoomTimeline,
        roomHasMoreCachedBack: false,
        paginateRoom,
        threadIndex: {
          compactOverviewOrdering: { displayOrderedIds: ['$root'] },
          compactThreadRecordMap: new Map(),
          threadListLoading: false,
          threadSortControlSignature: 'default',
          snoozeNow: Date.now(),
        },
        trusted: { canCompose: true },
        filterBar: null,
        filterBarShown: false,
        roomStyle: {},
        hydrating: false,
        clientCatchingUp: false,
        threadSectionsShown: false,
      };
      await act(async () => {
        renderer = create(
          React.createElement(CompactRoomSurface, {
            props: {
              room: room as never,
              summaryMap: new Map(),
              onStoreThreadSummary: vi.fn(),
              threadFilterState: createDefaultThreadFilterState(),
              viewMode: 'compact',
              editor: {} as never,
            },
            state: frozenState as never,
          }),
          {
            createNodeMock: (element) => {
              const { props } = element;
              return element.type === 'div' &&
                typeof props === 'object' &&
                props !== null &&
                'direction' in props &&
                props.direction === 'Column'
                ? host
                : null;
            },
          }
        );
        await flushAsyncWork();
      });

      await act(async () => {
        listeners.get('wheel')?.forEach((fn) => fn({ deltaY: 100 }));
        await flushAsyncWork();
      });
      // Drain up to 5 frames in separate act() turns so each commit settles before the next frame.
      for (let frame = 0; frame < 5 && queuedFrames.size > 0; frame += 1) {
        const callbacks = [...queuedFrames.values()];
        queuedFrames.clear();
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          callbacks.forEach((cb) => cb(0));
          await flushAsyncWork();
        });
      }

      expect(paginateRoom).toHaveBeenCalledTimes(1);
    } finally {
      act(() => renderer?.unmount());
      vi.stubGlobal('requestAnimationFrame', originalRaf);
      vi.stubGlobal('cancelAnimationFrame', originalCancelRaf);
    }
  });
});
