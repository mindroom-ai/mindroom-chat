import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { buildClassicRoomRowEntries } from './roomTimelineClassicRows';
import type { TimelineEventEntry } from './roomTimelineEvents';
import { shouldRenderUnreadDividerAt } from './timelineScrollUtils';
import { defined } from '../../test-utils/defined';

// A thread's timeline here is the list of its events, all of them rows.
vi.mock('./linkedTimelines', () => ({ getLinkedTimelines: (timeline: unknown) => [timeline] }));
vi.mock('./roomTimelineEvents', () => ({
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

    expect(ids(buildClassicRoomRowEntries(room, rows, FILTERS))).toEqual([
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

    expect(ids(buildClassicRoomRowEntries(room, rows, FILTERS))).toEqual([
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

    expect(ids(buildClassicRoomRowEntries(room, rows, FILTERS))).toEqual([
      '$root',
      '$reply',
      '$new',
    ]);
  });

  it('returns the room rows as they are when no thread adds a reply', () => {
    const rows = roomRows(['$a', 10, 0], ['$b', 20, 1]);
    expect(buildClassicRoomRowEntries(roomWithThreads({}), rows, FILTERS)).toBe(rows);
  });

  it('places the read marker line once, above the first reply or row after the marker', () => {
    // Read up to $b (position 1). The reply to $root, sent after $b, is the first unread row.
    const rows = roomRows(['$root', 10, 0], ['$b', 20, 1], ['$c', 40, 2]);
    const room = roomWithThreads({ $root: [rowEvent(rows, 0), event('$reply', 30)] });

    const merged = buildClassicRoomRowEntries(room, rows, FILTERS);

    expect(ids(merged)).toEqual(['$root', '$b', '$reply', '$c']);
    expect(dividersAt(merged, 1)).toEqual(['$reply']);
    // Read up to $c: everything shown is read.
    expect(dividersAt(merged, 2)).toEqual([]);
  });

  it('keeps a reply whose root is not loaded in time order, without a divider of its own', () => {
    // The root is older than the loaded rows; its reply falls between them.
    const rows = roomRows(['$a', 100, 5], ['$b', 300, 6]);
    const room = roomWithThreads({ $old: [event('$old', 1), event('$reply', 200)] });

    const merged = buildClassicRoomRowEntries(room, rows, FILTERS);

    expect(ids(merged)).toEqual(['$a', '$reply', '$b']);
    expect(dividersAt(merged, 6)).toEqual([]);
    expect(dividersAt(merged, 5)).toEqual(['$reply']);
  });

  it('orders replies of the same moment by event ID, and before a room row sent then', () => {
    const rows = roomRows(['$root', 10, 0], ['$same', 30, 1]);
    const room = roomWithThreads({
      $root: [rowEvent(rows, 0), event('$zz', 30), event('$aa', 30)],
    });

    expect(ids(buildClassicRoomRowEntries(room, rows, FILTERS))).toEqual([
      '$root',
      '$aa',
      '$same',
      '$zz',
    ]);
  });
});
