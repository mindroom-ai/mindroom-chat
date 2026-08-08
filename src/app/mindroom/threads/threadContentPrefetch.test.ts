import type { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { resolveFetchedThreadExpectedReplyCount } from './threadContentPrefetch';

const THREAD_ID = '$thread-root';

const makeRootEvent = (): MatrixEvent =>
  ({
    getUnsigned: () => ({
      'm.relations': {
        'm.thread': { count: 24 },
      },
    }),
  } as unknown as MatrixEvent);

const makeReplyEvent = (index: number): MatrixEvent =>
  ({
    getId: () => `$reply-${index}`,
    getRelation: () => ({ event_id: THREAD_ID, rel_type: 'm.thread' }),
    getType: () => 'm.room.message',
    isRedacted: () => false,
    isRedaction: () => false,
    threadRootId: THREAD_ID,
  } as unknown as MatrixEvent);

describe('resolveFetchedThreadExpectedReplyCount', () => {
  const relationEvents = Array.from({ length: 23 }, (_, index) => makeReplyEvent(index));

  it('uses the exhausted relation result instead of stale root metadata', () => {
    expect(
      resolveFetchedThreadExpectedReplyCount({
        threadId: THREAD_ID,
        relationEvents: [...relationEvents, relationEvents[0]],
        rootEvent: makeRootEvent(),
        relationSnapshotComplete: true,
      })
    ).toBe(23);
  });

  it('retains root metadata while relation pagination is incomplete', () => {
    expect(
      resolveFetchedThreadExpectedReplyCount({
        threadId: THREAD_ID,
        relationEvents,
        rootEvent: makeRootEvent(),
        relationSnapshotComplete: false,
      })
    ).toBe(24);
  });
});
