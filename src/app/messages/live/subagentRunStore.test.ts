import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import type { LiveDocs } from '../../matrix/protocol/liveFrame';
import {
  parseSubagentFrame,
  type SubagentFrame,
  type SubagentMeta,
  type SubagentStatus,
} from '../../matrix/protocol/subagentFrame';
import fixture from './__fixtures__/subagent-frames-v1.json';
import {
  countActiveSubagentRuns,
  getSubagentRunStore,
  SUBAGENT_QUIET_RUN_KEPT_MS,
  SUBAGENT_WORKING_RUN_FRESHNESS_MS,
  SubagentRunStore,
  useRoomSubagentRuns,
  type SubagentRun,
} from './subagentRunStore';

const ROOM = '!room:example';
const OTHER_ROOM = '!other:example';
const RUN = 'del-1';
const AGENT = '@mindroom_helper:example';
const SID = '1762790000123-0a1b2c3d';
const NEWER_SID = '1762790009999-0a1b2c3d';

type FrameOptions = { sid?: string; status?: SubagentStatus; extra?: Partial<SubagentMeta> };

const meta = (status: SubagentStatus, extra: Partial<SubagentMeta> = {}): SubagentMeta => ({
  agent: 'helper',
  caller: 'lead',
  root: 'lead',
  parent: null,
  threadId: '$thread:example',
  source: 'delegate',
  status,
  startedAt: 1762790000,
  endedAt: null,
  ...extra,
});
const docs = (md: string): LiveDocs => ({
  md,
  reasoning: '',
  tools: [],
  status: 'streaming',
  activity: '',
});
const snapshot = (
  seq: number,
  md: string,
  { sid = SID, status = 'running', extra = { task: 'Look it up.' } }: FrameOptions = {}
): SubagentFrame => ({ run: RUN, sid, seq, meta: meta(status, extra), snapshot: docs(md) });
const append = (
  seq: number,
  before: string,
  ins: string,
  { sid = SID, status = 'running' }: FrameOptions = {}
): SubagentFrame => ({
  run: RUN,
  sid,
  seq,
  meta: meta(status),
  delta: { md: { at: before.length, del: 0, ins, len: before.length + ins.length } },
});

