// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../../matrix/protocol/backgroundJobsContract';
import type {
  WorkflowFrame,
  WorkflowRunGraph,
  WorkflowRunMeta,
  WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import type { WorkflowRunCard } from '../../matrix/protocol/workflowRunContent';
import { getSubagentRunStore } from '../../messages/live/subagentRunStore';
import { getWorkflowRunStore } from '../../messages/live/workflowRunStore';
import { keepCancelsOf } from '../../matrix/state/sentCancels';
import { subagentsPanelAtom } from '../../navigation/subagentsPanel';
import * as AgentAvatarModule from '../AgentAvatar';
import { WorkflowPanel } from './WorkflowPanel';

const ROOM_ID = '!room:example.org';
const AGENT = '@mindroom_panels:example.org';
const VIEWER = '@alex:example.org';
const RUN = 'wf-11111111111111111111111111111111';

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
  label: `Audit ${id}`,
  name: id,
  phase: 0,
  group: null,
  status: 'running',
  waitingOn: null,
  agent: 'panels',
  model: 'Sol · GPT-6.2',
  session: null,
  turns: 1,
  startedAt: 1795389740,
  endedAt: null,
  cached: false,
  error: null,
  ...overrides,
});

const makeMeta = (overrides: Partial<WorkflowRunMeta> = {}): WorkflowRunMeta => ({
  agent: 'panels',
  threadId: null,
  title: 'Audit the sample module',
  status: 'running',
  attempt: 1,
  startedAt: 1795389735,
  endedAt: null,
  large: false,
  counts: {
    queued: 0,
    running: 2,
    waiting: 0,
    completed: 28,
    failed: 0,
    indeterminate: 0,
    cached: 0,
  },
  usage: {
    inputTokens: 20000,
    outputTokens: 1500,
    toolCalls: 10,
    costUsd: 0.42,
    projectedCostUsd: 0.65,
    costUnknown: false,
  },
  ...overrides,
});

const makeSnapshotFrame = (
  graph: Partial<WorkflowRunGraph>,
  metaOverrides: Partial<WorkflowRunMeta> = {},
  seq = 1
): WorkflowFrame => ({
  run: RUN,
  sid: '1795389735000-a1b2c3d4',
  seq,
  meta: makeMeta(metaOverrides),
  snapshot: {
    phases: ['Audit'],
    groups: [],
    nodes: [],
    edges: [],
    log: [],
    omitted: emptyOmitted,
    ...graph,
  },
});

const makeClient = ({
  sendEvent = vi.fn(async () => ({ event_id: '$sent-1' })),
}: { sendEvent?: ReturnType<typeof vi.fn> } = {}) => {
  const powerLevelsEvent = new MatrixEvent({
    type: 'm.room.power_levels',
    state_key: '',
    room_id: ROOM_ID,
    sender: VIEWER,
    content: {
      users_default: 50,
      events_default: 50,
      events: { [MINDROOM_BACKGROUND_JOB_CANCEL_EVENT]: 50 },
    },
  });
  const createEvent = new MatrixEvent({
    type: 'm.room.create',
    state_key: '',
    room_id: ROOM_ID,
    sender: VIEWER,
    content: { room_version: '11' },
  });
  const currentState = {
    getStateEvents: (type: string, stateKey?: string) => {
      if (type === 'm.room.power_levels') return powerLevelsEvent;
      if (type === 'm.room.create') return createEvent;
      if (type === 'io.mindroom.background_jobs' && stateKey === undefined) return [];
      return null;
    },
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  };
  const room = Object.assign(new EventEmitter(), {
    roomId: ROOM_ID,
    currentState,
    getLiveTimeline: () => ({ getState: () => currentState }),
    getMember: (id: string) => ({
      userId: id,
      name: id === AGENT ? 'panels' : id,
      rawDisplayName: id === AGENT ? 'panels' : id,
      membership: 'join',
      getMxcAvatarUrl: () => undefined,
    }),
    getMembers: () => [
      {
        userId: AGENT,
        name: 'panels',
        rawDisplayName: 'panels',
        membership: 'join',
        getMxcAvatarUrl: () => undefined,
      },
    ],
    getJoinedMembers: () => [
      {
        userId: AGENT,
        name: 'panels',
        rawDisplayName: 'panels',
        membership: 'join',
        getMxcAvatarUrl: () => undefined,
      },
    ],
    getEventForTxnId: () => undefined,
  }) as unknown as Room;
  const mx = Object.assign(new EventEmitter(), {
    getUserId: () => VIEWER,
    getSafeUserId: () => VIEWER,
    getRoom: (id: string) => (id === ROOM_ID ? room : null),
    makeTxnId: () => 'txn-wf-panel',
    sendEvent,
  }) as unknown as MatrixClient;
  (room as unknown as { client: MatrixClient }).client = mx;
  return { mx, room, sendEvent };
};

