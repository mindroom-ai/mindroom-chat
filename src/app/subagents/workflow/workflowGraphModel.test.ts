import { describe, expect, it } from 'vitest';
import type {
  WorkflowRunGraph,
  WorkflowRunGroup,
  WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import type { SubagentRun } from '../../messages/live/subagentRunStore';
import {
  edgePath,
  foldGroupItems,
  layoutWorkflowRunGraph,
  nodeResultPreview,
  type WorkflowGraphItem,
} from './workflowGraphModel';

const emptyOmitted = {
  queued: 0,
  running: 0,
  waiting: 0,
  completed: 0,
  failed: 0,
  edges: 0,
  groups: 0,
  phases: 0,
  log: 0,
};

const makeNode = (id: string, overrides: Partial<WorkflowRunNode> = {}): WorkflowRunNode => ({
  id,
  kind: 'agent',
  label: `Node ${id}`,
  name: null,
  phase: null,
  group: null,
  status: 'completed',
  waitingOn: null,
  session: null,
  turns: 1,
  startedAt: 100,
  endedAt: 120,
  cached: false,
  error: null,
  ...overrides,
});

const makeGroup = (id: string, overrides: Partial<WorkflowRunGroup> = {}): WorkflowRunGroup => ({
  id,
  kind: 'foreach',
  phase: null,
  parent: null,
  total: 2,
  done: 2,
  failed: 0,
  ...overrides,
});

const makeGraph = (overrides: Partial<WorkflowRunGraph> = {}): WorkflowRunGraph => ({
  phases: [],
  groups: [],
  nodes: [],
  edges: [],
  log: [],
  omitted: emptyOmitted,
  ...overrides,
});

const ids = (items: readonly WorkflowGraphItem[]) =>
  items.map((item) => (item.type === 'group' ? item.group.id : item.node.id));

describe('workflowGraphModel', () => {
  it('puts nodes in their group and groups in their phase band, in start order', () => {
    const layout = layoutWorkflowRunGraph(
      makeGraph({
        phases: ['Audit', 'Verify'],
        groups: [makeGroup('n3', { phase: 0 })],
        nodes: [
          makeNode('n9', { phase: 1 }),
          makeNode('n5', { group: 'n3', phase: 0 }),
          makeNode('n4', { group: 'n3', phase: 0 }),
          makeNode('n1'),
        ],
      })
    );
    expect(layout.bands.map((band) => band.phase)).toEqual([null, 'Audit', 'Verify']);
    expect(ids(layout.bands[0]!.items)).toEqual(['n1']);
    expect(ids(layout.bands[1]!.items)).toEqual(['n3']);
    const groupItem = layout.bands[1]!.items[0];
    expect(groupItem?.type === 'group' ? ids(groupItem.items) : []).toEqual(['n4', 'n5']);
    expect(ids(layout.bands[2]!.items)).toEqual(['n9']);
  });

  it('keeps an empty band for phases with no items yet, and no null band for counts-only snapshots', () => {
    const withEmptyPhase = layoutWorkflowRunGraph(
      makeGraph({ phases: ['Audit', 'Verify'], nodes: [makeNode('n1', { phase: 0 })] })
    );
    expect(withEmptyPhase.bands.map((band) => band.phase)).toEqual(['Audit', 'Verify']);
    expect(withEmptyPhase.bands[1]!.items).toEqual([]);

    const countsOnly = layoutWorkflowRunGraph(
      makeGraph({ omitted: { ...emptyOmitted, queued: 1000 } })
    );
    expect(countsOnly.bands).toEqual([]);
  });

  it('keeps a node whose group the frame left out', () => {
    const layout = layoutWorkflowRunGraph(makeGraph({ nodes: [makeNode('n4', { group: 'n3' })] }));
    expect(ids(layout.bands[0]!.items)).toEqual(['n4']);
  });

  it('returns cleanly for groups that name each other as parent, showing each once', () => {
    const layout = layoutWorkflowRunGraph(
      makeGraph({
        groups: [makeGroup('n1', { parent: 'n2' }), makeGroup('n2', { parent: 'n1' })],
      })
    );
    const collectGroupIds = (items: readonly WorkflowGraphItem[]): string[] =>
      items.flatMap((item) =>
        item.type === 'group' ? [item.group.id, ...collectGroupIds(item.items)] : []
      );
    expect(collectGroupIds(layout.bands[0]!.items).sort()).toEqual(['n1', 'n2']);
  });

  it('groups a session turn under its session node in start order and keeps orphaned turns', () => {
    const layout = layoutWorkflowRunGraph(
      makeGraph({
        phases: ['Review'],
        nodes: [
          makeNode('n8', { kind: 'turn', phase: 0, session: 'n2', turns: 2 }),
          makeNode('n5', { kind: 'turn', phase: 0, session: 'n2', turns: 1 }),
          makeNode('n2', { kind: 'session', phase: 0, turns: 2 }),
          makeNode('n9', { kind: 'turn', phase: 0, session: 'n99', turns: 1 }),
        ],
      })
    );
    expect(ids(layout.bands[0]!.items)).toEqual(['n2', 'n9']);
    const sessionItem = layout.bands[0]!.items[0];
    expect(sessionItem?.type === 'node' ? ids(sessionItem.children ?? []) : []).toEqual([
      'n5',
      'n8',
    ]);
  });

  it('nests a workflow group under the agent node that started it', () => {
    const layout = layoutWorkflowRunGraph(
      makeGraph({
        phases: ['Audit'],
        groups: [makeGroup('n2', { kind: 'workflow', phase: 0, parent: 'n1' })],
        nodes: [makeNode('n1', { phase: 0 }), makeNode('n3', { phase: 0, group: 'n2' })],
      })
    );
    expect(ids(layout.bands[0]!.items)).toEqual(['n1']);
    const caller = layout.bands[0]!.items[0];
    const nested = caller?.type === 'node' ? caller.children?.[0] : undefined;
    expect(nested?.type === 'group' ? nested.group.id : null).toBe('n2');
    expect(nested?.type === 'group' ? ids(nested.items) : []).toEqual(['n3']);
  });

  it('folds a group of 300 to its unfinished items and the newest done ones', () => {
    const items: WorkflowGraphItem[] = [];
    for (let i = 1; i <= 280; i += 1) {
      items.push({
        type: 'node',
        node: makeNode(`n${i}`, { status: 'completed', endedAt: 1000 + i }),
      });
    }
    for (let i = 281; i <= 295; i += 1) {
      items.push({
        type: 'node',
        node: makeNode(`n${i}`, { status: 'running', endedAt: null }),
      });
    }
    for (let i = 296; i <= 300; i += 1) {
      items.push({
        type: 'node',
        node: makeNode(`n${i}`, { status: 'failed', endedAt: 1500 }),
      });
    }
    const { shown, more } = foldGroupItems(items);
    expect(shown).toHaveLength(24);
    expect(
      shown.slice(0, 20).every((item) => item.type === 'node' && item.node.status !== 'completed')
    ).toBe(true);
    // Remaining 4 slots hold the newest completed nodes (n280..n277).
    expect(shown.slice(20).map((item) => (item.type === 'node' ? item.node.id : ''))).toEqual([
      'n280',
      'n279',
      'n278',
      'n277',
    ]);
    expect(more).toBe(276);
  });

  it('curves from the bottom of one chip to the top of the one below, and between facing sides otherwise', () => {
    expect(
      edgePath({ x: 0, y: 0, width: 100, height: 40 }, { x: 200, y: 120, width: 100, height: 40 })
    ).toMatch(/^M 50 40 C .* 250 120$/);

    expect(
      edgePath({ x: 0, y: 0, width: 100, height: 40 }, { x: 180, y: 10, width: 100, height: 40 })
    ).toMatch(/^M 100 20 C .* 180 30$/);
  });

  it('previews the subagent run result, else the last non-empty line written, cut to 300 chars', () => {
    const makeSubagent = (result: string | undefined, md: string): SubagentRun => ({
      roomId: '!r:example',
      sender: '@mindroom_panels:example',
      run: 'del-1',
      sid: '1795389735000-a1b2c3d4',
      seq: 1,
      lastFrameAt: 1,
      stale: false,
      meta: {
        agent: 'panels',
        subagent: 'del-1',
        caller: 'panels',
        root: 'panels',
        parent: null,
        threadId: null,
        source: 'workflow',
        status: 'completed',
        startedAt: 1,
        endedAt: 2,
        ...(result !== undefined ? { result } : {}),
      },
      docs: { md, reasoning: '', tools: [], status: 'completed', activity: '', segments: [] },
    });

    expect(nodeResultPreview(undefined)).toBeUndefined();
    expect(nodeResultPreview(makeSubagent('Summary ready.', 'Earlier line\nLast line'))).toBe(
      'Summary ready.'
    );
    expect(nodeResultPreview(makeSubagent(undefined, 'First line\n\nSecond line\n  '))).toBe(
      'Second line'
    );
    const longResult = 'x'.repeat(400);
    expect(nodeResultPreview(makeSubagent(longResult, ''))).toHaveLength(300);
  });
});
