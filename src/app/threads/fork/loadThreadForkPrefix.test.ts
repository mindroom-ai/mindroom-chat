import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import { MAX_FORK_DEPTH, threadForkContent } from '../../event-store/threads/threadFork';
import { loadThreadForkPrefix } from './loadThreadForkPrefix';

type Fork = { roomId?: string; threadId: string; eventId: string };

const ROOM_A = '!alpha:example.org';
const ROOM_B = '!beta:example.org';
const ROOM_C = '!gamma:example.org';

const message = (id: string, ts: number, threadRootId?: string, roomId = ROOM_A) =>
  ({
    getId: () => id,
    getRoomId: () => roomId,
    getTs: () => ts,
    threadRootId,
    isThreadRoot: false,
    getOriginalContent: () => ({ body: id }),
  }) as unknown as MatrixEvent;

const root = (id: string, ts: number, fork?: Fork, roomId = ROOM_A) =>
  ({
    getId: () => id,
    getRoomId: () => roomId,
    getTs: () => ts,
    threadRootId: undefined,
    isThreadRoot: true,
    getOriginalContent: () => ({ body: id, ...(fork ? threadForkContent(fork) : {}) }),
  }) as unknown as MatrixEvent;

const ids = (events: MatrixEvent[]) => events.map((event) => event.getId());

