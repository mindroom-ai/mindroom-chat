import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  RoomEvent,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { relistThreadsAfterGaps } from './threadListGaps';

const ROOM = '!room:example.org';

/** A listed root whose thread's newest event is at `latestTs`. */
const listedRoot = (id: string, latestTs: number): Partial<IEvent> => ({
  event_id: id,
  type: 'm.room.message',
  origin_server_ts: latestTs - 1000,
  content: { body: id },
  unsigned: {
    'm.relations': {
      'm.thread': {
        latest_event: { event_id: `${id}-reply`, origin_server_ts: latestTs },
        count: 1,
      },
    },
  } as never,
});

const mapped = (raw: Partial<IEvent>) => {
  const relation = (raw.unsigned as { 'm.relations': { 'm.thread': unknown } })['m.relations'][
    'm.thread'
  ];
  return {
    getId: () => raw.event_id,
    getTs: () => raw.origin_server_ts,
    getServerAggregatedRelation: () => relation,
  } as unknown as MatrixEvent;
};

const setup = (pages: { chunk: Partial<IEvent>[]; end?: string }[], knownTs: number) => {
  const unfiltered = {};
  const room = Object.assign(new EventEmitter(), {
    roomId: ROOM,
    threadsTimelineSets: [{}, {}],
    getUnfilteredTimelineSet: () => unfiltered,
    getThreads: () => [{ replyToEvent: { getTs: () => knownTs } }],
    getThread: () => undefined,
    processListedThreadRoots: vi.fn<(events: MatrixEvent[], toStart: boolean) => void>(),
  });
  const requests: (string | null)[] = [];
  const mx = Object.assign(new EventEmitter(), {
    getRooms: () => [room],
    getEventMapper: () => mapped,
    createThreadListMessagesRequest: vi.fn(async (_roomId: string, from: string | null) => {
      requests.push(from);
      return pages[requests.length - 1] ?? { chunk: [] };
    }),
  });
  const stop = relistThreadsAfterGaps(mx as unknown as MatrixClient);
  const gap = (timelineSet: unknown = unfiltered) =>
    room.emit(RoomEvent.TimelineReset, room as unknown as Room, timelineSet, false);
  const listedIds = () =>
    room.processListedThreadRoots.mock.calls.flatMap(([events]) => events.map((e) => e.getId()));
  return { room, requests, gap, listedIds, stop };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('relistThreadsAfterGaps', () => {
  it('reads the list after a gap down to the activity the room knew before it', async () => {
    const { requests, gap, listedIds } = setup(
      [
        { chunk: [listedRoot('$a', 900), listedRoot('$b', 800)], end: 'p2' },
        { chunk: [listedRoot('$c', 700), listedRoot('$old', 500)], end: 'p3' },
        { chunk: [listedRoot('$older', 400)] },
      ],
      600
    );
    gap();
    await settle();
    expect(requests).toEqual([null, 'p2']);
    expect(listedIds()).toEqual(['$a', '$b', '$c']);
  });

  it('ignores thread timeline resets and rooms whose thread list was never read', async () => {
    const { room, requests, gap } = setup([{ chunk: [listedRoot('$a', 900)] }], 600);
    gap({});
    room.threadsTimelineSets = [];
    gap();
    await settle();
    expect(requests).toEqual([]);
  });

  it('reads again for a gap that comes while it reads', async () => {
    const { requests, gap, stop } = setup(
      [{ chunk: [listedRoot('$a', 900)] }, { chunk: [listedRoot('$b', 950)] }],
      600
    );
    gap();
    gap();
    await settle();
    await settle();
    expect(requests).toEqual([null, null]);
    stop();
  });
});
