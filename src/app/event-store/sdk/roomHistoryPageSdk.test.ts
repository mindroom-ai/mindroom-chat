import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { describe, expect, it, vi } from 'vitest';
import { splitTimelinePage } from './roomHistoryPageSdk';
import { prependCachedRoomTimeline } from './roomTimelineSdk';

class ThreadEnabledClient extends MatrixClient {
  constructor() {
    super({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    this.clientOpts = { threadSupport: true };
  }
}

const makeRoom = () => {
  const mx = new ThreadEnabledClient();
  const room = new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true });
  // A redaction counts only from a member who may make it.
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.member',
      state_key: '@alice:example.org',
      sender: '@alice:example.org',
      room_id: '!room:example.org',
      event_id: '$member',
      content: { membership: 'join' },
    }),
  ]);
  return { mx, room };
};
const { room } = makeRoom();
const event = (id: string, ts: number, extra: Record<string, unknown> = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: id },
    ...extra,
  });

describe('splitTimelinePage', () => {
  const target = event('$target', 1);
  const reaction = event('$reaction', 2, {
    type: 'm.reaction',
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$target', key: '🛑' } },
  });
  const redaction = event('$redaction', 3, {
    type: 'm.room.redaction',
    redacts: '$target',
    content: {},
  });

  it('keeps out what a page read backwards relates to an older event of the same page', () => {
    expect(splitTimelinePage(room, [redaction, reaction, target])).toEqual([
      [target],
      [redaction, reaction],
    ]);
  });

  it('places it all in a page read forwards, where the older event comes first', () => {
    expect(splitTimelinePage(room, [target, reaction, redaction])).toEqual([
      [target, reaction, redaction],
      [],
    ]);
  });
});

describe('prependCachedRoomTimeline', () => {
  it('keeps a redaction of an older event of the page out of the timeline without a warning', async () => {
    const { mx, room: cached } = makeRoom();
    const newest = event('$newest', 5);
    await cached.addLiveEvents([newest], { addToState: false });
    const target = event('$target', 1);
    const redaction = event('$redaction', 3, {
      type: 'm.room.redaction',
      redacts: '$target',
      content: {},
    });
    const warn = vi.spyOn(logger, 'warn');

    const result = await prependCachedRoomTimeline({
      mx,
      room: cached,
      events: [redaction, target],
      firstTimeline: cached.getLiveTimeline(),
      beforeToken: null,
      showThreadRepliesInRoom: false,
    });

    const warnings = warn.mock.calls.map((args) => args.join(' '));
    warn.mockRestore();
    expect(warnings.filter((text) => /cannot be added|does not belong/.test(text))).toEqual([]);
    expect(result.getEvents()).toEqual([target, newest]);
    expect(target.isRedacted()).toBe(true);
  });
});
