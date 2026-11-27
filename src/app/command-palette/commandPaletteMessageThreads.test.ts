import { type IEventWithRoomId, MatrixEvent, type Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  resolveLocalThreadSummary,
  resolveThreadRootPreview,
} from './commandPaletteMessageThreads';

const ROOM_ID = '!ops:example.org';
const ROOT_ID = '$root';

const makeBundledUnsigned = (eventId: string, summary: string, ts: number) => ({
  'm.relations': {
    'm.thread': {
      count: 3,
      'io.mindroom.title': {
        event_id: eventId,
        sender: '@mindroom_helper:example.org',
        type: 'm.room.message',
        origin_server_ts: ts,
        content: {
          msgtype: 'm.notice',
          body: summary,
          'io.mindroom.thread_summary': { version: 1, summary },
          'm.relates_to': { rel_type: 'm.thread', event_id: ROOT_ID },
        },
      },
    },
  },
});

const makeRoom = (rootEvent?: MatrixEvent): Room =>
  ({
    roomId: ROOM_ID,
    hasEncryptionStateEvent: () => false,
    getThread: () => undefined,
    findEventById: (id: string) => (id === ROOT_ID ? rootEvent : undefined),
  }) as unknown as Room;

const makeRootRaw = (unsigned?: Record<string, unknown>): IEventWithRoomId => ({
  event_id: ROOT_ID,
  room_id: ROOM_ID,
  sender: '@alice:example.org',
  origin_server_ts: 1_700_000_000_000,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: 'Opening root text' },
  ...(unsigned ? { unsigned } : {}),
});

describe('resolveLocalThreadSummary', () => {
  it('picks the newer bundled title between the search hit and loaded localRoot', () => {
    const olderLocalRoot = new MatrixEvent(
      makeRootRaw(makeBundledUnsigned('$oldSum', 'Older local title', 1_700_000_001_000))
    );
    const newerHit = makeRootRaw(
      makeBundledUnsigned('$newSum', 'Newer search hit title', 1_700_000_009_000)
    );
    expect(
      resolveLocalThreadSummary(makeRoom(olderLocalRoot), newerHit, ROOT_ID, undefined, new Map())
    ).toBe('Newer search hit title');

    const newerLocalRoot = new MatrixEvent(
      makeRootRaw(makeBundledUnsigned('$newestSum', 'Newer local title', 1_700_000_020_000))
    );
    expect(
      resolveLocalThreadSummary(makeRoom(newerLocalRoot), newerHit, ROOT_ID, undefined, new Map())
    ).toBe('Newer local title');
  });
});

describe('resolveThreadRootPreview', () => {
  it('returns undefined when localRoot is redacted even if fetchedPreview is cached', () => {
    const redactedRoot = new MatrixEvent({
      event_id: ROOT_ID,
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      origin_server_ts: 1_700_000_000_000,
      type: 'm.room.message',
      content: {},
      unsigned: {
        redacted_because: {
          event_id: '$redaction',
          type: 'm.room.redaction',
          sender: '@alice:example.org',
          origin_server_ts: 1_700_000_005_000,
          content: {},
          unsigned: {},
        },
      },
    });
    expect(
      resolveThreadRootPreview(makeRoom(redactedRoot), ROOT_ID, undefined, 'Stale cached preview')
    ).toBeUndefined();
  });

  it('prefers live localRoot preview over cached fetchedPreview', () => {
    const liveRoot = new MatrixEvent({
      event_id: ROOT_ID,
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      origin_server_ts: 1_700_000_000_000,
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'Live root text' },
    });
    expect(
      resolveThreadRootPreview(makeRoom(liveRoot), ROOT_ID, undefined, 'Older fetched preview')
    ).toBe('Live root text');
    expect(
      resolveThreadRootPreview(makeRoom(undefined), ROOT_ID, undefined, 'Fetched preview')
    ).toBe('Fetched preview');
  });
});
