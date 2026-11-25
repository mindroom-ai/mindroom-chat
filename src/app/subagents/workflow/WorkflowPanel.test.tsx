// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
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
  messages: 0,
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
    messages: [],
    log: [],
    omitted: emptyOmitted,
    ...graph,
  },
});

const makeClient = ({
  sendEvent = vi.fn(async () => ({ event_id: '$sent-1' })),
  jobs = [],
}: {
  sendEvent?: ReturnType<typeof vi.fn>;
  jobs?: Array<Record<string, unknown>>;
} = {}) => {
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
      if (type === 'io.mindroom.background_jobs' && stateKey === undefined) {
        return jobs.length > 0
          ? [
              new MatrixEvent({
                type: 'io.mindroom.background_jobs',
                state_key: AGENT,
                room_id: ROOM_ID,
                sender: AGENT,
                content: { jobs },
              }),
            ]
          : [];
      }
      return null;
    },
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  };
  const room = Object.assign(new EventEmitter(), {
    roomId: ROOM_ID,
    myUserId: VIEWER,
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
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[2]!);
    expect(screen.getByText('No messages between steps yet.')).toBeTruthy();
    fireEvent.click(tabs[3]!);
    expect(screen.getByText('No log entries yet.')).toBeTruthy();
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
        messages: [],
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
        messages: [],
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

  it('renders nested workflow groups under their caller, translates inspector status, and omits unavailable Open', () => {
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
    expect(within(details).queryByRole('button', { name: 'Open' })).toBeNull();
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

    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(sendEvent).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm run again' }));
    });
    expect(sendEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'io.mindroom.workflow_control',
      { run: RUN, action: 'resume' },
      'txn-wf-panel'
    );
  });

  it('keeps spawned session turns inside Parallel groups, shows @session badges, and highlights siblings', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        groups: [
          { id: 'g1', kind: 'parallel', phase: 0, parent: null, total: 2, done: 1, failed: 0 },
        ],
        nodes: [
          makeNode('s1', {
            kind: 'session',
            label: 'Reviewer session',
            name: 'reviewer',
            status: 'completed',
            turns: 2,
            endedAt: 1795389740,
          }),
          makeNode('n4', {
            kind: 'turn',
            label: 'Inspect auth',
            name: 'backend',
            group: 'g1',
            session: 's1',
            status: 'running',
            model: 'gemini_flash@minimal',
          }),
          makeNode('n5', {
            kind: 'turn',
            label: 'Inspect tokens',
            name: 'frontend',
            group: 'g1',
            session: 's1',
            status: 'failed',
            error: 'Timed out after 120s waiting for agent',
            endedAt: 1795389780,
          }),
        ],
        edges: [
          { from: 'n4', to: 'n5', count: 2 },
          { from: 'n5', to: 'n4', count: 1 },
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

    // Empty root session card is omitted while its turns remain inside Parallel group g1.
    expect(document.querySelector('[data-workflow-chip-id="s1"]')).toBeNull();
    const groupEl = document.querySelector('[data-workflow-group-id="g1"]') as HTMLElement;
    expect(within(groupEl).getByRole('button', { name: /Inspect auth/ })).toBeTruthy();
    expect(within(groupEl).getByRole('button', { name: /Inspect tokens/ })).toBeTruthy();
    expect(within(groupEl).getAllByText('@reviewer')).toHaveLength(2);
    expect(within(groupEl).getByText('gemini_flash · minimal')).toBeTruthy();
    expect(within(groupEl).getByText('Timeout')).toBeTruthy();
    expect(groupEl.querySelector('[dir="ltr"]')?.textContent).toContain('backend ↔ frontend · 3');
    expect(groupEl.textContent).toContain('backend and frontend: 3');
    expect(groupEl.querySelector('[role="progressbar"]')).toBeNull();
    expect(groupEl.querySelectorAll('svg path').length).toBeGreaterThan(0);

    // Inspector details stay absent until a node is selected.
    expect(document.querySelector('[data-workflow-node-details]')).toBeNull();

    const turn4 = document.querySelector('[data-workflow-chip-id="n4"]') as HTMLElement;
    const turn5 = document.querySelector('[data-workflow-chip-id="n5"]') as HTMLElement;
    fireEvent.click(turn4);

    expect(turn5.dataset.sessionHighlighted).toBe('true');
    const details = document.querySelector('[data-workflow-node-details="n4"]') as HTMLElement;
    expect(within(details).getByText('@reviewer')).toBeTruthy();
    expect(within(details).getByText('Messages to frontend: 2')).toBeTruthy();
    expect(within(details).getByText('Messages from frontend: 1')).toBeTruthy();
  });

  it('collapses consecutive completed plumbing in Flow, shows flat rows in Steps, and switches Messages/Log tabs', async () => {
    const { mx, room } = makeClient();
    const store = createStore();
    getSubagentRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      {
        run: 'delegation-json',
        sid: '1795389735000-c1d2e3f4',
        seq: 1,
        meta: {
          agent: 'panels',
          subagent: 'delegation-json',
          caller: 'panels',
          root: 'panels',
          parent: null,
          threadId: null,
          source: 'workflow',
          status: 'completed',
          startedAt: 1795389740,
          endedAt: 1795389755,
          result: '```json\n{"id":9223372036854775807,"checked":4}\n```',
        },
        snapshot: {
          md: '',
          reasoning: '',
          tools: [],
          status: 'done',
          activity: '',
          segments: [],
        },
      },
      Date.now()
    );
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Prepare'],
        nodes: [
          makeNode('n1', {
            kind: 'value',
            label: 'Load config',
            status: 'completed',
            endedAt: 1795389741,
          }),
          makeNode('n2', {
            kind: 'state',
            label: 'Seed state',
            status: 'completed',
            endedAt: 1795389741,
          }),
          makeNode('n3', {
            kind: 'agent',
            label: 'Run audit',
            name: 'auditor',
            status: 'completed',
            run: 'delegation-json',
            endedAt: 1795389755,
            usage: { inputTokens: 1500, outputTokens: 500, toolCalls: 2, costUsd: 0.12 },
          }),
          makeNode('n4', {
            kind: 'send',
            label: 'Notify peer',
            name: null,
            status: 'failed',
            error: 'Peer inbox closed',
            endedAt: 1795389756,
          }),
        ],
        edges: [{ from: 'n3', to: 'n4', count: 2 }],
        log: ['Round 1 finished'],
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

    // Flow tab collapses n1 + n2 into one setup-steps pill while keeping failed plumbing visible.
    const setupToggle = screen.getByRole('button', { name: '2 setup steps' });
    expect(document.querySelector('[data-workflow-chip-id="n1"]')).toBeNull();
    expect(document.querySelector('[data-workflow-chip-id="n4"]')).toBeTruthy();

    fireEvent.click(setupToggle);
    const setupChild1 = document.querySelector('[data-workflow-chip-id="n1"]') as HTMLElement;
    expect(setupChild1).toBeTruthy();
    expect(document.querySelector('[data-workflow-chip-id="n2"]')).toBeTruthy();
    // Clicking the setup-steps toggle collapses the group cleanly even while a child is selected.
    fireEvent.click(setupChild1);
    expect(document.querySelector('[data-workflow-node-details="n1"]')).toBeTruthy();
    fireEvent.click(setupToggle);
    expect(setupToggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-workflow-chip-id="n1"]')).toBeNull();

    // Selecting n3 displays KPI metrics and un-fenced pretty JSON inside <pre>.
    fireEvent.click(screen.getByRole('button', { name: /Run audit/ }));
    const details = document.querySelector('[data-workflow-node-details="n3"]') as HTMLElement;
    expect(within(details).getByText('Duration')).toBeTruthy();
    expect(within(details).getByText('2K')).toBeTruthy();
    expect(within(details).getByText('$0.12')).toBeTruthy();
    const pre = details.querySelector('pre');
    expect(pre?.textContent).toBe('{"id":9223372036854775807,"checked":4}');

    // Tabs have space-separated accessible names and wire aria-controls to a focusable tabpanel.
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[1]!.textContent).toBe('Steps 4');
    expect(tabs[0]!.getAttribute('aria-controls')).toBeTruthy();
    expect(tabs[1]!.getAttribute('aria-controls')).toBeNull();
    fireEvent.click(tabs[1]!);
    const stepsPanel = screen.getByRole('tabpanel');
    expect(stepsPanel.id).toBe(tabs[1]!.getAttribute('aria-controls'));
    expect(tabs[0]!.getAttribute('aria-controls')).toBeNull();
    expect(stepsPanel.getAttribute('tabindex')).toBe('0');
    expect(document.querySelectorAll('[data-workflow-chip-id]')).toHaveLength(4);
    expect(document.querySelector('[data-workflow-chip-id="n4"]')?.textContent).toContain(
      '(Failed)'
    );

    // Messages tab wraps arrows in dir="ltr" and exposes accessible direction; ArrowRight switches to Log.
    fireEvent.click(tabs[2]!);
    const routeItem = screen.getByRole('listitem');
    expect(routeItem.querySelector('[dir="ltr"]')?.textContent).toBe('auditor → Notify peer');
    expect(routeItem.textContent).toContain('auditor to Notify peer: 2');
    fireEvent.keyDown(tabs[2]!, { key: 'ArrowRight' });
    expect(tabs[3]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[3]!.id);
    expect(screen.getByText('Round 1 finished')).toBeTruthy();

    // Bengali locale formats tab counts with localDigits and RTL reverses arrow-key tab order.
    const previousLanguage = i18next.language;
    const previousDir = document.documentElement.dir;
    try {
      i18next.addResourceBundle(
        'bn',
        'translation',
        { mindroomUi: { workflowRun: { panel: { flow: 'প্রবাহ' } } } },
        true,
        true
      );
      await act(async () => {
        await i18next.changeLanguage('bn');
      });
      const tablistText = screen.getByRole('tablist').textContent ?? '';
      expect(tablistText).toContain('৪');
      expect(tablistText).toContain('২');
      expect(tablistText).toContain('১');
      expect(tablistText).not.toMatch(/[0-9]/);

      document.documentElement.dir = 'rtl';
      fireEvent.keyDown(tabs[3]!, { key: 'ArrowRight' });
      expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
    } finally {
      document.documentElement.dir = previousDir;
      await act(async () => {
        i18next.removeResourceBundle('bn', 'translation');
        await i18next.changeLanguage(previousLanguage);
      });
    }
  });

  it('shows omitted notices instead of empty states and hides 0 tab badges when edges or logs were omitted', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        nodes: [makeNode('n1', { label: 'Check auth', status: 'completed', endedAt: 1795389760 })],
        edges: [],
        log: [],
        omitted: { ...emptyOmitted, edges: 5, log: 3 },
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

    const tabs = screen.getAllByRole('tab');
    expect(tabs[2]!.textContent).toBe('Messages');
    expect(tabs[3]!.textContent).toBe('Log');

    fireEvent.click(tabs[2]!);
    expect(screen.queryByText('No messages between steps yet.')).toBeNull();
    expect(screen.getByText('5 message routes omitted.')).toBeTruthy();
    expect(screen.getByText('Ask panels for the rest.')).toBeTruthy();

    fireEvent.click(tabs[3]!);
    expect(screen.queryByText('No log entries yet.')).toBeNull();
    expect(screen.getByText('3 log entries omitted.')).toBeTruthy();
  });

  it('resolves session-addressed peer edges in Parallel groups and preserves execution order in folded sequential run groups', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const seqNodes = Array.from({ length: 25 }, (_, i) =>
      makeNode(`n${i + 10}`, {
        label: `Seq ${i + 1}`,
        group: 'g-seq',
        phase: 1,
        status: 'completed',
        endedAt: 1795389800 + i,
      })
    );
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit', 'Pipeline'],
        groups: [
          { id: 'g1', kind: 'parallel', phase: 0, parent: null, total: 2, done: 2, failed: 0 },
          { id: 'g-seq', kind: 'run', phase: 1, parent: null, total: 25, done: 25, failed: 0 },
        ],
        nodes: [
          makeNode('s1', {
            kind: 'session',
            label: 'Reviewer session',
            name: 'reviewer',
            phase: 0,
            status: 'completed',
            turns: 1,
            endedAt: 1795389750,
          }),
          makeNode('n4', {
            label: 'Backend scan',
            name: 'backend',
            group: 'g1',
            phase: 0,
            status: 'completed',
            endedAt: 1795389760,
          }),
          makeNode('n5', {
            kind: 'turn',
            label: 'Review pass',
            name: 'pass-1',
            group: 'g1',
            session: 's1',
            phase: 0,
            status: 'completed',
            endedAt: 1795389765,
          }),
          ...seqNodes,
        ],
        edges: [{ from: 'n4', to: 's1', count: 2 }],
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

    // Turn-to-session edge renders as a peer bridge inside g1 and appears in n5's inspector.
    const parallelGroup = document.querySelector('[data-workflow-group-id="g1"]') as HTMLElement;
    expect(parallelGroup.querySelector('[dir="ltr"]')?.textContent).toContain(
      'backend → reviewer · 2'
    );
    fireEvent.click(document.querySelector('[data-workflow-chip-id="n5"]') as HTMLElement);
    const details = document.querySelector('[data-workflow-node-details="n5"]') as HTMLElement;
    const sessionSection = details.querySelector(
      '[data-workflow-session-messages="s1"]'
    ) as HTMLElement;
    expect(sessionSection).toBeTruthy();
    expect(within(sessionSection).getByText('@reviewer')).toBeTruthy();
    expect(within(sessionSection).getByText('Messages from backend: 2')).toBeTruthy();

    // Folded 25-item sequential `run` group keeps its 24 kept items in ascending execution order (n11..n34).
    const seqGroup = document.querySelector('[data-workflow-group-id="g-seq"]') as HTMLElement;
    const seqChipIds = Array.from(
      seqGroup.querySelectorAll<HTMLElement>('[data-workflow-chip-id]'),
      (el) => el.dataset.workflowChipId
    );
    expect(seqChipIds).toHaveLength(24);
    expect(seqChipIds[0]).toBe('n11');
    expect(seqChipIds[23]).toBe('n34');
  });

  it('omits backwards arrows for post-phase unphased steps and shows visible non-color status cues in Steps', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Build'],
        nodes: [
          makeNode('n1', {
            label: 'Compile',
            phase: 0,
            status: 'waiting',
            waitingOn: 'peer',
          }),
          makeNode('n2', {
            label: 'Publish',
            phase: null,
            status: 'completed',
            cached: true,
            endedAt: 1795389760,
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

    // Unphased Publish (n2) appears above Build (n1) without a backwards downward arrow SVG.
    const flowPanel = screen.getByRole('tabpanel');
    expect(flowPanel.querySelectorAll('svg')).toHaveLength(0);

    // Steps tab renders visible non-color status cues AND includes Reused in screen-reader status text.
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    const compileRow = document.querySelector('[data-workflow-chip-id="n1"]') as HTMLElement;
    const publishRow = document.querySelector('[data-workflow-chip-id="n2"]') as HTMLElement;
    expect(within(compileRow).getByText('Waiting for a message')).toBeTruthy();
    expect(within(publishRow).getByText('Reused from the last run')).toBeTruthy();
    expect(publishRow.textContent).toContain('(Done, Reused from the last run)');
  });

  it('waits without rendering empty 0-count tabs when entry summary exists before graph arrives', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const summaryOnlyCard: WorkflowRunCard = {
      run: RUN,
      jobId: 'job-wf-live',
      requester: VIEWER,
      title: 'Pending graph run',
      status: 'running',
      counts: {
        queued: 1,
        running: 1,
        waiting: 0,
        completed: 0,
        failed: 0,
        indeterminate: 0,
        cached: 0,
      },
      usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0, costUnknown: false },
      phases: ['Audit'],
      attempt: 1,
      startedAt: 1795389735,
      endedAt: null,
      error: null,
      large: false,
    };
    getWorkflowRunStore(mx).showCard(ROOM_ID, AGENT, summaryOnlyCard, Date.now());

    render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    expect(screen.getByRole('heading', { name: 'Pending graph run' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText("Waiting for the run's next update…")).toBeTruthy();
  });

  it('shows the node wait reason in the inspector for peer, approval, and user waits', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    wfStore.ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        nodes: [
          makeNode('n1', { label: 'Peer wait', status: 'waiting', waitingOn: 'peer' }),
          makeNode('n2', { label: 'Approval wait', status: 'waiting', waitingOn: 'approval' }),
          makeNode('n3', { label: 'User wait', status: 'waiting', waitingOn: 'user' }),
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

    fireEvent.click(screen.getByRole('button', { name: /Peer wait/ }));
    let details = document.querySelector('[data-workflow-node-details="n1"]') as HTMLElement;
    expect(within(details).getByText('Waiting for a message')).toBeTruthy();
    expect(within(details).queryByText('Waiting for you')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Approval wait/ }));
    details = document.querySelector('[data-workflow-node-details="n2"]') as HTMLElement;
    expect(within(details).getByText('Waiting for approval')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /User wait/ }));
    details = document.querySelector('[data-workflow-node-details="n3"]') as HTMLElement;
    expect(within(details).getByText('Waiting for your answer')).toBeTruthy();
  });

  it('uses total node usage for completed nodes while keeping live sub-agent usage for active nodes', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    const wfStore = getWorkflowRunStore(mx);
    const subStore = getSubagentRunStore(mx);

    wfStore.ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        nodes: [
          makeNode('n1', {
            label: 'Schema checked step',
            status: 'completed',
            turns: 2,
            run: 'delegation-final',
            model: 'fallback-model',
            endedAt: 1795389755,
            usage: { inputTokens: 2000, outputTokens: 1000, toolCalls: 2, costUsd: 0.3 },
          }),
          makeNode('n2', {
            label: 'Active streaming step',
            status: 'running',
            run: 'delegation-live',
            usage: { inputTokens: 300, outputTokens: 200, toolCalls: 1, costUsd: 0.05 },
          }),
        ],
      }),
      Date.now()
    );

    subStore.ingest(
      ROOM_ID,
      AGENT,
      {
        run: 'delegation-final',
        sid: '1795389755000-f1a2b3c4',
        seq: 1,
        meta: {
          agent: 'panels',
          subagent: 'delegation-final',
          caller: 'panels',
          root: 'panels',
          parent: null,
          threadId: null,
          source: 'workflow',
          status: 'completed',
          startedAt: 1795389750,
          endedAt: 1795389755,
          model: {
            modelConfig: 'fable',
            modelDisplayName: 'Fable 5.2',
            modelProvider: 'anthropic',
            modelId: 'claude-fable-5.2',
          },
          usage: { inputTokens: 700, outputTokens: 300, toolCalls: 1, costUsd: 0.1 },
          result: 'Validated after schema correction.',
        },
        snapshot: {
          md: 'Validated after schema correction.',
          reasoning: '',
          tools: [],
          status: 'done',
          activity: '',
          segments: [],
        },
      },
      Date.now()
    );

    subStore.ingest(
      ROOM_ID,
      AGENT,
      {
        run: 'delegation-live',
        sid: '1795389756000-a1b2c3d4',
        seq: 1,
        meta: {
          agent: 'panels',
          subagent: 'delegation-live',
          caller: 'panels',
          root: 'panels',
          parent: null,
          threadId: null,
          source: 'workflow',
          status: 'running',
          startedAt: 1795389756,
          endedAt: null,
          usage: { inputTokens: 1100, outputTokens: 400, toolCalls: 2, costUsd: 0.25 },
        },
        snapshot: {
          md: 'Still streaming.',
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

    const completedChip = screen.getByRole('button', { name: /Schema checked step/ });
    expect(within(completedChip).getByText('3K')).toBeTruthy();
    expect(within(completedChip).getByText('$0.30')).toBeTruthy();
    expect(within(completedChip).queryByText('1K')).toBeNull();
    expect(within(completedChip).queryByText('$0.10')).toBeNull();
    expect(within(completedChip).getByText('Fable 5.2')).toBeTruthy();

    fireEvent.click(completedChip);
    const details = document.querySelector('[data-workflow-node-details="n1"]') as HTMLElement;
    expect(within(details).getByText('Validated after schema correction.')).toBeTruthy();

    const activeChip = screen.getByRole('button', { name: /Active streaming step/ });
    expect(within(activeChip).getByText('1.5K')).toBeTruthy();
    expect(within(activeChip).getByText('$0.25')).toBeTruthy();
    expect(within(activeChip).queryByText('500')).toBeNull();
    expect(within(activeChip).queryByText('$0.05')).toBeNull();
  });

  it('hides run and per-node Stop controls when readOnly is true', () => {
    const { mx, room } = makeClient({
      jobs: [
        {
          job_id: 'job-wf-1',
          thread_id: null,
          kind: 'workflow',
          tool: 'workflow',
          status: 'running',
          started_at: '2026-11-23T00:00:00Z',
          workflow: RUN,
        },
      ],
    });
    const store = createStore();
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        nodes: [
          makeNode('n4', { label: 'Audit auth/session.py', status: 'running', job: 'job-agent-4' }),
        ],
      }),
      Date.now()
    );

    const { rerender } = render(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
        </MatrixClientProvider>
      </JotaiProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Audit auth\/session\.py/ }));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeTruthy();

    rerender(
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} readOnly />
        </MatrixClientProvider>
      </JotaiProvider>
    );
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop agent' })).toBeNull();
  });

  it('renders Messages tab text, clickable node jumps, omitted.messages, inspector messages, and send->script fallback', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        nodes: [
          makeNode('s1', {
            kind: 'session',
            label: 'designer',
            name: 'designer',
            status: 'completed',
            turns: 1,
            endedAt: 1795389740,
          }),
          makeNode('n4', {
            kind: 'turn',
            label: 'Design pass',
            name: 'design-turn',
            session: 's1',
            status: 'completed',
            endedAt: 1795389760,
          }),
          makeNode('n5', {
            kind: 'agent',
            label: 'Review pass',
            name: 'reviewer',
            status: 'completed',
            endedAt: 1795389770,
          }),
        ],
        messages: [
          {
            seq: 1,
            from: null,
            fromName: 'script',
            to: 's1',
            toName: 'designer',
            text: 'Use the warm palette.',
            sentAt: 1795389742,
          },
          {
            seq: 2,
            from: 'n4',
            fromName: 'designer',
            to: 'n5',
            toName: 'reviewer',
            text: 'Ready for review.',
            sentAt: 1795389755,
          },
        ],
        omitted: { ...emptyOmitted, messages: 4 },
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

    const tabs = screen.getAllByRole('tab');
    expect(tabs[2]!.textContent).toBe('Messages 2+');

    fireEvent.click(tabs[2]!);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Use the warm palette.')).toBeTruthy();
    expect(within(items[0]!).queryByRole('button', { name: 'script' })).toBeNull();
    expect(items[0]!.querySelector('time')).toBeTruthy();
    expect(within(items[1]!).getByText('Ready for review.')).toBeTruthy();
    expect(screen.getByText('4 messages omitted.')).toBeTruthy();

    // Clicking a node endpoint jumps to Flow tab and opens its Inspector with actual message snippets.
    fireEvent.click(within(items[1]!).getByRole('button', { name: 'designer' }));
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    const details = document.querySelector('[data-workflow-node-details="n4"]') as HTMLElement;
    expect(within(details).getByText('Ready for review.')).toBeTruthy();
    const sessionSection = details.querySelector(
      '[data-workflow-session-messages="s1"]'
    ) as HTMLElement;
    expect(within(sessionSection).getByText('Use the warm palette.')).toBeTruthy();

    // Clicking the peer message inside Inspector jumps to reviewer (n5).
    fireEvent.click(within(details).getByRole('button', { name: /Ready for review\./ }));
    expect(document.querySelector('[data-workflow-node-details="n5"]')).toBeTruthy();
  });

  it('falls back to edges with script label for send nodes and renders persisted node.preview after reload without Open', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Audit'],
        nodes: [
          makeNode('n8', {
            kind: 'send',
            label: 'send -> designer',
            name: null,
            status: 'completed',
            endedAt: 1795389745,
          }),
          makeNode('n10', {
            kind: 'agent',
            label: 'Design pass',
            name: 'designer',
            status: 'completed',
            run: 'stale-subagent-run',
            preview: 'Persisted redacted summary.',
            endedAt: 1795389760,
          }),
        ],
        edges: [{ from: 'n8', to: 'n10', count: 1 }],
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

    fireEvent.click(screen.getByRole('button', { name: /Design pass/ }));
    const details = document.querySelector('[data-workflow-node-details="n10"]') as HTMLElement;
    expect(details.querySelector('pre')?.textContent).toBe('Persisted redacted summary.');
    expect(within(details).queryByRole('button', { name: 'Open' })).toBeNull();
    expect(
      within(details).getByText('Full transcript is no longer available after reload.')
    ).toBeTruthy();
    expect(within(details).getByText('Messages from script: 1')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('tab')[2]!);
    const routeItem = screen.getByRole('listitem');
    expect(routeItem.querySelector('[dir="ltr"]')?.textContent).toBe('script → designer');
  });

  it('keeps Phase 4 spawned turns in Phase 4, puts @session in ChipMeta, uses single odd 3-item join prong, and scrolls Inspector on narrow click', () => {
    const { mx, room } = makeClient();
    const store = createStore();
    getWorkflowRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      makeSnapshotFrame({
        phases: ['Phase 3', 'Phase 4'],
        groups: [
          { id: 'g3', kind: 'foreach', phase: 0, parent: null, total: 3, done: 3, failed: 0 },
        ],
        nodes: [
          makeNode('n10', {
            kind: 'session',
            label: 'designer',
            name: 'designer',
            phase: 0,
            status: 'completed',
            turns: 2,
            startedAt: 1795389740,
            endedAt: 1795389740,
          }),
          makeNode('n11', {
            kind: 'turn',
            label: 'Propose hero layout',
            phase: 0,
            group: 'g3',
            session: 'n10',
            status: 'completed',
            endedAt: 1795389750,
          }),
          makeNode('n12', {
            kind: 'agent',
            label: 'Check accessibility',
            phase: 0,
            group: 'g3',
            status: 'completed',
            endedAt: 1795389751,
          }),
          makeNode('n13', {
            kind: 'agent',
            label: 'Audit performance',
            phase: 0,
            group: 'g3',
            status: 'completed',
            endedAt: 1795389752,
          }),
          makeNode('n15', {
            kind: 'turn',
            label: 'Polish final copy',
            phase: 1,
            group: null,
            session: 'n10',
            status: 'completed',
            endedAt: 1795389765,
          }),
        ],
      }),
      Date.now()
    );

    const scrollIntoView = vi.fn();
    let splitWidth = 420;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width: splitWidth,
      height: 400,
      top: 0,
      left: 0,
      right: splitWidth,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    const origScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      render(
        <JotaiProvider store={store}>
          <MatrixClientProvider value={mx}>
            <WorkflowPanel room={room} run={RUN} threadId={null} onClose={() => undefined} />
          </MatrixClientProvider>
        </JotaiProvider>
      );

      // Phase 4 turn stays in Phase 4 section and redundant 0s session n10 is omitted.
      expect(document.querySelector('[data-workflow-chip-id="n10"]')).toBeNull();
      const phase4Heading = screen.getByRole('heading', { name: 'Phase 4' });
      const phase4Section = phase4Heading.closest('section') as HTMLElement;
      expect(within(phase4Section).getByRole('button', { name: /Polish final copy/ })).toBeTruthy();

      // @designer badge lives in ChipMeta (2nd span child of chip), NOT inside ChipTop (1st span child).
      const turn11 = document.querySelector('[data-workflow-chip-id="n11"]') as HTMLElement;
      const chipTop = turn11.children[0] as HTMLElement;
      const chipMeta = turn11.children[1] as HTMLElement;
      expect(chipTop.textContent).not.toContain('@designer');
      expect(chipMeta.textContent).toContain('@designer');

      // 3-item For each join SVG renders a single left-to-center curve in its 2-column mid group.
      const groupEl = document.querySelector('[data-workflow-group-id="g3"]') as HTMLElement;
      const svgs = groupEl.querySelectorAll('svg');
      const joinSvg = svgs[svgs.length - 1]!;
      const twoMidGroup = joinSvg.querySelectorAll('g')[1]!;
      const midPaths = Array.from(twoMidGroup.querySelectorAll('path'), (p) => p.getAttribute('d'));
      expect(midPaths).toEqual(['M 25 0 C 25 9, 50 9, 50 18']);

      // Clicking Phase 3 turn highlights Phase 4 sibling turn AND smoothly scrolls Inspector in narrow view.
      fireEvent.click(turn11);
      const turn15 = document.querySelector('[data-workflow-chip-id="n15"]') as HTMLElement;
      expect(turn15.dataset.sessionHighlighted).toBe('true');
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });

      // Wide split (>= 36rem) does NOT scroll Inspector on click.
      scrollIntoView.mockClear();
      splitWidth = 720;
      fireEvent.click(turn15);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = origScrollIntoView;
    }
  });
});
