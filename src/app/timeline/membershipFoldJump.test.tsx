import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planMembershipFolds, projectRoomRows, viewMembershipFolds } from './membershipFolds';
import { useRoomEventOpenController } from './roomEventOpenController';

// A jump to a loaded event that a closed fold of membership events holds: the event shows no row
// of its own until its fold opens, and the room does not load its timeline again for it.

const ROOM_ID = '!room:example.org';
const TS = new Date(2026, 10, 3, 12, 0).getTime();

const message = (id: string): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@sam:example.org',
    type: 'm.room.message',
    origin_server_ts: TS,
    content: { body: id, msgtype: 'm.text' },
  });

const join = (id: string): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: `@${id.slice(1)}:example.org`,
    state_key: `@${id.slice(1)}:example.org`,
    type: 'm.room.member',
    origin_server_ts: TS,
    content: { membership: 'join', displayname: id.slice(1) },
  });

const reaction = (id: string, targetId: string): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@sam:example.org',
    type: 'm.reaction',
    origin_server_ts: TS,
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: targetId, key: 'ok' } },
  });

type ControllerOptions = Parameters<typeof useRoomEventOpenController>[0];

describe('a jump to an event inside a closed membership fold', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  // A message, a run of three joins with a reaction to the message among them, and a message.
  const loaded = [
    message('$msg0'),
    join('$m1'),
    join('$m2'),
    reaction('$react', '$msg0'),
    join('$m3'),
    message('$msg1'),
  ];
  const project = (pinnedIds: ReadonlySet<string>) =>
    projectRoomRows(
      loaded,
      loaded.map((event, absoluteIndex) => ({ event, absoluteIndex })),
      viewMembershipFolds(
        planMembershipFolds(loaded, { isSkipped: () => false, pinnedIds }),
        () => false
      )
    );

  const mount = () => {
    const setFocusItem = vi.fn();
    const setTimeline = vi.fn();
    const scrollToItem = vi.fn(() => true);
    const getEventTimeline = vi.fn();
    let controller!: ReturnType<typeof useRoomEventOpenController>;
    const projection = project(new Set());
    function Probe() {
      controller = useRoomEventOpenController({
        alive: () => true,
        effectiveViewMode: 'classic',
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
        ignoredUsersSet: new Set(),
        mx: { getEventTimeline },
        room: { roomId: ROOM_ID },
        roomThreadListThreads: [],
        overviewThreadRootIds: [],
        scrollToItem,
        setFocusItem,
        setTimeline,
        threadFilteredEvents: projection.rows,
        foldedRows: projection.foldedRows,
      } as unknown as ControllerOptions);
      return null;
    }
    act(() => {
      renderer = create(createElement(Probe));
    });
    return { controller, projection, setFocusItem, setTimeline, scrollToItem, getEventTimeline };
  };

  it("focuses the event at its fold's row, which unfolds its run, and loads nothing", async () => {
    const { controller, projection, setFocusItem, setTimeline, scrollToItem, getEventTimeline } =
      mount();
    expect(projection.rows.map((event) => event.getId())).toEqual(['$msg0', '$m1', '$msg1']);
    const onScroll = vi.fn();
    await act(() => controller.handleOpenEvent('$m2', true, onScroll));

    // The focus scroll takes it from here: it lands on the row once the focus has unfolded it.
    expect(setFocusItem).toHaveBeenCalledWith({
      eventId: '$m2',
      index: 1,
      scrollTo: true,
      highlight: true,
    });
    expect(onScroll).toHaveBeenCalledWith(true);
    // Not the room's timeline loaded again around the event, and no scroll to a row that is not
    // one yet.
    expect(setTimeline).not.toHaveBeenCalled();
    expect(getEventTimeline).not.toHaveBeenCalled();
    expect(scrollToItem).not.toHaveBeenCalled();

    // The focused event pins its run: it is a row of the room, where the focus scroll finds it.
    const unfolded = project(new Set(['$m2']));
    expect(unfolded.rows.findIndex((event) => event.getId() === '$m2')).toBe(2);
    expect(unfolded.foldedRows.size).toBe(0);
  });

  it("unfolds the run for its first event, whose row draws the fold's break", async () => {
    const { controller, projection, setFocusItem, setTimeline, scrollToItem, getEventTimeline } =
      mount();
    // The event is a row of the room's rows, but that row shows the break, not the event: a
    // scroll to it would land on the closed fold and highlight nothing.
    expect(projection.rows[1]?.getId()).toBe('$m1');
    const onScroll = vi.fn();
    await act(() => controller.handleOpenEvent('$m1', true, onScroll));
    expect(setFocusItem).toHaveBeenCalledWith({
      eventId: '$m1',
      index: 1,
      scrollTo: true,
      highlight: true,
    });
    expect(onScroll).toHaveBeenCalledWith(true);
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(setTimeline).not.toHaveBeenCalled();
    expect(getEventTimeline).not.toHaveBeenCalled();
    expect(project(new Set(['$m1'])).foldedRows.size).toBe(0);
  });

  it('unfolds the run for an event without a row that it holds, and loads nothing', async () => {
    const { controller, projection, setFocusItem, setTimeline, scrollToItem, getEventTimeline } =
      mount();
    // The reaction is loaded, between the run's events: no row of the room's rows.
    expect(projection.rows.some((event) => event.getId() === '$react')).toBe(false);
    const onScroll = vi.fn();
    await act(() => controller.handleOpenEvent('$react', false, onScroll));
    expect(setFocusItem).toHaveBeenCalledWith({
      eventId: '$react',
      index: 1,
      scrollTo: true,
      highlight: false,
    });
    expect(onScroll).toHaveBeenCalledWith(true);
    // Not the room's timeline emptied and loaded again around an event it already holds.
    expect(setTimeline).not.toHaveBeenCalled();
    expect(getEventTimeline).not.toHaveBeenCalled();
    expect(scrollToItem).not.toHaveBeenCalled();
    // The focus pins the run the reaction is in, and the reaction is where the loaded rows have
    // it: the focus scroll goes to its place among the unfolded rows.
    const unfolded = project(new Set(['$react']));
    expect(unfolded.foldedRows.size).toBe(0);
    expect(unfolded.rows.findIndex((event) => event.getId() === '$react')).toBe(3);
  });

  it('scrolls to a row of the room as before', async () => {
    const { controller, setFocusItem, scrollToItem, setTimeline } = mount();
    await act(() => controller.handleOpenEvent('$msg1'));
    expect(scrollToItem).toHaveBeenCalledWith(2, expect.objectContaining({ align: 'center' }));
    expect(setFocusItem).toHaveBeenCalledWith({
      eventId: '$msg1',
      index: 2,
      scrollTo: false,
      highlight: true,
    });
    expect(setTimeline).not.toHaveBeenCalled();
  });
});
