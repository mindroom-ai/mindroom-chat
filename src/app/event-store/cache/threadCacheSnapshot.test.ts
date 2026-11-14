import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  getAuthoritativeCachedThreadReplyCount,
  getRoomDerivedThreadSnapshotState,
  isCompleteCachedThreadSnapshot,
  mergeThreadBackfillEvents,
} from './threadCacheSnapshot';
import {
  makeEvent as makeMockEvent,
  makeRoom as makeMockRoom,
} from '../../timeline/test-utils/RoomTimeline.test.shared';

// The shared helpers build partial mocks; type them once as the SDK objects they stand in for.
const makeEvent = makeMockEvent as unknown as (
  ...args: Parameters<typeof makeMockEvent>
) => MatrixEvent;
const makeRoom = makeMockRoom as unknown as () => Room;

describe('threadCacheSnapshot', () => {
  it('marks room-derived snapshots complete only when the room covers start, tail, and known replies', () => {
    const room = makeRoom();
    const rootEvent = makeEvent('$root', {
      isThreadRoot: true,
      unsigned: { 'm.relations': { 'm.thread': { count: 2 } } },
    });
    const replies = [
      makeEvent('$reply-1', { threadRootId: '$root', ts: 200 }),
      makeEvent('$reply-2', { threadRootId: '$root', ts: 300 }),
    ];

    expect(
      getRoomDerivedThreadSnapshotState({
        room,
        threadId: '$root',
        rootEvent,
        threadEvents: replies,
        roomStartKnown: true,
        roomTailLoaded: true,
      })
    ).toMatchObject({
      beforeTokenForEarliest: null,
      expectedReplyCount: 2,
      loadedReplyCount: 2,
      snapshotComplete: true,
      tailLoaded: true,
    });
  });

  it('does not treat a sparse cached thread snapshot as complete', () => {
    const room = makeRoom();
    const rootEvent = makeEvent('$root', {
      isThreadRoot: true,
      unsigned: { 'm.relations': { 'm.thread': { count: 2 } } },
    });
    const cachedEvents = [makeEvent('$reply-1', { threadRootId: '$root', ts: 200 })];

    expect(
      isCompleteCachedThreadSnapshot({
        room,
        threadId: '$root',
        rootEvent,
        cachedEvents,
        beforeToken: null,
        hasMoreBefore: false,
        snapshotComplete: true,
        tailLoaded: true,
      })
    ).toBe(false);
  });

  it('prefers live root counts over cached and persisted expected counts', () => {
    expect(
      getAuthoritativeCachedThreadReplyCount({
        rootEvent: makeEvent('$root', {
          isThreadRoot: true,
          unsigned: { 'm.relations': { 'm.thread': { count: 5 } } },
        }),
        cachedRootEvent: makeEvent('$root', {
          isThreadRoot: true,
          unsigned: { 'm.relations': { 'm.thread': { count: 2 } } },
        }),
        expectedReplyCount: 1,
      })
    ).toBe(5);
  });

  it('merges backfill events by id and cache order', () => {
    const existing = [makeEvent('$b', { ts: 200 }), makeEvent('$a', { ts: 100 })];
    const incoming = [
      makeEvent('$b', { ts: 300, content: { body: 'newer duplicate' } }),
      makeEvent('$c', { ts: 150 }),
    ];

    expect(mergeThreadBackfillEvents(existing, incoming).map((event) => event.getId())).toEqual([
      '$a',
      '$c',
      '$b',
    ]);
  });
});
