import { describe, expect, it } from 'vitest';
import type {
  WorkflowRunGraph,
  WorkflowRunGroup,
  WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import type { SubagentRun } from '../../messages/live/subagentRunStore';
import {
  bandPrecedesBand,
  foldGroupItems,
  formatWorkflowModelLabel,
  groupFlowItems,
  isCollapsiblePlumbingItem,
  itemPrecedesItem,
  layoutWorkflowRunGraph,
  nodeResultPreview,
  shortNodeError,
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

  it('prefers group over session so spawned turns stay inside Parallel groups and omits empty root sessions', () => {
    const layout = layoutWorkflowRunGraph(
      makeGraph({
        phases: ['Audit'],
        groups: [makeGroup('g1', { kind: 'parallel', phase: 0, total: 2, done: 2 })],
        nodes: [
          makeNode('s1', {
            kind: 'session',
            label: 'Reviewer session',
            name: 'reviewer',
            phase: 0,
            model: 'gemini_flash@minimal',
            turns: 2,
          }),
          makeNode('s2', {
            kind: 'session',
            label: 'Fresh session',
            name: 'fresh',
            phase: 0,
            turns: 0,
          }),
          makeNode('n4', { kind: 'turn', phase: 0, group: 'g1', session: 's1' }),
          makeNode('n5', { kind: 'turn', phase: 0, group: 'g1', session: 's1' }),
        ],
      })
    );

    // s1 is omitted from roots (completed, no error/job/run, all emitted turns in g1); s2 (0 turns) stays.
    expect(ids(layout.bands[0]!.items)).toEqual(['g1', 's2']);
    const groupItem = layout.bands[0]!.items[0];
    expect(groupItem?.type === 'group' ? ids(groupItem.items) : []).toEqual(['n4', 'n5']);
    expect(layout.sessionsById.get('s1')).toEqual({
      id: 's1',
      label: 'Reviewer session',
      name: 'reviewer',
      model: 'gemini_flash@minimal',
      turns: 2,
    });
    expect(layout.stepCount).toBe(3);
  });

  it('groups standalone session turns under their session node and keeps orphaned turns', () => {
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

  it('collapses 2+ consecutive completed leaf plumbing items without touching active or failed ones', () => {
    const items: WorkflowGraphItem[] = [
      { type: 'node', node: makeNode('n1', { kind: 'value', status: 'completed' }) },
      { type: 'node', node: makeNode('n2', { kind: 'state', status: 'completed' }) },
      { type: 'node', node: makeNode('n3', { kind: 'agent', status: 'completed' }) },
      { type: 'node', node: makeNode('n4', { kind: 'tool', status: 'completed' }) },
      { type: 'node', node: makeNode('n5', { kind: 'send', status: 'failed', error: 'Dropped' }) },
      { type: 'node', node: makeNode('n6', { kind: 'inbox', status: 'waiting' }) },
    ];
    expect(isCollapsiblePlumbingItem(items[0]!)).toBe(true);
    expect(isCollapsiblePlumbingItem(items[4]!)).toBe(false);
    expect(isCollapsiblePlumbingItem(items[5]!)).toBe(false);

    const grouped = groupFlowItems(items);
    expect(grouped.map((g) => g.type)).toEqual(['plumb_group', 'node', 'node', 'node', 'node']);
    expect(grouped[0]?.type === 'plumb_group' ? grouped[0].nodes.map((n) => n.id) : []).toEqual([
      'n1',
      'n2',
    ]);
  });

  it('derives deduplicated bidirectional in-group peer bridges and skips cross-group edges', () => {
    const layout = layoutWorkflowRunGraph(
      makeGraph({
        phases: ['Audit'],
        groups: [makeGroup('g1', { kind: 'parallel', phase: 0 })],
        nodes: [
          makeNode('n1', { name: 'backend', group: 'g1', phase: 0 }),
          makeNode('n2', { name: 'frontend', group: 'g1', phase: 0 }),
          makeNode('n3', { name: 'qa', group: 'g1', phase: 0 }),
          makeNode('n4', { name: 'summary', phase: 0 }),
        ],
        edges: [
          { from: 'n1', to: 'n2', count: 2 },
          { from: 'n2', to: 'n1', count: 1 },
          { from: 'n2', to: 'n3', count: 1 },
          { from: 'n3', to: 'n4', count: 4 },
        ],
      })
    );
    expect(layout.peerBridgesByGroup.get('g1')).toEqual([
      {
        key: 'n1\0n2',
        fromId: 'n1',
        toId: 'n2',
        fromLabel: 'backend',
        toLabel: 'frontend',
        bidirectional: true,
        count: 3,
      },
      {
        key: 'n2\0n3',
        fromId: 'n2',
        toId: 'n3',
        fromLabel: 'frontend',
        toLabel: 'qa',
        bidirectional: false,
        count: 1,
      },
    ]);
  });

  it('keeps live, job-bearing, or run-bearing sessions visible and resolves turn-to-session bridges inside Parallel groups', () => {
    const layout = layoutWorkflowRunGraph(
      makeGraph({
        phases: ['Audit'],
        groups: [makeGroup('g1', { kind: 'parallel', phase: 0, total: 3, done: 2 })],
        nodes: [
          makeNode('s1', {
            kind: 'session',
            name: 'reviewer',
            phase: 0,
            status: 'completed',
            turns: 1,
          }),
          makeNode('s2', {
            kind: 'session',
            name: 'live-session',
            phase: 0,
            status: 'running',
            turns: 1,
          }),
          makeNode('s3', {
            kind: 'session',
            name: 'job-session',
            phase: 0,
            status: 'completed',
            job: 'job-s3',
            turns: 1,
          }),
          makeNode('n4', { name: 'backend', group: 'g1', phase: 0 }),
          makeNode('n5', { kind: 'turn', name: 'pass1', group: 'g1', session: 's1', phase: 0 }),
          makeNode('n6', { kind: 'turn', name: 'pass2', group: 'g1', session: 's2', phase: 0 }),
          makeNode('n7', { kind: 'turn', name: 'pass3', group: 'g1', session: 's3', phase: 0 }),
        ],
        edges: [{ from: 'n4', to: 's1', count: 2 }],
      })
    );

    // Only completed jobless/runless s1 is omitted; running s2 and job-bearing s3 remain visible.
    expect(ids(layout.bands[0]!.items)).toEqual(['g1', 's2', 's3']);
    expect(layout.peerBridgesByGroup.get('g1')).toEqual([
      {
        key: 'n4\0s1',
        fromId: 'n4',
        toId: 's1',
        fromLabel: 'backend',
        toLabel: 'reviewer',
        bidirectional: false,
        count: 2,
      },
    ]);
  });

  it('preserves ascending execution order when folding a 25-item sequential group', () => {
    const items: WorkflowGraphItem[] = Array.from({ length: 25 }, (_, i) => ({
      type: 'node',
      node: makeNode(`n${i + 1}`, { status: 'completed', endedAt: 1000 + i }),
    }));
    const { shown, more } = foldGroupItems(items, 24, true);
    expect(more).toBe(1);
    expect(shown).toHaveLength(24);
    expect(ids(shown)[0]).toBe('n2');
    expect(ids(shown)[23]).toBe('n25');
    expect(ids(shown)).toEqual(Array.from({ length: 24 }, (_, i) => `n${i + 2}`));
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
      items.push({ type: 'node', node: makeNode(`n${i}`, { status: 'running', endedAt: null }) });
    }
    for (let i = 296; i <= 300; i += 1) {
      items.push({ type: 'node', node: makeNode(`n${i}`, { status: 'failed', endedAt: 1500 }) });
    }
    const { shown, more } = foldGroupItems(items);
    expect(shown).toHaveLength(24);
    expect(
      shown.slice(0, 20).every((item) => item.type === 'node' && item.node.status !== 'completed')
    ).toBe(true);
    expect(shown.slice(20).map((item) => (item.type === 'node' ? item.node.id : ''))).toEqual([
      'n280',
      'n279',
      'n278',
      'n277',
    ]);
    expect(more).toBe(276);
  });

  it('formats raw config@effort model strings while preserving friendly labels and subagent models', () => {
    expect(formatWorkflowModelLabel('gemini_flash@minimal')).toBe('gemini_flash · minimal');
    expect(formatWorkflowModelLabel('Fable 5.2')).toBe('Fable 5.2');
    expect(formatWorkflowModelLabel('Sol · GPT-6.2')).toBe('Sol · GPT-6.2');
    expect(
      formatWorkflowModelLabel('gemini_flash@minimal', {
        modelConfig: 'fable',
        modelDisplayName: 'Fable 5.2',
      })
    ).toBe('Fable 5.2');
    expect(formatWorkflowModelLabel(undefined)).toBeUndefined();
  });

  it('strips code fences verbatim without rounding 64-bit JSON integers, and truncates to 300 chars', () => {
    expect(nodeResultPreview(undefined)).toBeUndefined();
    expect(nodeResultPreview(makeSubagent('Summary ready.', 'Earlier line\nLast line'))).toBe(
      'Summary ready.'
    );
    expect(
      nodeResultPreview(makeSubagent('```json\n{"id":9223372036854775807,"ok":true}\n```', ''))
    ).toBe('{"id":9223372036854775807,"ok":true}');
    expect(nodeResultPreview(makeSubagent('```\nPlain fenced text\n```', ''))).toBe(
      'Plain fenced text'
    );
    expect(nodeResultPreview(makeSubagent('```git status```', ''))).toBe('git status');
    expect(nodeResultPreview(makeSubagent(undefined, 'First line\n\nSecond line\n  '))).toBe(
      'Second line'
    );
    expect(nodeResultPreview(makeSubagent('x'.repeat(400), ''))).toHaveLength(300);
  });

  it('extracts concise inline error descriptors with tight timeout detection', () => {
    expect(shortNodeError(null)).toBeNull();
    expect(shortNodeError('Timed out after 120s waiting for reply')).toEqual({ kind: 'timeout' });
    expect(shortNodeError('AgentError(timeout): exceeded 60s')).toEqual({ kind: 'timeout' });
    expect(shortNodeError('Step did not finish in time')).toEqual({ kind: 'timeout' });
    expect(shortNodeError('TimeoutError: upstream gateway')).toEqual({ kind: 'timeout' });
    expect(shortNodeError('no timeout configured; connection refused')).toEqual({
      kind: 'text',
      text: 'no timeout configured',
    });
    expect(shortNodeError('RateLimitError: too many requests')).toEqual({
      kind: 'text',
      text: 'RateLimitError',
    });
    expect(shortNodeError('Error: Connection refused. Retry later')).toEqual({
      kind: 'text',
      text: 'Connection refused',
    });
    const long = shortNodeError('A'.repeat(60));
    expect(long?.kind === 'text' ? long.text : '').toHaveLength(40);
  });

  it('suppresses backwards inter-band arrows when an unphased step ran after a phased step', () => {
    const postPhase = layoutWorkflowRunGraph(
      makeGraph({
        phases: ['Build'],
        nodes: [
          makeNode('n1', { label: 'Compile', phase: 0 }),
          makeNode('n2', { label: 'Publish', phase: null }),
        ],
      })
    );
    expect(postPhase.bands.map((b) => b.phase)).toEqual([null, 'Build']);
    expect(bandPrecedesBand(postPhase.bands[0]!, postPhase.bands[1]!)).toBe(false);

    const forward = layoutWorkflowRunGraph(
      makeGraph({
        phases: ['Build', 'Deploy'],
        nodes: [
          makeNode('n1', { label: 'Compile', phase: 0 }),
          makeNode('n2', { label: 'Publish', phase: 1 }),
        ],
      })
    );
    expect(bandPrecedesBand(forward.bands[0]!, forward.bands[1]!)).toBe(true);

    // Overlapping session subtree (n1 -> turns n2, n5) next to sibling agent n3 suppresses backwards arrow.
    const overlapping = layoutWorkflowRunGraph(
      makeGraph({
        phases: ['Audit'],
        nodes: [
          makeNode('n1', { kind: 'session', phase: 0, turns: 2 }),
          makeNode('n2', { kind: 'turn', phase: 0, session: 'n1' }),
          makeNode('n3', { kind: 'agent', phase: 0 }),
          makeNode('n5', { kind: 'turn', phase: 0, session: 'n1' }),
        ],
      })
    );
    expect(overlapping.bands[0]!.items).toHaveLength(2);
    expect(itemPrecedesItem(overlapping.bands[0]!.items[0]!, overlapping.bands[0]!.items[1]!)).toBe(
      false
    );
    expect(
      itemPrecedesItem(
        { type: 'node', node: makeNode('n1') },
        { type: 'node', node: makeNode('n2') }
      )
    ).toBe(true);
  });

  it('attaches a session turn to its emitted group when its parent session node was omitted', () => {
    const layout = layoutWorkflowRunGraph({
      phases: ['Audit'],
      groups: [
        { id: 'g1', kind: 'foreach', phase: 0, parent: null, total: 50, done: 49, failed: 0 },
      ],
      nodes: [
        makeNode('n2', {
          kind: 'session_turn',
          session: 's1-omitted',
          group: 'g1',
          status: 'running',
        }),
      ],
      edges: [],
      omitted: emptyOmitted,
      log: [],
    });
    expect(layout.bands).toHaveLength(1);
    const groupItem = layout.bands[0]?.items[0];
    expect(groupItem?.type).toBe('group');
    if (groupItem?.type === 'group') {
      expect(groupItem.items[0]?.type === 'node' ? groupItem.items[0].node.id : null).toBe('n2');
    }
  });
});
