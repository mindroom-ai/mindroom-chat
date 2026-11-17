import { Direction, Filter, MatrixClient, MatrixEvent, Room, type IRoomEvent } from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { describe, expect, it, vi } from 'vitest';
import { MINDROOM_BACKGROUND_JOBS_EVENT } from '../../matrix/protocol/backgroundJobsContract';
import { paginateRoomHistory, splitTimelinePage } from './roomHistoryPageSdk';
import { prependCachedRoomTimeline } from './roomTimelineSdk';

class ThreadEnabledClient extends MatrixClient {
  constructor() {
    super({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    this.clientOpts = { threadSupport: true };
  }
}

const makeRoom = () => {
  const mx = new ThreadEnabledClient();
  return {
    mx,
    room: new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true }),
  };
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

describe('paginateRoomHistory', () => {
  /** The `filter` query parameter of the `/messages` request one page of `edge` makes. */
  const requestedFilter = async (mx: MatrixClient, room: Room, backwards: boolean) => {
    // Forward pages extend an older timeline, such as one a jump to a date opened.
    const edge = backwards ? room.getLiveTimeline() : room.getUnfilteredTimelineSet().addTimeline();
    edge.setPaginationToken('token', backwards ? Direction.Backward : Direction.Forward);
    const request = vi
      .spyOn(mx.http, 'authedRequest')
      .mockResolvedValue({ chunk: [], start: 'token', end: 'next' });
    await paginateRoomHistory(mx, room, edge, backwards, 20, false);
    const params = request.mock.calls[0]?.[2] as Record<string, string> | undefined;
    return JSON.parse(params?.filter ?? '{}') as Record<string, unknown>;
  };

  it('leaves the agents jobs state out of the older history it asks for', async () => {
    const { mx, room: paged } = makeRoom();

    expect((await requestedFilter(mx, paged, true)).not_types).toEqual([
      MINDROOM_BACKGROUND_JOBS_EVENT,
    ]);
    expect((await requestedFilter(mx, paged, false)).not_types).toBeUndefined();
  });

  it('joins a history view to a live timeline of only jobs state, and follows it on', async () => {
    const { mx, room: paged } = makeRoom();
    const jobs = event('$jobs', 2, {
      type: MINDROOM_BACKGROUND_JOBS_EVENT,
      state_key: '@mindroom_code:example.org',
      sender: '@mindroom_code:example.org',
      content: { jobs: [], total: 0 },
    });
    await paged.addLiveEvents([jobs], { addToState: false });
    // A permalink opened an older timeline, whose next page reaches the live one.
    const history = paged.getUnfilteredTimelineSet().addTimeline();
    paged.addEventsToTimeline([event('$old', 1)], false, false, history, 'after-old');
    // A page that left the jobs state out would come back empty and end the timeline there.
    vi.spyOn(mx, 'createMessagesRequest').mockImplementation(
      async (_roomId, from, _l, _d, filter) =>
        filter
          ? { chunk: [], start: from! }
          : { chunk: [jobs.event as IRoomEvent], start: from!, end: 'after-jobs' }
    );

    await paginateRoomHistory(mx, paged, history, false, 20, false);
    await paged.addLiveEvents([event('$new', 3)], { addToState: false });

    expect(history.getNeighbouringTimeline(Direction.Forward)).toBe(paged.getLiveTimeline());
    expect(
      paged
        .getLiveTimeline()
        .getEvents()
        .map((e) => e.getId())
    ).toEqual(['$jobs', '$new']);
  });

  it('keeps the filter of a filtered timeline, adding the jobs state to the types it leaves out', async () => {
    const { mx, room: paged } = makeRoom();
    const filter = new Filter('@alice:example.org');
    filter.setDefinition({
      room: { timeline: { senders: ['@bob:example.org'], not_types: ['m.reaction'] } },
    });
    const edge = paged.getOrCreateFilteredTimelineSet(filter).getLiveTimeline();
    edge.setPaginationToken('token', Direction.Backward);
    const request = vi
      .spyOn(mx.http, 'authedRequest')
      .mockResolvedValue({ chunk: [], start: 'token', end: 'next' });

    await paginateRoomHistory(mx, paged, edge, true, 20, false);

    const params = request.mock.calls[0]?.[2] as Record<string, string>;
    expect(JSON.parse(params.filter!)).toEqual({
      senders: ['@bob:example.org'],
      not_types: ['m.reaction', MINDROOM_BACKGROUND_JOBS_EVENT],
    });
  });
});
