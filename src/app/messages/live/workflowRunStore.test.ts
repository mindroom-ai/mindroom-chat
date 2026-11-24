import { afterEach, describe, expect, it, vi } from 'vitest';
import frames from './__fixtures__/workflow-frames-v1.json';
import { parseWorkflowFrame } from '../../matrix/protocol/workflowFrame';
import {
  parseWorkflowRunCard,
  WORKFLOW_RUN_CONTENT_KEY,
} from '../../matrix/protocol/workflowRunContent';
import {
  WORKFLOW_RUN_FRESHNESS_MS,
  WORKFLOW_RUN_KEPT_MS,
  WorkflowRunStore,
} from './workflowRunStore';

const firstFrame = frames[0]!;
const thirdFrame = frames[2]!;
const fourthFrame = frames[3]!;
const ROOM = '!room:example.org';
const AGENT = '@mindroom_panels:example.org';
const OTHER_AGENT = '@mindroom_other:example.org';
const RUN = firstFrame.run;

const parse = (raw: unknown) => {
  const frame = parseWorkflowFrame(raw);
  if (!frame) throw new Error('Expected frame to parse');
  return frame;
};

describe('WorkflowRunStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a delta only right after the frame before it, turning stale on a gap', () => {
    const store = new WorkflowRunStore();
    store.ingest(ROOM, AGENT, parse(firstFrame), 0);
    store.ingest(ROOM, AGENT, parse(thirdFrame), 1);
    expect(store.get(ROOM, RUN)).toMatchObject({ seq: 1, stale: true });

    store.ingest(ROOM, AGENT, parse(fourthFrame), 2);
    expect(store.get(ROOM, RUN)).toMatchObject({
      seq: 4,
      stale: false,
      graph: { omitted: { queued: 412, completed: 12 } },
    });
  });

  it('keeps a counts-only snapshot and its omitted counts', () => {
    const store = new WorkflowRunStore();
    const countsOnly = parse({
      ...fourthFrame,
      snapshot: {
        phases: [],
        groups: [],
        nodes: [],
        edges: [],
        omitted: {
          queued: 1000,
          running: 0,
          waiting: 0,
          completed: 0,
          failed: 0,
          edges: 0,
          groups: 0,
          phases: 0,
          log: 0,
        },
        log: [],
      },
    });
    store.ingest(ROOM, AGENT, countsOnly, 100);
    expect(store.get(ROOM, RUN)?.graph.omitted.queued).toBe(1000);
    expect(store.get(ROOM, RUN)?.meta.counts.queued).toBe(412);
  });

  it('follows a new stream after a restart', () => {
    const store = new WorkflowRunStore();
    store.ingest(ROOM, AGENT, parse({ ...firstFrame, sid: 'a', seq: 40 }), 10);
    store.ingest(ROOM, AGENT, parse({ ...fourthFrame, sid: 'b', seq: 1 }), 20);
    expect(store.get(ROOM, RUN)).toMatchObject({ sid: 'b', seq: 1, stale: false });
  });

  it('ignores frames of another sender for a held run', () => {
    const store = new WorkflowRunStore();
    store.ingest(ROOM, AGENT, parse(firstFrame), 10);
    store.ingest(ROOM, OTHER_AGENT, parse(fourthFrame), 20);
    expect(store.get(ROOM, RUN)).toMatchObject({ sender: AGENT, seq: 1 });
  });

  it('marks a live run stale after freshness timeout and drops ended runs after retention', () => {
    vi.useFakeTimers();
    const store = new WorkflowRunStore();
    store.ingest(ROOM, AGENT, parse(firstFrame), 1000);
    expect(store.get(ROOM, RUN)?.stale).toBe(false);

    vi.advanceTimersByTime(WORKFLOW_RUN_FRESHNESS_MS);
    expect(store.get(ROOM, RUN)?.stale).toBe(true);

    store.ingest(
      ROOM,
      AGENT,
      parse({
        ...fourthFrame,
        seq: 5,
        meta: { ...fourthFrame.meta, status: 'completed', ended_at: 1795389900 },
      }),
      2000
    );
    expect(store.get(ROOM, RUN)?.stale).toBe(false);
    vi.advanceTimersByTime(WORKFLOW_RUN_KEPT_MS - 1);
    expect(store.get(ROOM, RUN)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(store.get(ROOM, RUN)).toBeUndefined();
  });

  it('shows a finished card graph only when it holds nothing newer', () => {
    const store = new WorkflowRunStore();
    const card = parseWorkflowRunCard({
      [WORKFLOW_RUN_CONTENT_KEY]: {
        run: RUN,
        job_id: 'job-1',
        requester: '@alex:example.org',
        title: 'Audit the sample module',
        status: 'completed',
        counts: fourthFrame.meta.counts,
        usage: {
          ...fourthFrame.meta.usage,
          cost_usd: '0.504',
          attempt_cost_usd: '0.504',
          projected_cost_usd: '0.504',
        },
        phases: ['Audit'],
        attempt: 1,
        started_at: 1795389735,
        ended_at: 1795389811,
        error: null,
        large: true,
        graph: firstFrame.snapshot,
      },
    })!;

    store.showCard(ROOM, AGENT, card, 500);
    expect(store.getView(ROOM, RUN)?.graph?.nodes).toHaveLength(2);

    const storeWithLive = new WorkflowRunStore();
    storeWithLive.ingest(
      ROOM,
      AGENT,
      parse({
        ...fourthFrame,
        meta: { ...fourthFrame.meta, status: 'completed', ended_at: 1795389900 },
      }),
      100
    );
    storeWithLive.showCard(ROOM, AGENT, card, 500);
    expect(storeWithLive.get(ROOM, RUN)?.seq).toBe(4);
    expect(storeWithLive.getView(ROOM, RUN)?.graph?.omitted.queued).toBe(412);
  });

  it('yields stale live running status to a durable waiting card while preserving the last graph', () => {
    vi.useFakeTimers();
    const store = new WorkflowRunStore();
    store.ingest(ROOM, AGENT, parse(firstFrame), 1000);
    vi.advanceTimersByTime(WORKFLOW_RUN_FRESHNESS_MS);
    const waitingCard = parseWorkflowRunCard({
      [WORKFLOW_RUN_CONTENT_KEY]: {
        run: RUN,
        job_id: 'job-1',
        requester: '@alex:example.org',
        title: 'Audit the sample module',
        status: 'waiting',
        counts: {
          queued: 0,
          running: 1,
          waiting: 1,
          completed: 0,
          failed: 0,
          indeterminate: 0,
          cached: 0,
        },
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          tool_calls: 2,
          cost_usd: '0.05',
          cost_unknown: false,
        },
        phases: ['Audit'],
        attempt: 1,
        started_at: 1795389735,
        ended_at: null,
        error: null,
        large: false,
      },
    })!;
    store.showCard(ROOM, AGENT, waitingCard, 35_000);
    const view = store.getView(ROOM, RUN);
    expect(view?.status).toBe('waiting');
    expect(view?.graph?.nodes).toHaveLength(2);
    expect(view?.stale).toBe(true);
  });

  it('keeps a richer terminal live graph on a same-attempt terminal tie while keeping card error/requester', () => {
    const store = new WorkflowRunStore();
    const baseNode = (id: string) => ({
      id,
      kind: 'agent',
      label: `Task ${id}`,
      name: id,
      phase: 0,
      group: null,
      status: 'completed',
      waiting_on: null,
      agent: 'panels',
      model: null,
      run: null,
      job: null,
      session: null,
      turns: 1,
      started_at: 1795389736,
      ended_at: 1795389811,
      cached: false,
      error: null,
    });
    store.ingest(
      ROOM,
      AGENT,
      parse({
        ...firstFrame,
        meta: { ...firstFrame.meta, status: 'failed', attempt: 1, ended_at: 1795389811 },
        snapshot: {
          ...firstFrame.snapshot,
          nodes: [baseNode('n1'), baseNode('n2'), baseNode('n3'), baseNode('n4')],
        },
      }),
      1000
    );
    const finalCard = parseWorkflowRunCard({
      [WORKFLOW_RUN_CONTENT_KEY]: {
        run: RUN,
        job_id: 'job-1',
        requester: '@alex:example.org',
        title: 'Audit the sample module',
        status: 'failed',
        counts: {
          queued: 0,
          running: 0,
          waiting: 0,
          completed: 3,
          failed: 1,
          indeterminate: 0,
          cached: 0,
        },
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          tool_calls: 2,
          cost_usd: '0.05',
          cost_unknown: false,
        },
        phases: ['Audit'],
        attempt: 1,
        started_at: 1795389735,
        ended_at: 1795389811,
        error: 'Budget exceeded',
        large: false,
        graph: {
          phases: ['Audit'],
          groups: [],
          nodes: [baseNode('n1')],
          edges: [],
          omitted: {
            queued: 0,
            running: 0,
            waiting: 0,
            completed: 3,
            failed: 0,
            edges: 0,
            groups: 0,
            phases: 0,
            log: 0,
          },
          log: [],
        },
      },
    })!;
    store.showCard(ROOM, AGENT, finalCard, 2000);
    const view = store.getView(ROOM, RUN);
    expect(view?.error).toBe('Budget exceeded');
    expect(view?.requester).toBe('@alex:example.org');
    expect(view?.graph?.nodes).toHaveLength(4);
  });

  it('does not revert progress to an older running card when live frames go stale', () => {
    vi.useFakeTimers();
    const store = new WorkflowRunStore();
    const oldCard = parseWorkflowRunCard({
      [WORKFLOW_RUN_CONTENT_KEY]: {
        run: RUN,
        job_id: 'job-1',
        requester: '@alex:example.org',
        title: 'Audit the sample module',
        status: 'running',
        counts: {
          queued: 50,
          running: 1,
          waiting: 0,
          completed: 0,
          failed: 0,
          indeterminate: 0,
          cached: 0,
        },
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          tool_calls: 0,
          cost_usd: '0.00',
          cost_unknown: false,
        },
        phases: ['Audit'],
        attempt: 1,
        started_at: 1795389735,
        ended_at: null,
        error: null,
        large: false,
      },
    })!;
    store.showCard(ROOM, AGENT, oldCard, 1000);
    store.ingest(
      ROOM,
      AGENT,
      parse({
        ...firstFrame,
        meta: {
          ...firstFrame.meta,
          status: 'running',
          counts: {
            queued: 5,
            running: 1,
            waiting: 0,
            completed: 45,
            failed: 0,
            indeterminate: 0,
            cached: 0,
          },
        },
      }),
      5000
    );
    vi.advanceTimersByTime(WORKFLOW_RUN_FRESHNESS_MS);
    const view = store.getView(ROOM, RUN);
    expect(view?.counts.completed).toBe(45);
    expect(view?.stale).toBe(true);
  });
});
