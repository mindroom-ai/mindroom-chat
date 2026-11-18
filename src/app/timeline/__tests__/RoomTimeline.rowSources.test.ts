import { RoomEvent, RoomMemberEvent } from 'matrix-js-sdk';
import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  roomTimelineVirtualizerState,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

// A row reads its event from the SDK as it renders, and renders again when one of the list's
// sources is another (timelineRowMemo.test.tsx). These are the sources the timeline gives its
// list: each thing that tells of a change gives another one, and a render of the timeline's own
// that tells of none gives the same. (The rows themselves cannot show it here: this harness's
// stand-ins hand them new thread records on every render.)

const given = vi.hoisted(() => ({ sources: [] as (readonly unknown[])[] }));
vi.doMock('../roomTimelineRows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../roomTimelineRows')>();
  return {
    ...actual,
    renderTimelineTiles: (options: Parameters<typeof actual.renderTimelineTiles>[0]) => {
      given.sources.push(options.rowSources);
      return actual.renderTimelineTiles(options);
    },
  };
});

// The shared stand-ins of these two give a new value on every render; the room's own change
// only with its state.
const power = vi.hoisted(() => ({ levels: {}, creators: new Set<string>() }));
vi.doMock('../../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/usePowerLevels')>()),
  usePowerLevelsContext: () => power.levels,
}));
vi.doMock('../../matrix/hooks/useRoomCreators', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/useRoomCreators')>()),
  useRoomCreators: () => power.creators,
}));

importBeforeTests(() => import('../RoomTimeline'));

/** Whether the last render gave its rows a source other than the render before `act` did. */
const changesSources = async (act_: () => void | Promise<void>): Promise<boolean> => {
  const before = given.sources.at(-1)!;
  const renders = given.sources.length;
  await act(async () => {
    await act_();
    await flushAsyncWork(2);
  });
  const after = given.sources.at(-1)!;
  expect(given.sources.length, 'the timeline rendered').toBeGreaterThan(renders);
  return after.length !== before.length || after.some((value, index) => value !== before[index]);
};

const mounted: ReturnType<typeof create>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((renderer) => renderer.unmount());
});

const mountRoom = async () => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
  const first = makeEvent('$first', { content: { body: 'first' }, ts: 1_000 });
  const room = makeRoom({ liveEvents: [first, makeEvent('$second', { ts: 2_000 })] });
  matrixClientMock.on.mockClear();
  const element = React.createElement(Harness, { room });
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(element);
    await flushAsyncWork(2);
  });
  mounted.push(renderer);
  return { renderer, room, first, element };
};

const clientListener = (name: string) =>
  matrixClientMock.on.mock.calls.filter(([event]) => event === name).at(-1)?.[1] as
    | ((...args: unknown[]) => void)
    | undefined;

describe('the sources the room timeline gives its rows', () => {
  it('stay the same on a render of its own that tells of no change', async () => {
    const { renderer } = await mountRoom();
    const { ExpandAllLine } = await import('../RoomTimelineOverlays');
    // The expand-all switch is the timeline's own state, which the rows read from a context.
    expect(
      await changesSources(() =>
        renderer.root.findByType(ExpandAllLine).props.onToggle({ preventDefault: () => undefined })
      )
    ).toBe(false);
    expect(renderer.root.findByType(ExpandAllLine).props.expanded).toBe(true);
  });

  it("change when the room's power levels do", async () => {
    const { renderer, element } = await mountRoom();
    const { levels } = power;
    power.levels = { users: { '@bob:example.org': 50 } };
    // A context in the app; here the parent's render stands in for its change.
    const before = given.sources.at(-1)!;
    await act(async () => {
      renderer.update(React.cloneElement(element));
      await flushAsyncWork(1);
    });
    const after = given.sources.at(-1)!;
    power.levels = levels;
    expect(before).toContain(levels);
    expect(after).not.toContain(levels);
  });

  it('change when the parent renders the timeline again', async () => {
    const { renderer, element } = await mountRoom();
    expect(await changesSources(() => renderer.update(React.cloneElement(element)))).toBe(true);
  });

  it("change when a local echo's send state changes", async () => {
    const { room, first } = await mountRoom();
    expect(
      await changesSources(() =>
        room.__listeners.get(RoomEvent.LocalEchoUpdated)?.(first, room, '~old', null)
      )
    ).toBe(true);
  });

  it('change when the room hears a read receipt', async () => {
    const { room } = await mountRoom();
    expect(
      await changesSources(() => room.__listeners.get(RoomEvent.Receipt)?.(undefined, room))
    ).toBe(true);
  });

  it('change when a member of the room has a new name or membership', async () => {
    const { room } = await mountRoom();
    for (const name of [RoomMemberEvent.Name, RoomMemberEvent.Membership]) {
      const listener = clientListener(name);
      expect(listener).toBeTypeOf('function');
      // eslint-disable-next-line no-await-in-loop
      expect(await changesSources(() => listener?.(undefined, { roomId: room.roomId }))).toBe(true);
    }
  });
});

describe("the sources an open thread's timeline gives its rows", () => {
  it("change when the thread's events changed", async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
    const threadId = '$root';
    const root = makeEvent(threadId, { content: { body: 'root' }, ts: 1_000 });
    const reply = makeEvent('$reply', { threadRootId: threadId, ts: 2_000 });
    const rows = [root, reply];
    const timeline = makeTimeline([reply], { backwardToken: null });
    const timelineSet = { getLiveTimeline: () => timeline, getTimelineForEvent: () => undefined };
    const room = makeRoom({ liveEvents: [root] });
    room.getThread = () =>
      ({
        id: threadId,
        rootEvent: root,
        events: [reply],
        getUnfilteredTimelineSet: () => timelineSet,
      } as never);
    threadRenderStateMock.threadEvents = rows as never;
    threadRenderStateMock.ownThreadEvents = rows as never;
    threadRenderStateMock.threadEventIndexMapRef.current = new Map(
      rows.map((event, index) => [event.getId(), index])
    );
    roomTimelineVirtualizerState.virtualIndexes = rows.map((_, index) => index);
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Harness, { room, threadId }));
      await flushAsyncWork(2);
    });
    mounted.push(renderer);

    const edit = makeEvent('$reply-edit', {
      content: { body: 'edited' },
      relation: { event_id: '$reply', rel_type: 'm.replace' },
      threadRootId: threadId,
      ts: 3_000,
    });
    expect(
      await changesSources(() =>
        room.__listeners.get(RoomEvent.Timeline)?.(edit, room, false, false, { liveEvent: true })
      )
    ).toBe(true);
  });
});
