import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThreadEditBackfillController } from '../threadEditBackfillController';

// Task #129 regression suite. Reproduces the mid-thread "Thinking…"
// placeholder band: the controller used to mark every candidate
// attempted BEFORE its async /relations fetch, then the effect (dep:
// threadEvents, which the cache work churns constantly) cancelled the
// in-flight batch on any change — stranding marked-but-unresolved
// events the gate then refused to retry. Fixed by marking attempted
// only on a definitive fetch outcome and never on cancel/error, plus an
// in-flight guard so churn re-runs don't refetch.
//
// All fixtures are synthetic (no production data in the repo).

const ROOM = '!room:example.org';
const SENDER = '@agent:example.org';

const makePlaceholder = (eventId: string) =>
  new MatrixEvent({
    content: { body: 'Thinking...', msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1000,
    room_id: ROOM,
    sender: SENDER,
    type: 'm.room.message',
  });

const makeEditFor = (targetId: string, editId: string, ts: number, body: string) =>
  new MatrixEvent({
    content: {
      body: `* ${body}`,
      'm.new_content': { body, msgtype: 'm.text' },
      'm.relates_to': { event_id: targetId, rel_type: 'm.replace' },
      msgtype: 'm.text',
    },
    event_id: editId,
    origin_server_ts: ts,
    room_id: ROOM,
    sender: SENDER,
    type: 'm.room.message',
  });

type Deferred = { promise: Promise<{ events: MatrixEvent[] }>; resolve: () => void };

const makeHarness = () => {
  // One deferred per target so tests control fetch completion timing.
  const deferreds = new Map<string, Deferred>();
  // Targets whose NEXT fetch should reject once (transient error).
  const failOnce = new Set<string>();
  const relations = vi.fn((_room: string, targetId: string) => {
    if (failOnce.has(targetId)) {
      failOnce.delete(targetId);
      return Promise.reject(new Error('transient'));
    }
    let resolveFn!: () => void;
    const editResult = { events: [makeEditFor(targetId, `$edit-${targetId}`, 2000, 'resolved')] };
    const promise = new Promise<{ events: MatrixEvent[] }>((res) => {
      resolveFn = () => res(editResult);
    });
    deferreds.set(targetId, { promise, resolve: resolveFn });
    return promise;
  });
  const mx = {
    relations,
    getThread: () => undefined,
  } as never;
  const room = {
    roomId: ROOM,
    getThread: () => undefined,
    findEventById: () => undefined,
  } as never;
  return { deferreds, failOnce, relations, mx, room };
};

const makeProps = (harness: ReturnType<typeof makeHarness>, threadEvents: MatrixEvent[]) => {
  const attemptedRef = { current: new WeakMap<MatrixEvent, number>() };
  return {
    attemptedRef,
    props: {
      atLiveEndRef: { current: false },
      eventId: undefined,
      forceTimelineUpdate: vi.fn(),
      mx: harness.mx,
      persistThreadEventCache: vi.fn(),
      room: harness.room,
      scrollRef: { current: null },
      scrollToBottomRef: { current: { count: 0, smooth: false } },
      setThreadTimelineTick: vi.fn(),
      threadEditFetchAttemptedRef: attemptedRef,
      threadEvents,
      threadId: '$thread-root',
      threadIdRef: { current: '$thread-root' },
      threadTailLoaded: true,
    },
  };
};

const Harness = (props: Parameters<typeof useThreadEditBackfillController>[0]) => {
  useThreadEditBackfillController(props);
  return null;
};

const flush = async () => {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

describe('useThreadEditBackfillController (task #129)', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.restoreAllMocks());

  it('does NOT mark an event attempted before its fetch resolves', async () => {
    // Red-without-fix: the old controller marked attempted synchronously
    // at effect start, so this assertion failed (event already marked
    // while the fetch was still pending).
    const harness = makeHarness();
    const target = makePlaceholder('$t1');
    const { attemptedRef, props } = makeProps(harness, [target]);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
      await flush();
    });

    // Fetch is in flight (deferred not resolved): must not be marked yet.
    expect(harness.relations).toHaveBeenCalledTimes(1);
    expect(attemptedRef.current.has(target)).toBe(false);

    // Resolve → definitive outcome → now marked, edit applied.
    await act(async () => {
      harness.deferreds.get('$t1')!.resolve();
      await flush();
    });
    expect(attemptedRef.current.has(target)).toBe(true);
    expect(target.replacingEvent()?.getId()).toBe('$edit-$t1');

    act(() => renderer.unmount());
  });

  it('resolves an event across a threadEvents churn without stranding or duplicating the fetch', async () => {
    // The core band bug. Old code marked attempted UP FRONT and cancelled
    // the in-flight batch on any threadEvents change → the gate refused
    // to re-select the event → permanent placeholder. Fixed code does not
    // cancel on churn (the pending fetch stays valid) and does not mark
    // before it resolves, so the edit is applied by the ORIGINAL fetch —
    // exactly once — despite the churn.
    //   old code : replacingEvent() undefined (stranded)
    //   fixed    : edit applied, relations called exactly 1x
    const harness = makeHarness();
    const target = makePlaceholder('$t2');
    const { props } = makeProps(harness, [target]);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);

    // Churn while the fetch is pending: must not cancel it, must not
    // launch a duplicate (the id is in-flight).
    await act(async () => {
      renderer.update(React.createElement(Harness, { ...props, threadEvents: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);

    // The original fetch resolves → edit applied.
    await act(async () => {
      harness.deferreds.get('$t2')!.resolve();
      await flush();
    });
    expect(target.replacingEvent()?.getId()).toBe('$edit-$t2');

    act(() => renderer.unmount());
  });

  it('retries after a transient fetch error (never marks a failed fetch attempted)', async () => {
    // A failed fetch is non-definitive: it must not mark attempted, so a
    // later effect run refetches and resolves. Old code marked up front,
    // so a fetch error left the event marked → never retried.
    //   old code : relations 1x, replacingEvent() undefined
    //   fixed    : relations 2x, edit applied
    const harness = makeHarness();
    const target = makePlaceholder('$t4');
    harness.failOnce.add('$t4');
    const { props } = makeProps(harness, [target]);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
      await flush();
    });
    // First fetch rejected → not applied, not marked.
    expect(harness.relations).toHaveBeenCalledTimes(1);
    expect(target.replacingEvent()).toBeFalsy();

    // Churn re-runs the effect → refetch (now succeeds) → resolve.
    await act(async () => {
      renderer.update(React.createElement(Harness, { ...props, threadEvents: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(2);
    await act(async () => {
      harness.deferreds.get('$t4')!.resolve();
      await flush();
    });
    expect(target.replacingEvent()?.getId()).toBe('$edit-$t4');

    act(() => renderer.unmount());
  });

  it('does not refetch an event whose fetch is still in flight when the effect re-runs', async () => {
    // In-flight guard: while a fetch is pending, a churn-triggered effect
    // re-run must NOT launch a duplicate fetch for the same event id
    // (would be a request storm now that the upfront mark is gone). The
    // token-map keyed by event id enforces this across overlapping runs.
    const harness = makeHarness();
    const target = makePlaceholder('$t3');
    const { props } = makeProps(harness, [target]);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(Harness, props));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);

    // Churn while the fetch is STILL pending (deferred not resolved):
    // the re-run sees the id in-flight and must issue no second fetch.
    await act(async () => {
      renderer.update(React.createElement(Harness, { ...props, threadEvents: [target] }));
      await flush();
    });
    expect(harness.relations).toHaveBeenCalledTimes(1);

    // Resolve → the (now-cancelled first) fetch releases its claim
    // without marking; a later churn is free to retry.
    await act(async () => {
      harness.deferreds.get('$t3')!.resolve();
      await flush();
    });

    act(() => renderer.unmount());
  });
});
