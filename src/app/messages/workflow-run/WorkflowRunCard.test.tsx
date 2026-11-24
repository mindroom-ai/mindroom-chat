// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MatrixEvent, type IContent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workflowRunPanelAtom } from '../../navigation/workflowPanel';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../../matrix/protocol/backgroundJobsContract';
import { keepCancelsOf } from '../../matrix/state/sentCancels';
import {
  WORKFLOW_CONTROL_EVENT_TYPE,
  WORKFLOW_RUN_CONTENT_KEY,
  type WorkflowRunCard as WorkflowRunCardData,
} from '../../matrix/protocol/workflowRunContent';
import { parseWorkflowFrame } from '../../matrix/protocol/workflowFrame';
import { getWorkflowRunStore } from '../live/workflowRunStore';
import frames from '../live/__fixtures__/workflow-frames-v1.json';
import { RenderMessageContent } from '../content/RenderMessageContent';
import { WorkflowRunCard } from './WorkflowRunCard';

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-sample-1';
const VIEWER = '@alex:example.org';
const OTHER = '@sam:example.org';
const AGENT = '@mindroom_panels:example.org';
const firstFrame = frames[0]!;
const RUN = firstFrame.run;

const makeCard = (overrides: Partial<WorkflowRunCardData> = {}): WorkflowRunCardData => ({
  run: RUN,
  jobId: 'job-wf-1',
  requester: VIEWER,
  title: 'Audit the sample module',
  status: 'running',
  counts: {
    queued: 0,
    running: 2,
    waiting: 0,
    completed: 0,
    failed: 0,
    indeterminate: 0,
    cached: 0,
  },
  usage: {
    inputTokens: 1000,
    outputTokens: 200,
    toolCalls: 4,
    costUsd: 0.12,
    projectedCostUsd: 0.45,
    costUnknown: false,
  },
  phases: ['Audit', 'Verify'],
  attempt: 1,
  startedAt: 1795389735,
  endedAt: null,
  error: null,
  large: false,
  ...overrides,
});

const makeClient = ({
  userId = VIEWER,
  canCancel = true,
  sendEvent = vi.fn(async () => ({ event_id: '$sent-1' })),
}: {
  userId?: string;
  canCancel?: boolean;
  sendEvent?: ReturnType<typeof vi.fn>;
} = {}) => {
  const powerLevelsEvent = new MatrixEvent({
    type: 'm.room.power_levels',
    state_key: '',
    room_id: ROOM_ID,
    sender: VIEWER,
    content: {
      users_default: canCancel ? 50 : 0,
      events_default: 50,
      events: { [MINDROOM_BACKGROUND_JOB_CANCEL_EVENT]: 50 },
    },
  });
  const createEvent = new MatrixEvent({
    type: 'm.room.create',
    state_key: '',
    room_id: ROOM_ID,
    sender: OTHER,
    content: { room_version: '11' },
  });
  const currentState = {
    getStateEvents: (type: string) => {
      if (type === 'm.room.power_levels') return powerLevelsEvent;
      if (type === 'm.room.create') return createEvent;
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
    getMember: (id: string) => ({ userId: id, name: id, rawDisplayName: id, membership: 'join' }),
    getEventForTxnId: () => undefined,
  }) as unknown as Room;

  const mx = Object.assign(new EventEmitter(), {
    getUserId: () => userId,
    getSafeUserId: () => userId,
    getRoom: (id: string) => (id === ROOM_ID ? room : null),
    makeTxnId: () => 'txn-1',
    sendEvent,
  }) as unknown as MatrixClient;
  (room as unknown as { client: MatrixClient }).client = mx;

  return { mx, room, sendEvent };
};

