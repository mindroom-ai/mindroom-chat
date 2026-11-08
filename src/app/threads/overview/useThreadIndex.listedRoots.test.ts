import { MatrixEvent, type Room, type Thread } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { withListedThreadRoots } from './useThreadIndex';

const message = (eventId: string, ts: number, sender = '@person:example.org') =>
  new MatrixEvent({
    event_id: eventId,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: `Question ${eventId}` },
  });

/** A room whose timelines hold none of the listed roots. */
const room = {
  getThread: () => undefined,
  getUnfilteredTimelineSet: () => ({ findEventById: () => undefined }),
} as unknown as Room;

/** A listed thread: its root and how many replies the server counts. */
const thread = (rootEvent: MatrixEvent, length: number) =>
  ({ id: rootEvent.getId(), rootEvent, length } as unknown as Thread);

describe('withListedThreadRoots', () => {
  it('puts the listed roots the rows lack first, oldest first, older than every row', () => {
    const inHistory = message('$in-history', 500);
    const entries = [
      { event: inHistory, absoluteIndex: 0 },
      { event: message('$note', 600), absoluteIndex: 1 },
    ];
    const rows = withListedThreadRoots(
      entries,
      room,
      [
        thread(inHistory, 3),
        thread(message('$newer', 300), 2),
        thread(message('$older', 100), 4),
        thread(message('$no-replies', 200), 0),
      ],
      () => true
    );
    expect(rows.map(({ event, absoluteIndex }) => [event.getId(), absoluteIndex])).toEqual([
      ['$older', -2],
      ['$newer', -1],
      ['$in-history', 0],
      ['$note', 1],
    ]);
  });

  it('leaves out the roots the view does not show', () => {
    const rows = withListedThreadRoots(
      [],
      room,
      [
        thread(message('$shown', 100), 1),
        thread(message('$ignored', 200, '@ignored:example.org'), 1),
      ],
      (rootEvent) => rootEvent.getSender() !== '@ignored:example.org'
    );
    expect(rows.map(({ event }) => event.getId())).toEqual(['$shown']);
  });
});
