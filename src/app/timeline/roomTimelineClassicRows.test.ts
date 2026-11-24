import type { EventTimeline, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  buildClassicRoomRowEntries,
  countsRoomRows,
  placeClassicWindow,
} from './roomTimelineClassicRows';
import type { TimelineEventEntry } from '../event-store/timeline/roomTimelineEvents';
import { shouldRenderUnreadDividerAt } from '../event-store/timeline/timelineScrollUtils';
import { defined } from '../../test/utils/defined';

// A thread's timeline here is the list of its events, all of them rows.
vi.mock('../event-store/timeline/linkedTimelines', () => ({
  getLinkedTimelines: (timeline: unknown) => [timeline],
}));
vi.mock('../event-store/timeline/roomTimelineEvents', () => ({
  getRenderableEventEntries: ([events = []]: MatrixEvent[][]) =>
    events.map((event, absoluteIndex) => ({ event, absoluteIndex })),
}));

const event = (eventId: string, ts: number) =>
  ({ getId: () => eventId, getTs: () => ts } as unknown as MatrixEvent);

/** Room rows at the given timeline positions, in timeline order. */
const roomRows = (...rows: Array<[string, number, number]>): TimelineEventEntry[] =>
  rows.map(([eventId, ts, absoluteIndex]) => ({ event: event(eventId, ts), absoluteIndex }));

/** The event of the row at `index`. */
const rowEvent = (rows: TimelineEventEntry[], index: number): MatrixEvent =>
  defined(rows[index], `row ${index}`).event;

const roomWithThreads = (threads: Record<string, MatrixEvent[]>) =>
  ({
    getThreads: () => Object.entries(threads).map(([id, events]) => ({ id, liveTimeline: events })),
  } as unknown as Room);

const FILTERS = {
  ignoredUsersSet: new Set<string>(),
  showHiddenEvents: false,
  hideMembershipEvents: false,
  hideNickAvatarEvents: false,
};

const ids = (entries: TimelineEventEntry[]) => entries.map((entry) => entry.event.getId());

/** Rows the "New Messages" line goes above, for a read marker at `readUpto`. */
const dividersAt = (entries: TimelineEventEntry[], readUpto: number) =>
  entries
    .filter((entry, index) =>
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: readUpto,
        eventAbsoluteIndex: entry.absoluteIndex,
        prevRenderedEventAbsoluteIndex: entries[index - 1]?.absoluteIndex,
      })
    )
    .map((entry) => entry.event.getId());

