import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  MAX_FORK_DEPTH,
  THREAD_FORK_KEY,
  cutThreadAtForkPoint,
  forkTargetFor,
  keepThreadForkRef,
  latestForkPoint,
  ownThreadId,
  parseThreadForkRef,
  threadForkContent,
  threadForkDraftId,
} from './threadFork';

const makeEvent = (
  id: string,
  ts: number,
  threadRootId?: string,
  isThreadRoot = false,
  {
    type = 'm.room.message',
    redacted = false,
    relType = undefined as string | undefined,
    content = {} as Record<string, unknown>,
  } = {}
) =>
  ({
    getId: () => id,
    getTs: () => ts,
    getType: () => type,
    getContent: () => content,
    status: null,
    isRedacted: () => redacted,
    getRelation: () => (relType ? { rel_type: relType, event_id: '$x' } : null),
    threadRootId,
    isThreadRoot,
  } as unknown as MatrixEvent);

describe('parseThreadForkRef', () => {
  it('reads the reference from content', () => {
    expect(parseThreadForkRef({ [THREAD_FORK_KEY]: { thread_id: '$p', event_id: '$e' } })).toEqual({
      threadId: '$p',
      eventId: '$e',
    });
  });

  it('rejects anything but two $ IDs', () => {
    expect(parseThreadForkRef(undefined)).toBeUndefined();
    expect(parseThreadForkRef('x')).toBeUndefined();
    expect(parseThreadForkRef({})).toBeUndefined();
    expect(parseThreadForkRef({ [THREAD_FORK_KEY]: 'x' })).toBeUndefined();
    expect(parseThreadForkRef({ [THREAD_FORK_KEY]: { thread_id: '$p' } })).toBeUndefined();
    expect(
      parseThreadForkRef({ [THREAD_FORK_KEY]: { thread_id: '$p', event_id: '~e' } })
    ).toBeUndefined();
    expect(
      parseThreadForkRef({ [THREAD_FORK_KEY]: { thread_id: 1, event_id: '$e' } })
    ).toBeUndefined();
  });

  it('round-trips threadForkContent', () => {
    const ref = { threadId: '$p', eventId: '$e' };
    expect(threadForkContent(ref)).toEqual({
      [THREAD_FORK_KEY]: { thread_id: '$p', event_id: '$e' },
    });
    expect(parseThreadForkRef(threadForkContent(ref))).toEqual(ref);
  });

  it('caps the chain at 8 parents', () => {
    expect(MAX_FORK_DEPTH).toBe(8);
  });
});

describe('ownThreadId', () => {
  it('is the thread root for a reply', () => {
    expect(ownThreadId(makeEvent('$r', 1, '$root'))).toBe('$root');
  });
  it('is its own ID for a thread root', () => {
    expect(ownThreadId(makeEvent('$root', 1, undefined, true))).toBe('$root');
  });
  it('is undefined for a plain room message', () => {
    expect(ownThreadId(makeEvent('$m', 1))).toBeUndefined();
  });
});

describe('cutThreadAtForkPoint', () => {
  const root = makeEvent('$p', 1, undefined, true);
  const a = makeEvent('$a', 2, '$p');
  const b = makeEvent('$b', 3, '$p');
  const c = makeEvent('$c', 4, '$p');
  const other = makeEvent('$o', 2, '$x');

  it('keeps the root and replies up to the point, in thread order', () => {
    expect(cutThreadAtForkPoint('$p', [c, other, b, a, root], '$b')).toEqual([root, a, b]);
  });

  it('includes the root when it is the point', () => {
    expect(cutThreadAtForkPoint('$p', [a, root], '$p')).toEqual([root]);
  });

  it('breaks timestamp ties by event ID', () => {
    const x = makeEvent('$y', 5, '$p');
    const z = makeEvent('$x', 5, '$p');
    expect(cutThreadAtForkPoint('$p', [x, z, root], '$y')).toEqual([root, z, x]);
  });

  it('is undefined when the point is absent', () => {
    expect(cutThreadAtForkPoint('$p', [root, a], '$zz')).toBeUndefined();
    expect(cutThreadAtForkPoint('$p', [root, a, other], '$o')).toBeUndefined();
  });
});