describe('WorkflowPanel', () => {
  afterEach(() => {
    cleanup();
    keepCancelsOf(ROOM_ID, new Set());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows bands, a group with its progress, and chips joined with sub-agent model', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    const subStore = getSubagentRunStore(mx);

    wfStore.ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        groups: [
          { id: 'n3', kind: 'foreach', phase: 0, parent: null, total: 40, done: 28, failed: 0 },
        ],
        nodes: [
          makeNode('n4', {
            label: 'Audit auth/session.py',
            group: 'n3',
            run: 'delegation-1',
            model: 'fallback-model',
          }),
        ],
      }),
      Date.now()
    );
    subStore.ingest(
      ROOM_ID,
      AGENT,
      {
        run: 'delegation-1',
        sid: '1795389735000-b1c2d3e4',
        seq: 1,
        meta: {
          agent: 'panels',
          subagent: 'delegation-1',
          caller: 'panels',
          root: 'panels',
          parent: null,
          threadId: null,
          source: 'workflow',
          status: 'running',
          startedAt: 1795389740,
          endedAt: null,
          model: {
            modelConfig: 'fable',
            modelDisplayName: 'Fable 5.2',
            modelProvider: 'anthropic',
            modelId: 'claude-fable-5.2',
          },
        },
        snapshot: {
          md: 'Checking tokens.',
          reasoning: '',
          tools: [],
          status: 'streaming',
          activity: '',
          segments: [],
        },
      },
      Date.now()
    );

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    expect(screen.getByRole('heading', { name: 'Audit' })).toBeTruthy();
    expect(screen.getByText('28 of 40')).toBeTruthy();
    const chip = screen.getByRole('button', { name: /Audit auth\/session\.py/ });
    expect(within(chip).getByText('Fable 5.2')).toBeTruthy();
  });

  it('renders 24 chips and Show more for a group of 300, and says what the frame left out', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    const nodes = Array.from({ length: 300 }, (_, i) =>
      makeNode(`n${i + 2}`, {
        label: `Item ${i + 1}`,
        group: 'n1',
        status: i < 280 ? 'completed' : i < 295 ? 'running' : 'failed',
        endedAt: i < 280 ? 1795389800 + i : null,
      })
    );
    wfStore.ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        groups: [
          { id: 'n1', kind: 'foreach', phase: 0, parent: null, total: 300, done: 280, failed: 5 },
        ],
        nodes,
        omitted: { ...emptyOmitted, queued: 412, failed: 30 },
      }),
      Date.now()
    );

    const started = performance.now();
    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );
    const elapsedMs = performance.now() - started;

    expect(elapsedMs).toBeLessThan(1500);
    expect(document.querySelectorAll('[data-workflow-chip-id]')).toHaveLength(24);
    expect(screen.getByRole('button', { name: 'Show 276 more' })).toBeTruthy();
    expect(screen.getByText('and 412 more queued')).toBeTruthy();
    expect(screen.getByText('and 30 more failed')).toBeTruthy();
    expect(screen.getByText('Ask panels for the rest.')).toBeTruthy();
  });

  it('renders a counts-only snapshot as the header numbers and omitted lines', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    wfStore.ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame(
        {
          phases: [],
          groups: [],
          nodes: [],
          edges: [],
          omitted: { ...emptyOmitted, queued: 1000 },
        },
        {
          counts: {
            queued: 1000,
            running: 0,
            waiting: 0,
            completed: 0,
            failed: 0,
            indeterminate: 0,
            cached: 0,
          },
        }
      ),
      Date.now()
    );

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    expect(document.querySelectorAll('[data-workflow-chip-id]')).toHaveLength(0);
    expect(screen.getByText(/and 1,?000 more queued/)).toBeTruthy();
    expect(screen.getByText('Ask panels for the rest.')).toBeTruthy();
  });

  it('shows message counts as text, opens Sub-agents panel on node.run, and stops one agent by node.job', async () => {
    const sendEvent = vi.fn(async () => ({ event_id: '$cancel-node' }));
    const { mx, room } = makeClient({ sendEvent });
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    getSubagentRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      {
        run: 'delegation-1',
        sid: '1795389735000-b1c2d3e4',
        seq: 1,
        meta: {
          agent: 'panels',
          subagent: 'delegation-1',
          caller: 'panels',
          root: 'panels',
          parent: null,
          threadId: null,
          source: 'workflow',
          status: 'running',
          startedAt: 1795389740,
          endedAt: null,
        },
        snapshot: {
          md: 'Reviewing backend.',
          reasoning: '',
          tools: [],
          status: 'streaming',
          activity: '',
          segments: [],
        },
      },
      Date.now()
    );
    wfStore.ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        nodes: [
          makeNode('n4', {
            label: 'Backend reviewer',
            name: 'backend',
            run: 'delegation-1',
            job: 'job-agent-4',
          }),
          makeNode('n5', { label: 'Frontend reviewer', name: 'frontend' }),
        ],
        edges: [{ from: 'n4', to: 'n5', count: 2 }],
      }),
      Date.now()
    );

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Backend reviewer/ }));
    expect(screen.getByText('Messages to frontend: 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(store.get(subagentsPanelAtom)).toEqual({
      roomId: ROOM_ID,
      threadId: null,
      run: 'delegation-1',
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }));
    });
    expect(sendEvent).toHaveBeenCalledWith(
      ROOM_ID,
      MINDROOM_BACKGROUND_JOB_CANCEL_EVENT,
      { job_id: 'job-agent-4' },
      'txn-wf-panel'
    );
  });

  it('re-renders only the chip a delta names', () => {
    vi.useFakeTimers();
    const { mx, room } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    const spy = vi.spyOn(AgentAvatarModule, 'useAgentProfile');
    const rendersFor = (agentName: string) =>
      spy.mock.calls.filter(([, name]) => name === agentName).length;

    const node4 = makeNode('n4', { label: 'Node Four', agent: 'alpha', status: 'running' });
    const node5 = makeNode('n5', {
      label: 'Node Five',
      agent: 'beta',
      status: 'completed',
      endedAt: 1795389790,
    });
    wfStore.ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({ phases: ['Audit'], nodes: [node4, node5] }),
      Date.now()
    );

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );
    expect(rendersFor('alpha')).toBe(1);
    expect(rendersFor('beta')).toBe(1);

    act(() => {
      wfStore.ingest(
        ROOM_ID,
        AGENT,
        {
          run: RUN,
          sid: '1795389735000-a1b2c3d4',
          seq: 2,
          meta: makeMeta({
            counts: {
              queued: 0,
              running: 0,
              waiting: 0,
              completed: 2,
              failed: 0,
              indeterminate: 0,
              cached: 0,
            },
          }),
          delta: {
            nodes: [{ ...node4, status: 'completed', endedAt: 1795389800 }],
          },
        },
        Date.now()
      );
    });

    expect(rendersFor('alpha')).toBe(2);
    expect(rendersFor('beta')).toBe(1);
  });

  it('says why a chip waits, marks indeterminate calls, and groups session turns under their session', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    wfStore.ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        nodes: [
          makeNode('n1', { label: 'Ask user node', status: 'waiting', waitingOn: 'user' }),
          makeNode('n2', { label: 'Peer wait node', status: 'waiting', waitingOn: 'peer' }),
          makeNode('n3', { label: 'Uncertain write', status: 'indeterminate' }),
          makeNode('n4', {
            kind: 'session',
            label: 'Reviewer session',
            turns: 2,
            status: 'running',
          }),
          makeNode('n5', {
            kind: 'turn',
            label: 'First review pass',
            session: 'n4',
            turns: 1,
            status: 'completed',
          }),
        ],
      }),
      Date.now()
    );

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    expect(screen.getByText('Waiting for your answer')).toBeTruthy();
    expect(screen.getByText('Waiting for a message')).toBeTruthy();
    expect(screen.getByText('May have run')).toBeTruthy();
    expect(screen.getByText('2 turns')).toBeTruthy();
    expect(screen.getByText('First review pass')).toBeTruthy();
  });

  it('shows a finished run from its card with no ephemeral history, and waiting state when empty', () => {
    const { mx, room } = makeClient();
    const store = createStore();

    const { rerender } = render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );
    expect(screen.getByText("Waiting for the run's next update…")).toBeTruthy();

    const card: WorkflowRunCard = {
      run: RUN,
      jobId: 'job-wf-card',
      requester: VIEWER,
      title: 'Audit the sample module',
      status: 'completed',
      counts: {
        queued: 0,
        running: 0,
        waiting: 0,
        completed: 1,
        failed: 1,
        indeterminate: 0,
        cached: 0,
      },
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        toolCalls: 2,
        costUsd: 0.03,
        costUnknown: false,
      },
      phases: ['Verify'],
      attempt: 1,
      startedAt: 1795389735,
      endedAt: 1795389800,
      error: null,
      large: false,
      graph: {
        phases: ['Verify'],
        groups: [],
        nodes: [makeNode('n1', { label: 'Check auth', status: 'failed', error: 'Mismatch' })],
        edges: [],
        log: [],
        omitted: emptyOmitted,
      },
    };
    act(() => {
      getWorkflowRunStore(mx).showCard(ROOM_ID, AGENT, card, Date.now());
    });
    rerender(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    expect(screen.getByRole('heading', { name: 'Verify' })).toBeTruthy();
    expect(screen.getByText('Check auth')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy();
  });

  it('hides Resume/Run again for non-requesters and shows stale banner after a sequence gap', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    const otherCard: WorkflowRunCard = {
      run: RUN,
      jobId: 'job-wf-other',
      requester: '@someone-else:example.org',
      title: 'Audit the sample module',
      status: 'interrupted',
      counts: {
        queued: 0,
        running: 0,
        waiting: 0,
        completed: 1,
        failed: 0,
        indeterminate: 0,
        cached: 0,
      },
      usage: {
        inputTokens: 500,
        outputTokens: 50,
        toolCalls: 1,
        costUsd: 0.02,
        costUnknown: false,
      },
      phases: ['Audit'],
      attempt: 1,
      startedAt: 1795389735,
      endedAt: 1795389800,
      error: 'Stopped at the cost limit ($0.02 of $0.02).',
      large: false,
      graph: {
        phases: ['Audit'],
        groups: [],
        nodes: [makeNode('n1', { label: 'Audit auth', status: 'completed', endedAt: 1795389790 })],
        edges: [],
        log: [],
        omitted: emptyOmitted,
      },
    };
    wfStore.showCard(ROOM_ID, AGENT, otherCard, Date.now());

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();

    // Now ingest a live snapshot followed by a skipped sequence delta -> stale banner.
    act(() => {
      wfStore.ingest(
        ROOM_ID,
        AGENT,
        makeSnapshotFrame(
          { phases: ['Audit'], nodes: [makeNode('n1', { label: 'Audit auth' })] },
          { attempt: 2 },
          1
        ),
        Date.now()
      );
      wfStore.ingest(
        ROOM_ID,
        AGENT,
        {
          run: RUN,
          sid: '1795389735000-a1b2c3d4',
          seq: 5,
          meta: makeMeta({ attempt: 2 }),
          delta: { nodes: [] },
        },
        Date.now()
      );
    });

    expect(screen.getByText(/Not updating\. Last update/)).toBeTruthy();
  });

  it('updates a live turn under a completed session with clock and joined sub-agent usage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1795389750 * 1000);
    const { mx, room } = makeClient();
    const store = createStore();
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Review'],
        nodes: [
          makeNode('n1', {
            kind: 'session',
            label: 'Session root',
            status: 'completed',
            endedAt: 1795389742,
            turns: 1,
          }),
          makeNode('n2', {
            kind: 'turn',
            label: 'Active turn',
            session: 'n1',
            status: 'running',
            run: 'turn-run-1',
            startedAt: 1795389745,
          }),
        ],
      }),
      Date.now()
    );

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    const turnChip = () => screen.getByRole('button', { name: /Active turn/ });
    expect(within(turnChip()).getByText('5s')).toBeTruthy();

    act(() => {
      getSubagentRunStore(mx).ingest(
        ROOM_ID,
        AGENT,
        {
          run: 'turn-run-1',
          sid: '1795389750000-a1b2c3d4',
          seq: 1,
          meta: {
            agent: 'panels',
            subagent: 'turn-run-1',
            caller: 'panels',
            root: 'panels',
            parent: null,
            threadId: null,
            source: 'workflow',
            status: 'running',
            startedAt: 1795389745,
            endedAt: null,
            usage: { inputTokens: 1200, outputTokens: 300, toolCalls: 2, costUsd: 0.99 },
          },
          snapshot: {
            md: '',
            reasoning: '',
            tools: [],
            status: 'streaming',
            activity: '',
            segments: [],
          },
        },
        Date.now()
      );
    });
    expect(within(turnChip()).getByText('$0.99')).toBeTruthy();
  });

  it('renders nested workflow groups under their caller, translates inspector status, and disables unavailable Open', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame(
        {
          phases: ['Audit'],
          groups: [
            { id: 'n2', kind: 'workflow', phase: 0, parent: 'n1', total: 1, done: 0, failed: 0 },
          ],
          nodes: [
            makeNode('n1', { label: 'Outer caller', status: 'completed', endedAt: 1795389760 }),
            makeNode('n3', {
              label: 'Inner check',
              group: 'n2',
              status: 'indeterminate',
              run: 'stale-del',
            }),
          ],
        },
        { status: 'completed', endedAt: 1795389800 }
      ),
      Date.now()
    );

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
    expect(screen.getByText('Nested workflow')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Inner check/ }));
    const details = document.querySelector('[data-workflow-node-details="n3"]') as HTMLElement;
    expect(within(details).getByText('May have run')).toBeTruthy();
    expect(within(details).queryByText('indeterminate')).toBeNull();
    expect(within(details).getByRole<HTMLButtonElement>('button', { name: 'Open' }).disabled).toBe(
      true
    );
    expect(within(details).getByText('Details are no longer available after reload.')).toBeTruthy();
  });

  it('preserves explicit null threadId for room-timeline runs when clicking Run again beside another thread', async () => {
    const { mx, room, sendEvent } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    wfStore.ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame(
        {
          phases: ['Audit'],
          nodes: [makeNode('n1', { status: 'completed', endedAt: 1795389800 })],
        },
        { status: 'completed', endedAt: 1795389800, threadId: null, requester: VIEWER }
      ),
      Date.now()
    );

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel
            room={room}
            run={RUN}
            threadId="$unrelated-thread"
            onClose={() => undefined}
          />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    });
    expect(sendEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'io.mindroom.workflow_control',
      { run: RUN, action: 'resume' },
      'txn-wf-panel'
    );
  });

  it('remeasures SVG edges when folded group membership changes even with unchanged edges and size', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const id = this.dataset?.workflowChipId;
        const n = id ? Number(id.slice(1)) : 0;
        return {
          x: n * 10,
          y: n * 40,
          top: n * 40,
          left: n * 10,
          right: n * 10 + 100,
          bottom: n * 40 + 30,
          width: 100,
          height: 30,
          toJSON: () => ({}),
        } as DOMRect;
      });
    try {
      const nodes = Array.from({ length: 25 }, (_, i) =>
        makeNode(`n${String(i + 1).padStart(2, '0')}`, {
          group: 'g1',
          status: 'running',
          startedAt: 1795389740 + i,
        })
      );
      const edges = [{ from: 'n01', to: 'n02', count: 2 }];
      wfStore.ingest(
        ROOM_ID,
        AGENT,
        makeSnapshotFrame({
          phases: ['Audit'],
          groups: [
            { id: 'g1', kind: 'foreach', phase: 0, parent: null, total: 25, done: 0, failed: 0 },
          ],
          nodes,
          edges,
        }),
        Date.now()
      );

      render(
        <JotaiProvider store={store}>
          <MatrixClientProvider value={mx}>
            <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
          </MatrixClientProvider>
        </JotaiProvider>
      );
      expect(document.querySelector('[data-workflow-chip-id="n01"]')).toBeTruthy();
      const edgePaths = () =>
        document.querySelectorAll('[data-testid="workflow-panel"] > div svg path');
      expect(edgePaths()).toHaveLength(1);

      // Completing n01 pushes it out of the 24 running visible chips while edges remain identical.
      act(() => {
        wfStore.ingest(
          ROOM_ID,
          AGENT,
          {
            run: RUN,
            sid: '1795389735000-a1b2c3d4',
            seq: 2,
            meta: makeMeta(),
            delta: {
              nodes: [{ ...nodes[0]!, status: 'completed', endedAt: 1795389800 }],
              groups: [
                {
                  id: 'g1',
                  kind: 'foreach',
                  phase: 0,
                  parent: null,
                  total: 25,
                  done: 1,
                  failed: 0,
                },
              ],
            },
          },
          Date.now()
        );
      });
      expect(document.querySelector('[data-workflow-chip-id="n01"]')).toBeNull();
      expect(edgePaths()).toHaveLength(0);

      // Expanding the group brings n01 back and restores the measured SVG edge.
      fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));
      expect(document.querySelector('[data-workflow-chip-id="n01"]')).toBeTruthy();
      expect(edgePaths()).toHaveLength(1);
    } finally {
      rectSpy.mockRestore();
    }
  });
});
