import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EventEmitter } from 'events';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import 'folds/dist/style.css';
import '@fontsource-variable/inter';
import '../../src/index.css';
import i18n from '../../src/app/i18n/i18n';
import { LightTheme, DarkTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import {
  MINDROOM_BACKGROUND_JOB_CANCEL_EVENT,
  MINDROOM_BACKGROUND_JOBS_EVENT,
} from '../../src/app/matrix/protocol/backgroundJobsContract';
import type {
  WorkflowRunCard as WorkflowRunCardData,
  WorkflowRunQuestion,
} from '../../src/app/matrix/protocol/workflowRunContent';
import { getSubagentRunStore } from '../../src/app/messages/live/subagentRunStore';
import { getWorkflowRunStore } from '../../src/app/messages/live/workflowRunStore';
import { WorkflowRunCard } from '../../src/app/messages/workflow-run/WorkflowRunCard';
import { WorkflowQuestionCard } from '../../src/app/messages/workflow-run/WorkflowQuestionCard';
import { BackgroundJobRow } from '../../src/app/background-jobs/BackgroundJobRow';
import { WorkflowPanel } from '../../src/app/subagents/workflow/WorkflowPanel';

const params = new URLSearchParams(location.search);
applyThemeToDom(params.get('theme') === 'dark' ? DarkTheme : LightTheme);

const ROOM_ID = '!fixture-wf:example.test';
const THREAD_ID = '$thread-fixture-1';
const VIEWER = '@alex:example.test';
const AGENT = '@mindroom_panels:example.test';
const RUN_RUNNING = 'wf-11111111111111111111111111111111';
const RUN_WAITING = 'wf-22222222222222222222222222222222';
const RUN_DONE = 'wf-33333333333333333333333333333333';
const RUN_INTERRUPTED = 'wf-44444444444444444444444444444444';

const nowSec = Math.floor(Date.now() / 1000);

const createFixtureClient = () => {
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
  const jobsEvent = new MatrixEvent({
    type: MINDROOM_BACKGROUND_JOBS_EVENT,
    state_key: AGENT,
    room_id: ROOM_ID,
    sender: AGENT,
    content: {
      jobs: [
        {
          job_id: 'job-wf-running',
          thread_id: THREAD_ID,
          kind: 'workflow',
          tool: 'workflow',
          status: 'running',
          started_at: new Date((nowSec - 95) * 1000).toISOString(),
          workflow: RUN_RUNNING,
        },
      ],
    },
  });
  const currentState = {
    getStateEvents: (type: string, stateKey?: string) => {
      if (type === 'm.room.power_levels') return powerLevelsEvent;
      if (type === 'm.room.create') return createEvent;
      if (type === MINDROOM_BACKGROUND_JOBS_EVENT && stateKey === undefined) return [jobsEvent];
      return null;
    },
    on: () => undefined,
    off: () => undefined,
    removeListener: () => undefined,
  };
  const agentMemberObj = {
    userId: AGENT,
    name: 'Panels',
    rawDisplayName: 'Panels',
    membership: 'join',
    getMxcAvatarUrl: () => undefined,
  };
  const room = Object.assign(new EventEmitter(), {
    roomId: ROOM_ID,
    myUserId: VIEWER,
    currentState,
    getLiveTimeline: () => ({ getState: () => currentState }),
    getMember: (id: string) =>
      id === AGENT
        ? agentMemberObj
        : {
            userId: id,
            name: 'Alex',
            rawDisplayName: 'Alex',
            membership: 'join',
            getMxcAvatarUrl: () => undefined,
          },
    getMembers: () => [agentMemberObj],
    getJoinedMembers: () => [agentMemberObj],
    getEventForTxnId: () => undefined,
  }) as unknown as Room;

  const mx = Object.assign(new EventEmitter(), {
    getUserId: () => VIEWER,
    getSafeUserId: () => VIEWER,
    getRoom: (id: string) => (id === ROOM_ID ? room : null),
    makeTxnId: () => `txn-${Date.now()}`,
    sendEvent: async () => ({ event_id: `$fixture-sent-${Date.now()}` }),
  }) as unknown as MatrixClient;
  (room as unknown as { client: MatrixClient }).client = mx;

  const store = getWorkflowRunStore(mx);
  store.ingest(
    ROOM_ID,
    AGENT,
    {
      run: RUN_RUNNING,
      sid: `${Date.now()}-a1b2c3d4`,
      seq: 1,
      meta: {
        agent: 'panels',
        threadId: THREAD_ID,
        title: 'Audit the sample module',
        name: 'audit-module',
        status: 'running',
        attempt: 1,
        startedAt: nowSec - 95,
        endedAt: null,
        large: false,
        counts: {
          queued: 4,
          running: 8,
          waiting: 0,
          completed: 12,
          failed: 0,
          indeterminate: 0,
          cached: 2,
        },
        usage: {
          inputTokens: 48200,
          outputTokens: 3120,
          toolCalls: 19,
          costUsd: 0.42,
          projectedCostUsd: 0.89,
          costUnknown: false,
        },
      },
      snapshot: {
        phases: ['Audit', 'Verify', 'Report'],
        groups: [
          {
            id: 'n1',
            kind: 'foreach',
            phase: 0,
            parent: null,
            total: 40,
            done: 28,
            failed: 1,
          },
        ],
        nodes: [
          {
            id: 'n4',
            kind: 'agent',
            label: 'Audit auth/session.py',
            name: 'backend',
            phase: 0,
            group: 'n1',
            status: 'running',
            waitingOn: null,
            agent: 'panels',
            model: 'Fable 5.2',
            run: 'delegation-1',
            job: 'job-agent-4',
            session: null,
            turns: 1,
            startedAt: nowSec - 70,
            endedAt: null,
            cached: false,
            error: null,
            usage: { inputTokens: 14200, outputTokens: 980, toolCalls: 6, costUsd: 0.14 },
          },
          {
            id: 'n5',
            kind: 'agent',
            label: 'Audit ui/tokens.ts',
            name: 'frontend',
            phase: 0,
            group: 'n1',
            status: 'waiting',
            waitingOn: 'peer',
            agent: 'panels',
            model: 'Sol · GPT-6.2',
            session: null,
            turns: 1,
            startedAt: nowSec - 62,
            endedAt: null,
            cached: false,
            error: null,
            usage: { inputTokens: 9100, outputTokens: 540, toolCalls: 3, costUsd: 0.08 },
          },
          {
            id: 'n6',
            kind: 'agent',
            label: 'Check billing/quota.py',
            name: 'billing',
            phase: 0,
            group: 'n1',
            status: 'failed',
            waitingOn: null,
            agent: 'panels',
            model: 'Sol · GPT-6.2',
            session: null,
            turns: 1,
            startedAt: nowSec - 85,
            endedAt: nowSec - 40,
            cached: false,
            error: 'Assertion failed in test_quota_limit',
          },
          {
            id: 'n7',
            kind: 'agent',
            label: 'Audit core/cache.py',
            name: 'cache',
            phase: 0,
            group: 'n1',
            status: 'completed',
            waitingOn: null,
            agent: 'panels',
            model: 'Fable 5.2',
            session: null,
            turns: 1,
            startedAt: nowSec - 90,
            endedAt: nowSec - 55,
            cached: true,
            error: null,
          },
          {
            id: 'n8',
            kind: 'session',
            label: 'Verification session',
            name: 'verifier',
            phase: 1,
            group: null,
            status: 'running',
            waitingOn: null,
            agent: 'panels',
            model: 'Fable 5.2',
            session: null,
            turns: 2,
            startedAt: nowSec - 50,
            endedAt: null,
            cached: false,
            error: null,
          },
          {
            id: 'n9',
            kind: 'turn',
            label: 'Pass 1: unit checks',
            name: 'pass-1',
            phase: 1,
            group: null,
            status: 'completed',
            waitingOn: null,
            agent: 'panels',
            model: 'Fable 5.2',
            session: 'n8',
            turns: 1,
            startedAt: nowSec - 50,
            endedAt: nowSec - 30,
            cached: false,
            error: null,
          },
          {
            id: 'n10',
            kind: 'turn',
            label: 'Pass 2: confirm migration',
            name: 'pass-2',
            phase: 1,
            group: null,
            status: 'waiting',
            waitingOn: 'user',
            agent: 'panels',
            model: 'Fable 5.2',
            session: 'n8',
            turns: 1,
            startedAt: nowSec - 28,
            endedAt: null,
            cached: false,
            error: null,
          },
          {
            id: 'n11',
            kind: 'agent',
            label: 'Write summary report',
            name: 'reporter',
            phase: 2,
            group: null,
            status: 'queued',
            waitingOn: null,
            agent: 'panels',
            model: 'Sol · GPT-6.2',
            session: null,
            turns: 1,
            startedAt: null,
            endedAt: null,
            cached: false,
            error: null,
          },
        ],
        edges: [
          { from: 'n4', to: 'n5', count: 2 },
          { from: 'n5', to: 'n8', count: 1 },
        ],
        messages: [],
        log: ['Round 1: 12 done, 8 running', 'Large run: 40 agents, about $0.89 projected.'],
        omitted: {
          queued: 4,
          running: 0,
          waiting: 0,
          completed: 26,
          failed: 0,
          edges: 0,
          groups: 0,
          phases: 0,
          log: 0,
          messages: 0,
        },
      },
    },
    Date.now()
  );

  getSubagentRunStore(mx).ingest(
    ROOM_ID,
    AGENT,
    {
      run: 'delegation-1',
      sid: `${Date.now()}-b2c3d4e5`,
      seq: 1,
      meta: {
        agent: 'panels',
        subagent: 'delegation-1',
        caller: 'panels',
        root: 'panels',
        parent: null,
        threadId: THREAD_ID,
        source: 'workflow',
        status: 'running',
        startedAt: nowSec - 70,
        endedAt: null,
        result: 'Checked session rotation and cookie expiry paths; 1 edge case flagged.',
        model: {
          modelConfig: 'fable',
          modelDisplayName: 'Fable 5.2',
          modelProvider: 'anthropic',
          modelId: 'claude-fable-5.2',
        },
      },
      snapshot: {
        md: 'Inspecting auth/session.py rotation paths.',
        reasoning: '',
        tools: [],
        status: 'streaming',
        activity: 'Reading auth/session.py',
        segments: [],
      },
    },
    Date.now()
  );

  return { mx, room, workflowEntry: store.get(ROOM_ID, RUN_RUNNING)! };
};

const cards: WorkflowRunCardData[] = [
  {
    run: RUN_RUNNING,
    jobId: 'job-wf-running',
    requester: VIEWER,
    title: 'Audit the sample module',
    name: 'audit-module',
    status: 'running',
    counts: {
      queued: 4,
      running: 8,
      waiting: 0,
      completed: 12,
      failed: 0,
      indeterminate: 0,
      cached: 2,
    },
    usage: {
      inputTokens: 48200,
      outputTokens: 3120,
      toolCalls: 19,
      costUsd: 0.42,
      projectedCostUsd: 0.89,
      costUnknown: false,
    },
    phases: ['Audit', 'Verify', 'Report'],
    attempt: 1,
    startedAt: nowSec - 95,
    endedAt: null,
    error: null,
    large: false,
  },
  {
    run: RUN_WAITING,
    jobId: 'job-wf-waiting',
    requester: VIEWER,
    title: 'Prepare release checklist',
    status: 'waiting',
    counts: {
      queued: 2,
      running: 1,
      waiting: 1,
      completed: 6,
      failed: 0,
      indeterminate: 0,
      cached: 0,
    },
    usage: {
      inputTokens: 21000,
      outputTokens: 1500,
      toolCalls: 8,
      costUsd: 0.19,
      projectedCostUsd: 0.31,
      costUnknown: false,
    },
    phases: ['Checks', 'Sign-off'],
    attempt: 1,
    startedAt: nowSec - 180,
    endedAt: null,
    error: null,
    large: false,
  },
  {
    run: RUN_DONE,
    jobId: 'job-wf-done',
    requester: VIEWER,
    title: 'Review API contract changes',
    status: 'completed',
    counts: {
      queued: 0,
      running: 0,
      waiting: 0,
      completed: 24,
      failed: 2,
      indeterminate: 0,
      cached: 6,
    },
    usage: {
      inputTokens: 140000,
      outputTokens: 8900,
      toolCalls: 42,
      costUsd: 1.24,
      projectedCostUsd: 1.24,
      costUnknown: false,
    },
    phases: ['Scan', 'Verify'],
    attempt: 2,
    startedAt: nowSec - 620,
    endedAt: nowSec - 120,
    error: null,
    large: true,
  },
  {
    run: RUN_INTERRUPTED,
    jobId: 'job-wf-interrupted',
    requester: VIEWER,
    title: 'Full repository audit',
    status: 'interrupted',
    counts: {
      queued: 18,
      running: 0,
      waiting: 0,
      completed: 30,
      failed: 0,
      indeterminate: 0,
      cached: 0,
    },
    usage: {
      inputTokens: 220000,
      outputTokens: 14000,
      toolCalls: 64,
      costUsd: 2.0,
      projectedCostUsd: 3.2,
      costUnknown: false,
    },
    phases: ['Audit', 'Verify'],
    attempt: 1,
    startedAt: nowSec - 400,
    endedAt: nowSec - 60,
    error: 'Stopped at the cost limit ($2.00 of $2.00).',
    large: true,
  },
];

const questions: WorkflowRunQuestion[] = [
  {
    run: RUN_WAITING,
    node: 'n5',
    questionId: 'q3fa91c',
    requester: VIEWER,
    text: 'Ship the staged migration after the audit passes?',
    options: ['Yes, deploy', 'Hold for review'],
    freeText: false,
    status: 'open',
    answer: null,
  },
  {
    run: RUN_WAITING,
    node: 'n6',
    questionId: 'q9bc12e',
    requester: VIEWER,
    text: 'Which release note line should be included?',
    options: [],
    freeText: true,
    status: 'open',
    answer: null,
  },
  {
    run: RUN_DONE,
    node: 'n2',
    questionId: 'q1ab00f',
    requester: VIEWER,
    text: 'Include legacy endpoints in the contract check?',
    options: ['Yes', 'No'],
    freeText: false,
    status: 'answered',
    answer: 'Yes',
  },
];

function Fixture() {
  const { mx, room, workflowEntry } = useMemo(() => createFixtureClient(), []);
  const store = useMemo(() => createStore(), []);
  const [closedNotice, setClosedNotice] = useState(false);
  const rtl = params.get('dir') === 'rtl' || params.get('lang') === 'ar';
  const surface = params.get('surface') ?? 'cards';

  if (surface === 'panel') {
    return (
      <JotaiProvider store={store}>
        <MatrixClientProvider value={mx}>
          <main
            dir={rtl ? 'rtl' : 'ltr'}
            style={{ height: '100vh', display: 'flex', background: 'var(--bg-surface)' }}
          >
            {closedNotice ? (
              <div style={{ padding: 24 }}>Panel closed</div>
            ) : (
              <WorkflowPanel
                room={room}
                run={RUN_RUNNING}
                threadId={THREAD_ID}
                onClose={() => setClosedNotice(true)}
              />
            )}
          </main>
        </MatrixClientProvider>
      </JotaiProvider>
    );
  }

  return (
    <JotaiProvider store={store}>
      <MatrixClientProvider value={mx}>
        <main
          dir={rtl ? 'rtl' : 'ltr'}
          style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20, maxWidth: 720 }}
        >
          <section aria-label="Run cards">
            {cards.map((card) => (
              <WorkflowRunCard
                key={card.run}
                card={card}
                roomId={ROOM_ID}
                threadId={THREAD_ID}
                sender={AGENT}
              />
            ))}
          </section>

          <section
            aria-label="Question cards"
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {questions.map((question) => (
              <WorkflowQuestionCard
                key={question.questionId}
                question={question}
                roomId={ROOM_ID}
                threadId={THREAD_ID}
                eventId={`$card-${question.questionId}`}
              />
            ))}
          </section>

          <section aria-label="Jobs bar row">
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              <BackgroundJobRow
                room={room}
                viewThreadId={THREAD_ID}
                item={{
                  jobId: 'job-wf-running',
                  name: 'Audit the sample module',
                  waiting: false,
                  stopping: false,
                  finished: false,
                  subagent: false,
                  workflow: RUN_RUNNING,
                  workflowRun: workflowEntry,
                  agent: 'panels',
                  threadId: THREAD_ID,
                  state: 'running',
                  startedAt: (nowSec - 95) * 1000,
                  depth: 0,
                }}
                onOpen={() => undefined}
                stop={null}
              />
            </ul>
          </section>
        </main>
      </MatrixClientProvider>
    </JotaiProvider>
  );
}

void i18n.changeLanguage(params.get('lang') ?? 'en').then(() => {
  createRoot(document.getElementById('root')!).render(<Fixture />);
});