describe('buildClassicRoomRowEntries', () => {
  it('puts each thread reply among the room rows by the time it was sent', () => {
    const rows = roomRows(['$root', 10, 0], ['$b', 20, 1], ['$c', 40, 2]);
    const room = roomWithThreads({
      $root: [rowEvent(rows, 0), event('$r1', 30), event('$r2', 50)],
    });

    expect(ids(buildClassicRoomRowEntries(room, rows, [], FILTERS))).toEqual([
      '$root',
      '$b',
      '$r1',
      '$c',
      '$r2',
    ]);
  });

  it('keeps the room rows in timeline order when their clocks disagree', () => {
    // A server with a slow clock: $late was sent after $early but carries an older time.
    const rows = roomRows(['$early', 100, 0], ['$late', 50, 1], ['$last', 200, 2]);
    const room = roomWithThreads({ $early: [rowEvent(rows, 0), event('$reply', 150)] });

    expect(ids(buildClassicRoomRowEntries(room, rows, [], FILTERS))).toEqual([
      '$early',
      '$late',
      '$reply',
      '$last',
    ]);
  });

  it('shows a reply once, also when the room timeline holds it too', () => {
    const rows = roomRows(['$root', 10, 0], ['$reply', 20, 1]);
    const room = roomWithThreads({
      $root: [rowEvent(rows, 0), rowEvent(rows, 1), event('$new', 30)],
    });

    expect(ids(buildClassicRoomRowEntries(room, rows, [], FILTERS))).toEqual([
      '$root',
      '$reply',
      '$new',
    ]);
  });

  it('returns the room rows as they are when no thread adds a reply', () => {
    const rows = roomRows(['$a', 10, 0], ['$b', 20, 1]);
    expect(buildClassicRoomRowEntries(roomWithThreads({}), rows, [], FILTERS)).toBe(rows);
  });

  it('places the read marker line once, above the first reply or row after the marker', () => {
    // Read up to $b (position 1). The reply to $root, sent after $b, is the first unread row.
    const rows = roomRows(['$root', 10, 0], ['$b', 20, 1], ['$c', 40, 2]);
    const room = roomWithThreads({ $root: [rowEvent(rows, 0), event('$reply', 30)] });

    const merged = buildClassicRoomRowEntries(room, rows, [], FILTERS);

    expect(ids(merged)).toEqual(['$root', '$b', '$reply', '$c']);
    expect(dividersAt(merged, 1)).toEqual(['$reply']);
    // Read up to $c: everything shown is read.
    expect(dividersAt(merged, 2)).toEqual([]);
  });

  it('keeps a reply whose root is not loaded in time order, without a divider of its own', () => {
    // The root is older than the loaded rows; its reply falls between them.
    const rows = roomRows(['$a', 100, 5], ['$b', 300, 6]);
    const room = roomWithThreads({ $old: [event('$old', 1), event('$reply', 200)] });

    const merged = buildClassicRoomRowEntries(room, rows, [], FILTERS);

    expect(ids(merged)).toEqual(['$a', '$reply', '$b']);
    expect(dividersAt(merged, 6)).toEqual([]);
    expect(dividersAt(merged, 5)).toEqual(['$reply']);
  });

  it('puts the replies history pages kept among the rows too, each once', () => {
    const rows = roomRows(['$root', 10, 0], ['$c', 40, 1]);
    const held = event('$r2', 50);
    const room = roomWithThreads({ $root: [rowEvent(rows, 0), held] });

    expect(
      ids(
        buildClassicRoomRowEntries(room, rows, [event('$h1', 20), held, event('$h2', 45)], FILTERS)
      )
    ).toEqual(['$root', '$h1', '$c', '$h2', '$r2']);
  });

  it('keeps replies sent before the history the room holds for the page that brings them', () => {
    const rows = roomRows(['$b', 20, 0], ['$c', 40, 1]);
    const room = roomWithThreads({ $root: [event('$old', 5), event('$r', 30)] });

    expect(
      ids(buildClassicRoomRowEntries(room, rows, [event('$h', 10)], FILTERS, rowEvent(rows, 0)))
    ).toEqual(['$b', '$r', '$c']);
  });

  it('orders replies of the same moment by event ID, and before a room row sent then', () => {
    const rows = roomRows(['$root', 10, 0], ['$same', 30, 1]);
    const room = roomWithThreads({
      $root: [rowEvent(rows, 0), event('$zz', 30), event('$aa', 30)],
    });

    expect(ids(buildClassicRoomRowEntries(room, rows, [], FILTERS))).toEqual([
      '$root',
      '$aa',
      '$same',
      '$zz',
    ]);
  });
});

describe('placeClassicWindow', () => {
  const rows = (...eventIds: string[]) =>
    eventIds.map((eventId, absoluteIndex) => ({
      event: event(eventId, absoluteIndex),
      absoluteIndex,
    }));
  const shown = rows('$a', '$b', '$c', '$d');
  const chain = [{}, {}] as EventTimeline[];
  const at = (range: { start: number; end: number }, linkedTimelines = chain) => ({
    linkedTimelines,
    range,
  });
  // A page of history with two replies joins above, a live row below.
  const paged = rows('$old', '$r1', '$r2', '$a', '$b', '$c', '$d', '$new');
  const range = { start: 1, end: 3 };
  const previous = { source: range, chain, range, firstRowId: '$b' };

  it('keeps the first row of a window nobody moved when rows join above it', () => {
    // The page grew the chain; the window kept its values.
    expect(
      placeClassicWindow(previous, at({ ...range }, [{} as EventTimeline, ...chain]), paged, 6)
    ).toEqual({
      start: 4,
      end: 6,
    });
    expect(placeClassicWindow(previous, at(previous.range), paged, 6)).toEqual({
      start: 4,
      end: 6,
    });
  });

  it('moves a window set over the rows of the last commit with its first row', () => {
    // A pager widened the window up in the render the page arrived in.
    expect(placeClassicWindow(previous, at({ start: 0, end: 3 }), paged, 6)).toEqual({
      start: 3,
      end: 6,
    });
    // Without rows joining, even one ending at the room timeline's row count stays.
    expect(placeClassicWindow(previous, at({ start: 0, end: 3 }), shown, 3)).toEqual({
      start: 0,
      end: 3,
    });
  });

  it('takes a window over other history, or one counting room rows at its newest, from the start', () => {
    expect(
      placeClassicWindow(previous, at({ start: 0, end: 2 }, [{}] as EventTimeline[]), paged, 6)
    ).toEqual({ start: 0, end: 2 });
    expect(placeClassicWindow(undefined, at({ start: 1, end: 3 }), shown, 3)).toEqual({
      start: 2,
      end: 4,
    });
    expect(
      placeClassicWindow(previous, countsRoomRows(at({ start: 1, end: 3 })), shown, 3)
    ).toEqual({ start: 2, end: 4 });
    expect(placeClassicWindow(undefined, at({ start: 0, end: 4 }), shown, 4)).toEqual({
      start: 0,
      end: 4,
    });
  });
});
