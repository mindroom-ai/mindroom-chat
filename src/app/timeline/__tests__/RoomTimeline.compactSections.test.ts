import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
// First, for the doubles it puts in place of the hooks the modules below read.
import {
  compactPlaceholderType,
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
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
});
