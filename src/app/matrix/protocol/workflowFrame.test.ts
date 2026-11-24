import { describe, expect, it } from 'vitest';
import frames from '../../messages/live/__fixtures__/workflow-frames-v1.json';
import {
  applyWorkflowRunDelta,
  isLiveWorkflowRunStatus,
  parseWorkflowFrame,
  parseWorkflowRunGraph,
  WORKFLOW_FRAME_EVENT_TYPE,
} from './workflowFrame';

const firstFrame = frames[0]!;
const secondFrame = frames[1]!;
const fourthFrame = frames[3]!;

const withNodes = (frame: (typeof frames)[number], nodes: unknown[]) => ({
  ...frame,
  snapshot: { ...frame.snapshot, nodes },
});

describe('workflowFrame', () => {
  it('exports the workflow ephemeral event type', () => {
    expect(WORKFLOW_FRAME_EVENT_TYPE).toBe('io.mindroom.workflow');
  });

  it('parses a snapshot frame into camel case', () => {
    const frame = parseWorkflowFrame(firstFrame);
    expect(frame).not.toBeNull();
    expect(frame?.meta).toMatchObject({
      agent: 'panels',
      threadId: '$thread-sample-1',
      title: 'Audit the sample module',
      status: 'running',
      attempt: 1,
      large: false,
    });
    expect(frame && 'snapshot' in frame && frame.snapshot.nodes[0]).toMatchObject({
      id: 'n2',
      kind: 'agent',
      label: 'Audit auth/session.py',
      waitingOn: null,
      phase: 0,
      group: 'n1',
      session: null,
      turns: 1,
    });
  });

  it('keeps optional saved workflow name, session links, and message edges', () => {
    const frame = parseWorkflowFrame({
      ...firstFrame,
      meta: { ...firstFrame.meta, name: 'audit-module' },
      snapshot: {
        ...firstFrame.snapshot,
        nodes: [
          {
            ...firstFrame.snapshot!.nodes[0],
            id: 'n10',
            kind: 'session',
            turns: 2,
            session: null,
          },
          {
            ...firstFrame.snapshot!.nodes[1],
            id: 'n11',
            kind: 'turn',
            turns: 1,
            session: 'n10',
          },
        ],
        edges: [{ from: 'n10', to: 'n11', kind: 'message', count: 3 }],
      },
    });
    expect(frame?.meta.name).toBe('audit-module');
    expect(frame && 'snapshot' in frame && frame.snapshot.nodes[1]?.session).toBe('n10');
    expect(frame && 'snapshot' in frame && frame.snapshot.edges).toEqual([
      { from: 'n10', to: 'n11', count: 3 },
    ]);
  });

  it('parses decimal string costs from signed card graphs', () => {
    const graph = parseWorkflowRunGraph({
      ...firstFrame.snapshot,
      nodes: [
        {
          ...firstFrame.snapshot!.nodes[0],
          usage: { input_tokens: 100, output_tokens: 20, tool_calls: 1, cost_usd: '0.000096' },
        },
      ],
    });
    expect(graph?.nodes[0]?.usage?.costUsd).toBeCloseTo(0.000096, 8);
  });

  it('keeps the frame and drops a malformed node, group, or edge row', () => {
    const validNode = firstFrame.snapshot!.nodes[0];
    const frame = parseWorkflowFrame({
      ...withNodes(firstFrame, [{ id: 7 }, validNode]),
      snapshot: {
        ...firstFrame.snapshot,
        nodes: [{ id: 7 }, validNode],
        groups: [{ id: 9 }, ...firstFrame.snapshot!.groups],
        edges: [
          { from: 'n1', to: 2, count: 1 },
          { from: 'n2', to: 'n3', kind: 'message', count: 2 },
        ],
      },
    });
    expect(frame && 'snapshot' in frame && frame.snapshot.nodes).toHaveLength(1);
    expect(frame && 'snapshot' in frame && frame.snapshot.groups).toHaveLength(1);
    expect(frame && 'snapshot' in frame && frame.snapshot.edges).toHaveLength(1);
  });

  it('accepts a meta-only empty delta and a counts-only snapshot', () => {
    const metaOnly = parseWorkflowFrame({ ...secondFrame, delta: {} });
    expect(metaOnly && 'delta' in metaOnly).toBe(true);
    const countsOnly = parseWorkflowFrame({
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
          groups: 2,
          phases: 1,
          log: 3,
        },
        log: [],
      },
    });
    expect(countsOnly && 'snapshot' in countsOnly && countsOnly.snapshot.omitted.queued).toBe(1000);
  });

  it.each([
    {},
    { ...firstFrame, run: 'x' },
    { ...firstFrame, meta: null },
    { ...firstFrame, sid: 5 },
    { ...firstFrame, v: 2 },
  ])('drops invalid frame %j', (content) => {
    expect(parseWorkflowFrame(content)).toBeNull();
  });

  it('applies deltas keeping untouched node references and capping log at 20 lines', () => {
    const snap = parseWorkflowFrame({
      ...firstFrame,
      snapshot: {
        ...firstFrame.snapshot,
        log: Array.from({ length: 20 }, (_, i) => `seed-${i}`),
      },
    });
    const delta1 = parseWorkflowFrame({
      ...secondFrame,
      delta: { ...secondFrame.delta, log_append: ['extra-20'] },
    });
    if (!snap || !('snapshot' in snap) || !delta1 || !('delta' in delta1)) {
      throw new Error('Expected fixture frames to parse');
    }
    const after1 = applyWorkflowRunDelta(snap.snapshot, delta1.delta);
    expect(after1.nodes[0]?.status).toBe('completed');
    expect(after1.nodes[1]).toBe(snap.snapshot.nodes[1]);
    expect(after1.groups[0]?.done).toBe(1);
    expect(after1.log).toHaveLength(20);
    expect(after1.log[0]).toBe('seed-1');
    expect(after1.log[19]).toBe('extra-20');
  });

  it('identifies live workflow run statuses', () => {
    expect(isLiveWorkflowRunStatus('starting')).toBe(true);
    expect(isLiveWorkflowRunStatus('running')).toBe(true);
    expect(isLiveWorkflowRunStatus('waiting')).toBe(true);
    expect(isLiveWorkflowRunStatus('completed')).toBe(false);
    expect(isLiveWorkflowRunStatus('failed')).toBe(false);
    expect(isLiveWorkflowRunStatus('cancelled')).toBe(false);
    expect(isLiveWorkflowRunStatus('interrupted')).toBe(false);
  });
});