describe('forkTargetFor', () => {
  it('names the owning thread of a prefix row', () => {
    expect(forkTargetFor(makeEvent('$e', 1, '$p'))).toEqual({ threadId: '$p', eventId: '$e' });
  });
  it('names a root by itself', () => {
    expect(forkTargetFor(makeEvent('$p', 1, undefined, true))).toEqual({
      threadId: '$p',
      eventId: '$p',
    });
  });
  it('is undefined for a local echo', () => {
    expect(forkTargetFor(makeEvent('~txn', 1, '$p'))).toBeUndefined();
  });
  // A thread's row without a thread relation is its root, also a parent's root the cache gave,
  // which has no thread object to say so.
  it('names a root without a thread object by itself', () => {
    expect(forkTargetFor(makeEvent('$p', 1))).toEqual({ threadId: '$p', eventId: '$p' });
  });
  // The parent's readers count only messages, so nothing else can be a fork point.
  it('is undefined for an edit, a redacted message and anything but a message', () => {
    expect(
      forkTargetFor(makeEvent('$e', 1, '$p', false, { relType: 'm.replace' }))
    ).toBeUndefined();
    expect(forkTargetFor(makeEvent('$e', 1, '$p', false, { redacted: true }))).toBeUndefined();
    expect(
      forkTargetFor(makeEvent('$e', 1, '$p', false, { type: 'io.mindroom.tool_approval' }))
    ).toBeUndefined();
    expect(forkTargetFor(makeEvent('$e', 1, '$p', false, { type: 'm.sticker' }))).toBeUndefined();
  });
});

describe('latestForkPoint', () => {
  const root = makeEvent('$p', 1, undefined, true);
  const a = makeEvent('$a', 2, '$p');
  const b = makeEvent('$b', 4, '$p');
  const edit = makeEvent('$edit', 5, '$p', false, { relType: 'm.replace' });
  const pending = makeEvent('~txn', 6, '$p');
  const roomWith = (rootEvent: MatrixEvent | undefined, events: MatrixEvent[]) =>
    ({
      getThread: () =>
        events.length > 0 || rootEvent
          ? {
              rootEvent,
              events,
              getUnfilteredTimelineSet: () => ({
                getLiveTimeline: () => ({ getNeighbouringTimeline: () => null }),
              }),
            }
          : null,
      findEventById: (eventId: string) => (eventId === '$p' ? rootEvent : undefined),
    } as unknown as Room);

  it("is the thread's latest message the server confirmed, past edits and sends under way", () => {
    expect(latestForkPoint(roomWith(root, [a, edit, b, pending]), '$p')).toEqual({
      threadId: '$p',
      eventId: '$b',
    });
  });

  it("passes over the thread's title notice", () => {
    const title = makeEvent('$title', 7, '$p', false, {
      content: {
        msgtype: 'm.notice',
        body: 'Lisbon trip',
        'io.mindroom.thread_summary': { version: 1, summary: 'Lisbon trip' },
      },
    });
    expect(latestForkPoint(roomWith(root, [a, b, title]), '$p')).toEqual({
      threadId: '$p',
      eventId: '$b',
    });
  });

  it('is the root of a thread without replies', () => {
    expect(latestForkPoint(roomWith(root, []), '$p')).toEqual({ threadId: '$p', eventId: '$p' });
  });

  it('is undefined while the room holds nothing of the thread', () => {
    expect(latestForkPoint(roomWith(undefined, []), '$p')).toBeUndefined();
  });
});

describe('threadForkDraftId', () => {
  it("keys a fork draft's composer text apart from its thread's", () => {
    expect(threadForkDraftId({ threadId: '$p', eventId: '$e' })).toBe('fork:$p:$e');
  });
});

describe('keepThreadForkRef', () => {
  const ref = { threadId: '$p', eventId: '$e' };

  it("gives an edit of a fork's root the reference its original carries", () => {
    expect(keepThreadForkRef(threadForkContent(ref), { msgtype: 'm.text', body: 'new' })).toEqual({
      msgtype: 'm.text',
      body: 'new',
      ...threadForkContent(ref),
    });
  });

  it('leaves the edit of any other message as it is', () => {
    const edited = { msgtype: 'm.text', body: 'new' };
    expect(keepThreadForkRef({ body: 'old' }, edited)).toBe(edited);
  });
});