describe('SubagentRunStore', () => {
  let store: SubagentRunStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new SubagentRunStore();
  });

  afterEach(() => {
    store.clear();
    vi.useRealTimers();
  });

  const run = (roomId = ROOM): SubagentRun | undefined => store.runs(roomId)[0];

  it('ignores a delta before any snapshot and shows the run from the next snapshot', () => {
    store.ingest(ROOM, AGENT, append(1, 'Hello', '!'), 1000);
    expect(store.runs(ROOM)).toEqual([]);

    store.ingest(ROOM, AGENT, snapshot(2, 'Hello!'), 1100);

    expect(store.runs(ROOM)).toEqual([
      {
        roomId: ROOM,
        run: RUN,
        sender: AGENT,
        meta: meta('running', { task: 'Look it up.' }),
        docs: docs('Hello!'),
        sid: SID,
        seq: 2,
        lastFrameAt: 1100,
        stale: false,
      },
    ]);
  });

  it('takes the meta of the latest frame and the task and result of the latest snapshot', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, AGENT, append(1, 'Hello', '!', { status: 'awaiting_approval' }), 1100);
    expect(run()).toMatchObject({
      seq: 1,
      docs: docs('Hello!'),
      meta: { status: 'awaiting_approval', task: 'Look it up.' },
    });

    store.ingest(
      ROOM,
      AGENT,
      snapshot(2, 'Hello!', {
        status: 'completed',
        extra: { task: 'Look it up again.', result: 'Found it.' },
      }),
      1200
    );
    store.ingest(ROOM, AGENT, append(3, 'Hello!', '?', { status: 'completed' }), 1300);

    expect(run()?.meta).toEqual(
      meta('completed', { task: 'Look it up again.', result: 'Found it.' })
    );
  });

  it('waits for the next snapshot after a delta that does not follow what it holds', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, AGENT, append(2, 'Hello,', ' world'), 1100);
    expect(run()).toMatchObject({ seq: 0, docs: docs('Hello'), lastFrameAt: 1000, stale: true });

    store.ingest(ROOM, AGENT, append(1, 'Hello', ','), 1200);
    store.ingest(ROOM, AGENT, append(3, 'Hello, world', '!'), 1300);
    expect(run()).toMatchObject({ seq: 0, docs: docs('Hello'), stale: true });

    store.ingest(ROOM, AGENT, snapshot(4, 'Hello, world!'), 1400);
    store.ingest(ROOM, AGENT, append(5, 'Hello, world!', '?'), 1500);

    expect(run()).toMatchObject({ seq: 5, docs: docs('Hello, world!?'), stale: false });
  });

  it('ignores older and duplicate frames', () => {
    store.ingest(ROOM, AGENT, snapshot(3, 'Newest'), 1000);
    store.ingest(ROOM, AGENT, snapshot(3, 'Duplicate'), 1100);
    store.ingest(ROOM, AGENT, snapshot(2, 'Older'), 1200);
    store.ingest(ROOM, AGENT, append(3, 'Newest', '!'), 1300);

    expect(run()).toMatchObject({ seq: 3, docs: docs('Newest'), lastFrameAt: 1000 });
  });

  it('lets a newer stream replace the run with its first snapshot', () => {
    store.ingest(ROOM, AGENT, snapshot(9, 'First stream'), 1000);
    store.ingest(ROOM, AGENT, append(0, 'Restarted', '!', { sid: NEWER_SID }), 1100);
    expect(run()).toMatchObject({ sid: SID, docs: docs('First stream'), stale: true });

    store.ingest(ROOM, AGENT, snapshot(1, 'Restarted', { sid: NEWER_SID }), 1200);
    store.ingest(ROOM, AGENT, snapshot(10, 'Old stream'), 1300);

    expect(run()).toMatchObject({ sid: NEWER_SID, seq: 1, docs: docs('Restarted') });
  });

  it('ignores a delta without changes', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    const held = run();
    const listener = vi.fn();
    store.subscribe(ROOM, listener);

    store.ingest(
      ROOM,
      AGENT,
      { run: RUN, sid: SID, seq: 1, meta: meta('running'), delta: {} },
      1100
    );

    expect(run()).toBe(held);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the sender of the first frame for the run', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    store.ingest(ROOM, '@mindroom_other:example', snapshot(5, 'Forged'), 1100);

    expect(run()).toMatchObject({ sender: AGENT, seq: 0, docs: docs('Hello') });
  });

  it('keeps the runs of each room apart', () => {
    store.ingest(ROOM, AGENT, snapshot(0, 'Here'), 1000);
    store.ingest(OTHER_ROOM, AGENT, snapshot(0, 'There'), 1000);

    expect(run()?.docs.md).toBe('Here');
    expect(run(OTHER_ROOM)).toMatchObject({ roomId: OTHER_ROOM, docs: docs('There') });
  });

  it('counts the runs still at it: running, waiting for approval or paused', () => {
    const statuses: SubagentStatus[] = [
      'running',
      'awaiting_approval',
      'paused',
      'completed',
      'failed',
      'cancelled',
      'denied',
    ];
    statuses.forEach((status) =>
      store.ingest(ROOM, AGENT, { ...snapshot(0, status, { status }), run: status }, 1000)
    );

    expect(store.runs(ROOM)).toHaveLength(7);
    expect(countActiveSubagentRuns(store.runs(ROOM))).toBe(3);
    expect(countActiveSubagentRuns(store.runs(OTHER_ROOM))).toBe(0);
  });

  it('shows each run of the fixture as its last frame leaves it', () => {
    fixture.cases.forEach((testCase, index) => {
      const frame = parseSubagentFrame(testCase.frame);
      if (frame) store.ingest(ROOM, AGENT, frame, 1000 + index);
    });

    const [first, nested] = store.runs(ROOM);
    const lastOfFirst = fixture.cases.filter((testCase) => testCase.frame.run === 'del-1').at(-1);
    const lastFrame = parseSubagentFrame(lastOfFirst?.frame);
    expect(lastFrame?.meta).toMatchObject({ status: 'completed', result: expect.any(String) });
    expect(first).toMatchObject({
      run: 'del-1',
      seq: lastFrame?.seq,
      docs: lastOfFirst?.after,
      meta: lastFrame?.meta,
      stale: false,
    });
    expect(nested).toMatchObject({ run: 'del-2', meta: { status: 'cancelled' } });
    expect(nested?.meta.result).toBeUndefined();
  });

  describe('expiry', () => {
    it.each<SubagentStatus>(['running', 'awaiting_approval'])(
      'drops a %s run 30 seconds after its last frame',
      (status) => {
        expect(SUBAGENT_WORKING_RUN_FRESHNESS_MS).toBe(30_000);
        const listener = vi.fn();
        store.subscribe(ROOM, listener);
        store.ingest(ROOM, AGENT, snapshot(0, 'Hello', { status }), Date.now());
        vi.advanceTimersByTime(SUBAGENT_WORKING_RUN_FRESHNESS_MS - 1000);
        store.ingest(ROOM, AGENT, snapshot(1, 'Hello', { status }), Date.now());
        listener.mockClear();

        vi.advanceTimersByTime(SUBAGENT_WORKING_RUN_FRESHNESS_MS - 1);
        expect(run()).toBeDefined();
        expect(listener).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(store.runs(ROOM)).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(1);
      }
    );

    it.each<SubagentStatus>(['paused', 'completed', 'failed', 'cancelled', 'denied'])(
      'keeps a %s run 30 minutes after its last frame',
      (status) => {
        expect(SUBAGENT_QUIET_RUN_KEPT_MS).toBe(30 * 60 * 1000);
        store.ingest(ROOM, AGENT, snapshot(0, 'Hello', { status }), Date.now());

        vi.advanceTimersByTime(SUBAGENT_QUIET_RUN_KEPT_MS - 1);
        expect(run()?.meta.status).toBe(status);

        vi.advanceTimersByTime(1);
        expect(store.runs(ROOM)).toEqual([]);
      }
    );

    it('keeps a run that ends 30 minutes, also when its end comes in the same millisecond', () => {
      store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
      store.ingest(ROOM, AGENT, snapshot(1, 'Hello', { status: 'completed' }), 1000);

      vi.advanceTimersByTime(SUBAGENT_QUIET_RUN_KEPT_MS - 1);
      expect(run()?.meta.status).toBe('completed');
      vi.advanceTimersByTime(1);
      expect(store.runs(ROOM)).toEqual([]);
    });

    it('gives a working run 30 seconds again once it resumes from a pause', () => {
      store.ingest(ROOM, AGENT, snapshot(0, 'Hello', { status: 'paused' }), 1000);
      store.ingest(ROOM, AGENT, snapshot(1, 'Hello'), 2000);

      vi.advanceTimersByTime(SUBAGENT_WORKING_RUN_FRESHNESS_MS);

      expect(store.runs(ROOM)).toEqual([]);
    });

    it('does not count a frame that did not apply as a sign of life', () => {
      store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), Date.now());
      vi.advanceTimersByTime(20_000);
      store.ingest(ROOM, AGENT, append(2, 'Hello,', ' world'), Date.now());
      store.ingest(ROOM, AGENT, append(3, 'Hello, world', '!'), Date.now());

      vi.advanceTimersByTime(SUBAGENT_WORKING_RUN_FRESHNESS_MS - 20_000);

      expect(store.runs(ROOM)).toEqual([]);
    });
  });

  it("tells a room's subscribers once per change and keeps its list between changes", () => {
    const listener = vi.fn();
    const other = vi.fn();
    const unsubscribe = store.subscribe(ROOM, listener);
    store.subscribe(OTHER_ROOM, other);
    expect(store.runs(ROOM)).toBe(store.runs(ROOM));

    store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000);
    const list = store.runs(ROOM);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.runs(ROOM)).toBe(list);

    store.ingest(ROOM, AGENT, snapshot(0, 'Duplicate'), 1100);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.runs(ROOM)).toBe(list);

    store.ingest(ROOM, AGENT, append(1, 'Hello', '!'), 1200);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.runs(ROOM)).not.toBe(list);

    unsubscribe();
    store.ingest(ROOM, AGENT, append(2, 'Hello!', '?'), 1300);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(other).not.toHaveBeenCalled();
  });

  it('clears every run and timer and tells each room', () => {
    const listener = vi.fn();
    const other = vi.fn();
    store.subscribe(ROOM, listener);
    store.subscribe(OTHER_ROOM, other);
    store.ingest(ROOM, AGENT, snapshot(0, 'Here'), 1000);
    store.ingest(OTHER_ROOM, AGENT, snapshot(0, 'There'), 1000);
    listener.mockClear();
    other.mockClear();

    store.clear();

    expect(store.runs(ROOM)).toEqual([]);
    expect(store.runs(OTHER_ROOM)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('useRoomSubagentRuns', () => {
  it("renders the room's runs of the active client and again when they change", () => {
    const mx = {} as MatrixClient;
    const store = getSubagentRunStore(mx);
    const seen: (readonly SubagentRun[])[] = [];
    function Probe() {
      seen.push(useRoomSubagentRuns(ROOM));
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        React.createElement(MatrixClientProvider, { value: mx }, React.createElement(Probe))
      );
    });
    expect(seen.at(-1)).toEqual([]);

    act(() => store.ingest(ROOM, AGENT, snapshot(0, 'Hello'), 1000));
    expect(seen.at(-1)).toEqual(store.runs(ROOM));
    expect(seen.at(-1)?.[0]?.docs.md).toBe('Hello');

    const renders = seen.length;
    act(() => store.ingest(OTHER_ROOM, AGENT, snapshot(0, 'Elsewhere'), 1000));
    expect(seen).toHaveLength(renders);

    act(() => renderer?.unmount());
    store.clear();
    expect(getSubagentRunStore(mx)).toBe(store);
    expect(getSubagentRunStore({} as MatrixClient)).not.toBe(store);
  });
});
