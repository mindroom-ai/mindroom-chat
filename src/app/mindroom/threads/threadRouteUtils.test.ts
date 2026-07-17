import { describe, expect, it } from 'vitest';
import {
  getEffectiveThreadRootActivityTs,
  isConfirmedMatrixEventId,
  isPendingLocalEchoThreadRoot,
  isPendingLocalEchoThreadRootEvent,
  resolveCanonicalMatrixEventId,
  resolveCanonicalThreadRootId,
} from './threadRouteUtils';

const makeEvent = (
  eventId: string,
  options?: {
    threadRootId?: string;
    ts?: number;
    txnId?: string;
    isSending?: boolean;
  }
) =>
  ({
    getId: () => eventId,
    getTs: () => options?.ts ?? 0,
    getTxnId: () => options?.txnId,
    getUnsigned: () =>
      options?.txnId
        ? {
            transaction_id: options.txnId,
          }
        : {},
    isSending: () => options?.isSending ?? false,
    threadRootId: options?.threadRootId,
  } as never);

const makeRoom = ({
  events = [],
  threads = [],
  txnEventById = new Map<string, ReturnType<typeof makeEvent>>(),
  roomId = '!room:example.org',
}: {
  events?: ReturnType<typeof makeEvent>[];
  threads?: Array<{
    id?: string;
    rootEvent?: ReturnType<typeof makeEvent>;
    events: ReturnType<typeof makeEvent>[];
    getUnfilteredTimelineSet?: () => {
      getTimelines: () => Array<{ getEvents: () => ReturnType<typeof makeEvent>[] }>;
    };
  }>;
  txnEventById?: Map<string, ReturnType<typeof makeEvent>>;
  roomId?: string;
} = {}) =>
  ({
    roomId,
    findEventById: (eventId: string) => events.find((event) => event.getId() === eventId),
    getEventForTxnId: (txnId: string) => txnEventById.get(txnId),
    getLiveTimeline: () => ({
      getEvents: () => events,
    }),
    getThread: (threadId: string) => threads.find((thread) => thread.id === threadId) ?? null,
    getThreads: () => threads,
  } as never);

describe('threadRouteUtils', () => {
  it('recognizes only confirmed Matrix event ids as persistable ids', () => {
    expect(isConfirmedMatrixEventId('$confirmed')).toBe(true);
    expect(isConfirmedMatrixEventId('~pending')).toBe(false);
    expect(isConfirmedMatrixEventId('!room:example.org')).toBe(false);
    expect(isConfirmedMatrixEventId(undefined)).toBe(false);
  });

  it('resolves reply event ids back to their thread root ids', () => {
    const replyEvent = makeEvent('$reply', { threadRootId: '$root' });
    const room = makeRoom({
      events: [replyEvent],
    });

    expect(resolveCanonicalThreadRootId(room, '$reply')).toBe('$root');
  });

  it('resolves pending local-echo root ids to their confirmed event ids', () => {
    const pendingRoot = makeEvent('~pending', {
      ts: 0,
      txnId: 'txn-1',
      isSending: true,
    });
    const confirmedRoot = makeEvent('$confirmed', {
      ts: 123,
      txnId: 'txn-1',
    });
    const room = makeRoom({
      events: [pendingRoot, confirmedRoot],
      txnEventById: new Map([['txn-1', confirmedRoot]]),
    });

    expect(resolveCanonicalThreadRootId(room, '~pending')).toBe('$confirmed');
  });

  it('resolves stale local-echo route ids to confirmed ids using the encoded txn id', () => {
    const roomId = '!room:example.org';
    const confirmedRoot = makeEvent('$confirmed', {
      ts: 123,
      txnId: 'm1775932488410.3',
    });
    const room = makeRoom({
      roomId,
      events: [confirmedRoot],
    });

    expect(resolveCanonicalThreadRootId(room, `~${roomId}:m1775932488410.3`)).toBe('$confirmed');
  });

  it('resolves any stale local-echo event id through the live event transaction id', () => {
    const roomId = '!room:example.org';
    const confirmedReply = makeEvent('$confirmed-reply', {
      txnId: 'reply-txn',
    });
    const room = makeRoom({
      roomId,
      events: [confirmedReply],
    });

    expect(resolveCanonicalMatrixEventId(room, `~${roomId}:reply-txn`)).toBe('$confirmed-reply');
  });

  it('resolves a stale local-echo reply id from a loaded non-live thread timeline after txn eviction', () => {
    const roomId = '!room:example.org';
    const confirmedReply = makeEvent('$confirmed-thread-reply', {
      threadRootId: '$root',
      txnId: 'thread-reply-txn',
    });
    const room = makeRoom({
      roomId,
      threads: [
        {
          id: '$root',
          rootEvent: makeEvent('$root'),
          events: [],
          getUnfilteredTimelineSet: () => ({
            getTimelines: () => [{ getEvents: () => [] }, { getEvents: () => [confirmedReply] }],
          }),
        },
      ],
    });

    expect(resolveCanonicalMatrixEventId(room, `~${roomId}:thread-reply-txn`)).toBe(
      '$confirmed-thread-reply'
    );
  });

  it('treats pending local-echo thread roots as current activity', () => {
    const pendingRoot = makeEvent('~pending', {
      ts: 0,
      isSending: true,
    });

    expect(isPendingLocalEchoThreadRootEvent(pendingRoot)).toBe(true);
    expect(getEffectiveThreadRootActivityTs(pendingRoot, 456)).toBe(456);
  });

  it('does not treat thread replies as pending thread roots', () => {
    const pendingReply = makeEvent('~reply', {
      threadRootId: '$root',
      ts: 0,
      isSending: true,
    });
    const room = makeRoom({
      events: [pendingReply],
    });

    expect(isPendingLocalEchoThreadRootEvent(pendingReply)).toBe(false);
    expect(isPendingLocalEchoThreadRoot(room, '~reply')).toBe(false);
  });
});
