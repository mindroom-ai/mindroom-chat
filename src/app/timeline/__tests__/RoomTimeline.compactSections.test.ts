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
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const renderCompact = async (extraProps: Record<string, unknown>) => {
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
        extraProps,
      })
    );
    await flushAsyncWork(5);
  });
  if (!renderer) throw new Error('the room timeline did not render');
  const bar = () => renderer!.root.findByType(roomThreadOverviewType).props;
  const cards = () => renderer!.root.findAllByType(compactPlaceholderType)[0]?.props;
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
    expect(typeof cards()?.sectionsNow).toBe('number');
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
    expect(cards()?.sectionsNow).toBeUndefined();
    act(() => renderer.unmount());
  });
});
