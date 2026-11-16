import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import {
  MAX_FORK_DEPTH,
  THREAD_FORK_KEY,
  cutThreadAtForkPoint,
  forkTargetFor,
  ownThreadId,
  parseThreadForkRef,
  threadForkContent,
} from './threadFork';

const makeEvent = (id: string, ts: number, threadRootId?: string, isThreadRoot = false) =>
  ({
    getId: () => id,
    getTs: () => ts,
    threadRootId,
    isThreadRoot,
  } as unknown as MatrixEvent);

describe('parseThreadForkRef', () => {
  it('reads the reference from content', () => {
    expect(
      parseThreadForkRef({ [THREAD_FORK_KEY]: { thread_id: '$p', event_id: '$e' } })
    ).toEqual({ threadId: '$p', eventId: '$e' });
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
  it('is undefined for a message in no thread', () => {
    expect(forkTargetFor(makeEvent('$m', 1))).toBeUndefined();
  });
});
