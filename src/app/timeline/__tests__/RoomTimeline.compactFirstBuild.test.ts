import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// First, for the doubles it puts in place of the hooks the modules below read.
import {
  compactPlaceholderType,
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

vi.mock('../../threads/overview/threadIndexRecords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../threads/overview/threadIndexRecords')>();
  return { buildThreadIndexRecordMaps: vi.fn(actual.buildThreadIndexRecordMaps) };
});

// eslint-disable-next-line import/first
import { buildThreadIndexRecordMaps } from '../../threads/overview/threadIndexRecords';

/** Mounts the room's list as it mounts when a thread that filled the page closes. */
const mountList = async (initialViewMode: 'compact' | 'threaded') => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
  const root = makeEvent('$root', { isThreadRoot: true });
  const room = makeRoom({
    liveEvents: [root],
    threads: [{ id: root.getId(), rootEvent: root }] as never,
  });
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(React.createElement(ControlledRoomTimeline, { room, initialViewMode }));
    await flushAsyncWork(5);
  });
  if (!renderer) throw new Error('the room timeline did not render');
  const builds = vi.mocked(buildThreadIndexRecordMaps).mock;
  return {
    renderer,
    /** The order of the list's first build of its records among the test's calls. */
    firstBuild: builds.invocationCallOrder[0] ?? Infinity,
    /** Builds of every record: those that keep none from a build before. */
    wholeBuilds: builds.calls.filter(([{ previous }]) => !previous).length,
    /** The maps of those builds. */
    wholeMaps: builds.results.filter((_, call) => !builds.calls[call]?.[0].previous),
    /** The order of the first listener put on the room: the overview's are the first. */
    firstListener: vi.mocked(room.on).mock.invocationCallOrder[0] ?? Infinity,
  };
};

importBeforeTests(() => import('../RoomTimeline'));

beforeEach(() => {
  vi.mocked(buildThreadIndexRecordMaps).mockClear();
});

describe("RoomTimeline's first build of the thread records", () => {
  it('follows the start of the listeners in a list that mounts in Compact, and is its only one', async () => {
    const list = await mountList('compact');

    expect(list.firstListener).toBeLessThan(list.firstBuild);
    // The count of the listeners' start lets the list build: it builds nothing over again.
    expect(list.wholeBuilds).toBe(1);
    // That build makes the record of a thread both of its maps list once.
    const { normalThreadRecordMap, compactThreadRecordMap } = list.wholeMaps[0]?.value ?? {};
    expect(compactThreadRecordMap?.get('$root')?.presentation).toBeDefined();
    expect(compactThreadRecordMap?.get('$root')?.presentation).toBe(
      normalThreadRecordMap?.get('$root')?.presentation
    );
    expect(list.renderer.root.findAll((node) => node.type === compactPlaceholderType)).toHaveLength(
      1
    );
    act(() => list.renderer.unmount());
  });

  it('comes with the first render of a list of the Threads view, before its listeners', async () => {
    const list = await mountList('threaded');

    expect(list.firstBuild).toBeLessThan(list.firstListener);
    act(() => list.renderer.unmount());
  });
});