/** A loader over fixed threads; keys are either `roomId|threadId` or `threadId`. */
const loaderOf = (threads: Record<string, MatrixEvent[]>) =>
  vi.fn((roomId: string, threadId: string) =>
    Promise.resolve(threads[`${roomId}|${threadId}`] ?? threads[threadId] ?? [])
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadThreadForkPrefix', () => {
  it('is empty for a root that is no fork', async () => {
    const loadThreadEvents = loaderOf({});
    const prefix = await loadThreadForkPrefix({ loadThreadEvents }, root('$f', 10));
    expect(prefix).toEqual({ events: [], parent: undefined });
    expect(loadThreadEvents).not.toHaveBeenCalled();
  });

  it('cuts one parent at the fork point, without its newer replies or other threads', async () => {
    const parent = { threadId: '$p', eventId: '$b' };
    const loadThreadEvents = loaderOf({
      $p: [
        message('$c', 4, '$p'),
        message('$b', 3, '$p'),
        message('$x', 2, '$other'),
        message('$a', 2, '$p'),
        root('$p', 1),
      ],
    });
    const prefix = await loadThreadForkPrefix({ loadThreadEvents }, root('$f', 10, parent));
    expect(ids(prefix.events)).toEqual(['$p', '$a', '$b']);
    expect(prefix.parent).toEqual(parent);
    expect(loadThreadEvents).toHaveBeenCalledWith(ROOM_A, '$p', '$b');
  });

  it("puts a parent's own prefix in front of its messages", async () => {
    const loadThreadEvents = loaderOf({
      $g: [root('$g', 1), message('$g1', 2, '$g'), message('$g2', 3, '$g')],
      $p: [
        root('$p', 4, { threadId: '$g', eventId: '$g1' }),
        message('$p1', 5, '$p'),
        message('$p2', 6, '$p'),
      ],
    });
    const prefix = await loadThreadForkPrefix(
      { loadThreadEvents },
      root('$f', 10, { threadId: '$p', eventId: '$p1' })
    );
    expect(ids(prefix.events)).toEqual(['$g', '$g1', '$p', '$p1']);
    expect(prefix.parent).toEqual({ threadId: '$p', eventId: '$p1' });
    expect(loadThreadEvents.mock.calls.map(([, threadId]) => threadId)).toEqual(['$p', '$g']);
  });

  it('follows at most 8 parents and logs once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // $t1 forks $t2 at its root, ... $t9 forks $t10, which is no fork.
    const threads: Record<string, MatrixEvent[]> = {};
    for (let level = 1; level <= 10; level += 1) {
      const next = `$t${level + 1}`;
      const fork = level < 10 ? { threadId: next, eventId: next } : undefined;
      threads[`$t${level}`] = [root(`$t${level}`, 100 - level, fork)];
    }
    const loadThreadEvents = loaderOf(threads);
    const prefix = await loadThreadForkPrefix(
      { loadThreadEvents },
      root('$f', 1000, { threadId: '$t1', eventId: '$t1' })
    );
    expect(loadThreadEvents).toHaveBeenCalledTimes(MAX_FORK_DEPTH);
    expect(ids(prefix.events)).toEqual(['$t8', '$t7', '$t6', '$t5', '$t4', '$t3', '$t2', '$t1']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stops at a cycle after reading each thread once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loadThreadEvents = loaderOf({
      $p: [root('$p', 1, { threadId: '$q', eventId: '$q' }), message('$p1', 2, '$p')],
      $q: [root('$q', 3, { threadId: '$p', eventId: '$p1' })],
    });
    const prefix = await loadThreadForkPrefix(
      { loadThreadEvents },
      root('$f', 10, { threadId: '$p', eventId: '$p1' })
    );
    expect(loadThreadEvents.mock.calls.map(([, threadId]) => threadId)).toEqual(['$p', '$q']);
    expect(ids(prefix.events)).toEqual(['$q', '$p', '$p1']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores a parent without messages', async () => {
    const parent = { threadId: '$gone', eventId: '$e' };
    const prefix = await loadThreadForkPrefix(
      { loadThreadEvents: loaderOf({}) },
      root('$f', 10, parent)
    );
    expect(prefix).toEqual({ events: [], parent });
  });

  it('ignores a parent that lacks the fork point', async () => {
    const parent = { threadId: '$p', eventId: '$missing' };
    const loadThreadEvents = loaderOf({ $p: [root('$p', 1), message('$a', 2, '$p')] });
    const prefix = await loadThreadForkPrefix({ loadThreadEvents }, root('$f', 10, parent));
    expect(prefix).toEqual({ events: [], parent });
  });

  it('keeps the parents resolved below a missing grandparent', async () => {
    const loadThreadEvents = loaderOf({
      $p: [root('$p', 4, { threadId: '$gone', eventId: '$e' }), message('$p1', 5, '$p')],
    });
    const prefix = await loadThreadForkPrefix(
      { loadThreadEvents },
      root('$f', 10, { threadId: '$p', eventId: '$p1' })
    );
    expect(ids(prefix.events)).toEqual(['$p', '$p1']);
  });

  it('resolves multi-hop A -> B -> C where B -> A omits room_id in A, not C', async () => {
    // Thread $a and thread $b both live in ROOM_A ($b forks $a without room_id).
    // Thread $c lives in ROOM_C and cross-room forks $b in ROOM_A.
    const loadThreadEvents = loaderOf({
      [`${ROOM_A}|$a`]: [root('$a', 1, undefined, ROOM_A), message('$a1', 2, '$a', ROOM_A)],
      [`${ROOM_A}|$b`]: [
        root('$b', 3, { threadId: '$a', eventId: '$a1' }, ROOM_A),
        message('$b1', 4, '$b', ROOM_A),
      ],
      // Put a decoy $a in ROOM_C to prove hop 2 does NOT resolve in C.
      [`${ROOM_C}|$a`]: [root('$a', 99, undefined, ROOM_C), message('$a1', 100, '$a', ROOM_C)],
    });
    const prefix = await loadThreadForkPrefix(
      { loadThreadEvents, roomId: ROOM_C },
      root('$c', 10, { roomId: ROOM_A, threadId: '$b', eventId: '$b1' }, ROOM_C)
    );
    expect(loadThreadEvents.mock.calls).toEqual([
      [ROOM_A, '$b', '$b1'],
      [ROOM_A, '$a', '$a1'],
    ]);
    expect(ids(prefix.events)).toEqual(['$a', '$a1', '$b', '$b1']);
    expect(prefix.events.map((e) => e.getRoomId())).toEqual([ROOM_A, ROOM_A, ROOM_A, ROOM_A]);
  });

  it('keys visited by (roomId, threadId) across rooms and catches cross-room cycles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loadThreadEvents = loaderOf({
      [`${ROOM_B}|$p`]: [
        root('$p', 4, { roomId: ROOM_A, threadId: '$p', eventId: '$a1' }, ROOM_B),
        message('$b1', 5, '$p', ROOM_B),
      ],
      [`${ROOM_A}|$p`]: [
        root('$p', 1, { roomId: ROOM_B, threadId: '$p', eventId: '$b1' }, ROOM_A),
        message('$a1', 2, '$p', ROOM_A),
      ],
    });
    const prefix = await loadThreadForkPrefix(
      { loadThreadEvents, roomId: ROOM_C },
      root('$c', 10, { roomId: ROOM_B, threadId: '$p', eventId: '$b1' }, ROOM_C)
    );
    expect(loadThreadEvents.mock.calls).toEqual([
      [ROOM_B, '$p', '$b1'],
      [ROOM_A, '$p', '$a1'],
    ]);
    expect(ids(prefix.events)).toEqual(['$p', '$a1', '$p', '$b1']);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