describe('WorkflowRunCard', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    keepCancelsOf(ROOM_ID, new Set());
    vi.useRealTimers();
  });

  it('prefers the live run over the card it was posted with', () => {
    const { mx } = makeClient();
    const store = getWorkflowRunStore(mx);
    const liveFrame = parseWorkflowFrame({
      ...firstFrame,
      meta: {
        ...firstFrame.meta,
        status: 'waiting',
        counts: {
          queued: 0,
          running: 8,
          waiting: 1,
          completed: 12,
          failed: 0,
          indeterminate: 0,
          cached: 0,
        },
      },
    })!;
    store.ingest(ROOM_ID, AGENT, liveFrame, Date.now());

    render(
      <MatrixClientProvider value={mx}>
        <WorkflowRunCard
          card={makeCard({ status: 'running' })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
        />
      </MatrixClientProvider>
    );

    expect(screen.getByText('Waiting for you')).toBeTruthy();
    expect(screen.getByText('12 done, 8 running, 1 waiting')).toBeTruthy();
  });

  it('stops through the job cancel event and reads Stopping', async () => {
    const sendEvent = vi.fn(async () => ({ event_id: '$cancel-1' }));
    const { mx } = makeClient({ sendEvent });

    render(
      <MatrixClientProvider value={mx}>
        <WorkflowRunCard card={makeCard()} roomId={ROOM_ID} threadId={THREAD_ID} />
      </MatrixClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(sendEvent).toHaveBeenCalledWith(
      ROOM_ID,
      MINDROOM_BACKGROUND_JOB_CANCEL_EVENT,
      { job_id: 'job-wf-1', 'm.relates_to': { rel_type: 'm.thread', event_id: THREAD_ID } },
      'txn-1'
    );
    expect(await screen.findByText('Stopping…')).toBeTruthy();
  });

  it('offers Resume to the requester of an interrupted run only, and Run again on a finished one', async () => {
    const sendEvent = vi.fn(async () => ({ event_id: '$resume-1' }));
    const { mx } = makeClient({ userId: VIEWER, sendEvent });

    const { rerender } = render(
      <MatrixClientProvider value={mx}>
        <WorkflowRunCard
          card={makeCard({
            status: 'interrupted',
            endedAt: 1795389800,
            error: 'Stopped at the cost limit ($1.00 of $1.00).',
          })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
        />
      </MatrixClientProvider>
    );

    expect(screen.getByText('Stopped at the cost limit ($1.00 of $1.00).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(sendEvent).toHaveBeenCalledWith(
      ROOM_ID,
      WORKFLOW_CONTROL_EVENT_TYPE,
      { run: RUN, action: 'resume', 'm.relates_to': { rel_type: 'm.thread', event_id: THREAD_ID } },
      'txn-1'
    );
    expect(await screen.findByText('Starting…')).toBeTruthy();

    rerender(
      <MatrixClientProvider value={mx}>
        <WorkflowRunCard
          card={makeCard({ status: 'completed', endedAt: 1795389800, attempt: 2 })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
        />
      </MatrixClientProvider>
    );
    expect(screen.getByRole('button', { name: 'Run again' })).toBeTruthy();

    const otherClient = makeClient({ userId: OTHER });
    rerender(
      <MatrixClientProvider value={otherClient.mx}>
        <WorkflowRunCard
          card={makeCard({ status: 'interrupted', endedAt: 1795389800 })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
        />
      </MatrixClientProvider>
    );
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
  });

  it('shows why a run failed, how many calls failed, and saved workflow name when present', () => {
    const { mx } = makeClient();
    render(
      <MatrixClientProvider value={mx}>
        <WorkflowRunCard
          card={makeCard({
            name: 'audit-module',
            status: 'failed',
            endedAt: 1795389800,
            error: 'RuntimeError: checks failed',
            counts: {
              queued: 0,
              running: 0,
              waiting: 0,
              completed: 5,
              failed: 2,
              indeterminate: 1,
              cached: 0,
            },
          })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
        />
      </MatrixClientProvider>
    );

    expect(screen.getByText('audit-module')).toBeTruthy();
    expect(screen.getByText('RuntimeError: checks failed')).toBeTruthy();
    expect(screen.getByText('3 failed')).toBeTruthy();
  });

  it('shows no Stop to a viewer who may not cancel jobs, and none on a finished run', () => {
    const restricted = makeClient({ canCancel: false });
    const { rerender } = render(
      <MatrixClientProvider value={restricted.mx}>
        <WorkflowRunCard
          card={makeCard({ status: 'running' })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
        />
      </MatrixClientProvider>
    );
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    const allowed = makeClient({ canCancel: true });
    rerender(
      <MatrixClientProvider value={allowed.mx}>
        <WorkflowRunCard
          card={makeCard({ status: 'completed', endedAt: 1795389800 })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
        />
      </MatrixClientProvider>
    );
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('does not render a card for workflow content from a person', () => {
    const { mx } = makeClient();
    const content: IContent = {
      msgtype: 'm.notice',
      body: 'Plain fallback text from a person',
      [WORKFLOW_RUN_CONTENT_KEY]: {
        run: RUN,
        job_id: 'job-wf-1',
        requester: VIEWER,
        title: 'Spoofed workflow',
        status: 'running',
        counts: {
          queued: 0,
          running: 1,
          waiting: 0,
          completed: 0,
          failed: 0,
          indeterminate: 0,
          cached: 0,
        },
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          tool_calls: 0,
          cost_usd: '0',
          cost_unknown: false,
        },
        phases: [],
        attempt: 1,
        started_at: 1795389735,
        ended_at: null,
        error: null,
        large: false,
      },
    };
    const personEvent = new MatrixEvent({
      type: 'm.room.message',
      event_id: '$ev-person',
      room_id: ROOM_ID,
      sender: OTHER,
      origin_server_ts: 1,
      content,
    });
    render(
      <ClientConfigProvider value={{}}>
        <MatrixClientProvider value={mx}>
          <RenderMessageContent
            displayName="Sam"
            msgType="m.notice"
            ts={1}
            edited={false}
            getContent={() => content as never}
            mediaAutoLoad={false}
            urlPreview={false}
            linkifyOpts={{}}
            htmlReactParserOptions={{}}
            roomId={ROOM_ID}
            eventId="$ev-person"
            mEvent={personEvent}
          />
        </MatrixClientProvider>
      </ClientConfigProvider>
    );

    expect(screen.getByText('Plain fallback text from a person')).toBeTruthy();
    expect(screen.queryByText('Spoofed workflow')).toBeNull();
  });

  it('shows Graph on the card only when there is a graph to show and opens the panel', () => {
    const { mx } = makeClient();
    const jotaiStore = createStore();
    const { rerender } = render(
      <JotaiProvider store={jotaiStore}>
        <MatrixClientProvider value={mx}>
          <WorkflowRunCard
            card={makeCard({ graph: undefined })}
            roomId={ROOM_ID}
            threadId={THREAD_ID}
          />
        </MatrixClientProvider>
      </JotaiProvider>
    );
    expect(screen.queryByRole('button', { name: 'Graph' })).toBeNull();

    const cardWithGraph = makeCard({
      status: 'completed',
      endedAt: 1795389800,
      graph: {
        phases: ['Audit'],
        groups: [],
        nodes: [],
        edges: [],
        log: [],
        omitted: {
          queued: 0,
          running: 0,
          waiting: 0,
          completed: 0,
          failed: 0,
          edges: 0,
          groups: 0,
          phases: 0,
          log: 0,
        },
      },
    });
    rerender(
      <JotaiProvider store={jotaiStore}>
        <MatrixClientProvider value={mx}>
          <WorkflowRunCard
            card={cardWithGraph}
            roomId={ROOM_ID}
            threadId={THREAD_ID}
            sender={AGENT}
          />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Graph' }));
    expect(getWorkflowRunStore(mx).getView(ROOM_ID, RUN)?.graph).toBeDefined();
    expect(jotaiStore.get(workflowRunPanelAtom)).toEqual({
      roomId: ROOM_ID,
      run: RUN,
      threadId: THREAD_ID,
    });
  });

  it('does not let a stale live running frame override a newer durable waiting card edit', () => {
    vi.useFakeTimers();
    const { mx } = makeClient();
    const store = getWorkflowRunStore(mx);
    store.ingest(
      ROOM_ID,
      AGENT,
      {
        run: RUN,
        sid: '1795389735000-a1b2c3d4',
        seq: 1,
        meta: {
          agent: 'panels',
          threadId: THREAD_ID,
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
            completed: 1,
            failed: 0,
            indeterminate: 0,
            cached: 0,
          },
          usage: {
            inputTokens: 1000,
            outputTokens: 100,
            toolCalls: 2,
            costUsd: 0.05,
            costUnknown: false,
          },
        },
        snapshot: {
          phases: ['Audit'],
          groups: [],
          nodes: [],
          edges: [],
          log: [],
          omitted: {
            queued: 0,
            running: 0,
            waiting: 0,
            completed: 0,
            failed: 0,
            edges: 0,
            groups: 0,
            phases: 0,
            log: 0,
          },
        },
      },
      1000
    );
    vi.advanceTimersByTime(30_000);

    const waitingCard = makeCard({
      status: 'waiting',
      counts: {
        queued: 0,
        running: 1,
        waiting: 1,
        completed: 1,
        failed: 0,
        indeterminate: 0,
        cached: 0,
      },
    });
    render(
      <JotaiProvider>
        <MatrixClientProvider value={mx}>
          <WorkflowRunCard
            card={waitingCard}
            roomId={ROOM_ID}
            threadId={THREAD_ID}
            sender={AGENT}
          />
        </MatrixClientProvider>
      </JotaiProvider>
    );

    const cardEl = document.querySelector(`[data-workflow-run-card="${RUN}"]`);
    expect(cardEl?.getAttribute('data-workflow-run-status')).toBe('waiting');
    expect(screen.getByRole('button', { name: 'Graph' })).toBeTruthy();
  });

  it('keeps newer live progress instead of reverting to an older running card on timeout', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { mx } = makeClient();
    const store = getWorkflowRunStore(mx);
    const oldCard = makeCard({
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
    });
    render(
      <JotaiProvider>
        <MatrixClientProvider value={mx}>
          <WorkflowRunCard
            card={oldCard}
            roomId={ROOM_ID}
            threadId={THREAD_ID}
            sender={AGENT}
            updatedAt={1000}
          />
        </MatrixClientProvider>
      </JotaiProvider>
    );
    act(() => {
      store.ingest(
        ROOM_ID,
        AGENT,
        {
          run: RUN,
          sid: '1795389735000-a1b2c3d4',
          seq: 2,
          meta: {
            agent: 'panels',
            threadId: THREAD_ID,
            title: 'Audit the sample module',
            status: 'running',
            attempt: 1,
            startedAt: 1795389735,
            endedAt: null,
            large: false,
            counts: {
              queued: 5,
              running: 1,
              waiting: 0,
              completed: 45,
              failed: 0,
              indeterminate: 0,
              cached: 0,
            },
            usage: {
              inputTokens: 2000,
              outputTokens: 200,
              toolCalls: 4,
              costUsd: 0.05,
              costUnknown: false,
            },
          },
          snapshot: {
            phases: ['Audit'],
            groups: [],
            nodes: [],
            edges: [],
            omitted: {
              queued: 0,
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
        },
        5000
      );
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('45 done, 1 running, 0 waiting')).toBeTruthy();
  });
});
