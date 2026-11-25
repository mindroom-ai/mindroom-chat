// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient, MatrixEvent, RelationType, Room, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadApprovalProvider } from '../approvals/ThreadApprovalProvider';
import { collectThreadApprovals } from '../matrix/protocol/threadApprovalModel';
import { MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT } from '../matrix/protocol/toolApproval';
import type { WorkflowRunEntry } from '../messages/live/workflowRunStore';
import type { BackgroundJobsBarItem } from './backgroundJobsPresentation';
import { JobApprovalDialog, matchJobApprovals } from './JobApprovalDialog';

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  navigateRoomThread: vi.fn(),
  signals: new Set<() => void>(),
  liveArrive: undefined as ((event: MatrixEvent) => void) | undefined,
  ignored: [] as string[],
}));
const engine = { scheduler: { abort: vi.fn() }, persist: { persistThreadEventCache: vi.fn() } };
let mx: MatrixClient;
let room: Room;
let sendEvent: ReturnType<typeof vi.fn>;

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useIgnoredUsers', () => ({ useIgnoredUsers: () => mocks.ignored }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: mocks.navigateRoomThread }),
}));
vi.mock('../event-store/engine', () => ({
  enqueueThreadApprovalBackfill: mocks.backfill,
  useSyncEngine: () => engine,
}));
vi.mock('../event-store/timeline/roomLiveEventArrive', () => ({
  useLiveEventArrive: (_room: Room, onArrive: (event: MatrixEvent) => void) => {
    mocks.liveArrive = onArrive;
  },
}));
vi.mock('../threads/cross-room/threadSignalsReader', () => ({
  subscribeRoomSignals: (_mx: unknown, _roomId: string, onChange: () => void) => {
    mocks.signals.add(onChange);
    return () => void mocks.signals.delete(onChange);
  },
}));
vi.mock('../ui/page/PageScroll', () => ({
  PageScroll: ({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));
vi.mock('focus-trap-react', async (importOriginal) => {
  const { FocusTrap } = await importOriginal<typeof import('focus-trap-react')>();
  return {
    FocusTrap: (props: React.ComponentProps<typeof FocusTrap>) => (
      <FocusTrap
        {...props}
        focusTrapOptions={{ ...props.focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});

const approvalEvent = (
  eventId: string,
  overrides: Record<string, unknown> = {},
  sender = '@mindroom_builder:example.org'
) =>
  new MatrixEvent({
    event_id: eventId,
    room_id: '!room:example.org',
    sender,
    origin_server_ts: 1_000,
    type: 'io.mindroom.tool_approval',
    content: {
      approval_id: `appr-${eventId}`,
      tool_name: 'run_sample_check',
      agent_name: 'builder',
      arguments: { target: 'alpha-widget' },
      requester_id: '@alice:example.org',
      approver_user_id: '@alice:example.org',
      approvable: true,
      status: 'pending',
      requested_at: '2026-10-11T12:00:00Z',
      expires_at: '2999-10-11T12:00:00Z',
      thread_id: '$thread-1',
      ...overrides,
    },
  });

const editApproval = (origin: MatrixEvent, eventId: string, status: 'approved' | 'denied') =>
  new MatrixEvent({
    event_id: eventId,
    room_id: origin.getRoomId(),
    sender: origin.getSender(),
    origin_server_ts: 2_000,
    type: 'io.mindroom.tool_approval',
    content: {
      'm.relates_to': { rel_type: RelationType.Replace, event_id: origin.getId() },
      'm.new_content': {
        ...origin.getOriginalContent(),
        status,
        resolved_by: '@alice:example.org',
        resolved_at: '2026-10-11T12:01:00Z',
      },
    },
  });

const makeJob = (overrides: Partial<BackgroundJobsBarItem> = {}): BackgroundJobsBarItem => ({
  jobId: 'job-alpha',
  toolCallId: 'call-alpha',
  name: 'run_sample_check',
  waiting: true,
  stopping: false,
  finished: false,
  subagent: false,
  threadId: '$thread-1',
  state: 'waiting',
  startedAt: Date.parse('2026-10-11T12:00:00Z'),
  depth: 0,
  ...overrides,
});

const dialogText = () => document.body.querySelector('[role="dialog"]')?.textContent ?? '';
const buttonByText = (text: string) =>
  [...document.body.querySelectorAll('button')].find(
    (btn) => btn.textContent?.trim() === text || btn.getAttribute('aria-label') === text
  );
const clickButton = (text: string) => act(async () => void buttonByText(text)?.click());

describe('matchJobApprovals', () => {
  const workflowRun = {
    run: 'wf-1234',
    graph: {
      nodes: [
        { id: 'n1', status: 'running', waitingOn: null, job: 'job-running-node' },
        { id: 'n2', status: 'waiting', waitingOn: 'approval', job: 'job-wf-step' },
      ],
    },
  } as unknown as WorkflowRunEntry;

  it.each<[string, Partial<BackgroundJobsBarItem>, MatrixEvent[], string[]]>([
    [
      'exact jobId match (tool / sub-agent)',
      { jobId: 'job-alpha', toolCallId: undefined },
      [
        approvalEvent('$other', { background_run_id: 'tool-job:job-beta' }),
        approvalEvent('$match', { background_run_id: 'tool-job:job-alpha' }),
      ],
      ['$match'],
    ],
    [
      'exact toolCallId match',
      { jobId: 'job-different', toolCallId: 'call-alpha' },
      [
        approvalEvent('$other', { tool_call_id: 'call-other' }),
        approvalEvent('$match', { tool_call_id: 'call-alpha' }),
      ],
      ['$match'],
    ],
    [
      'workflow waiting node job match ignoring an unrelated foreground approval',
      { jobId: 'job-wf', toolCallId: undefined, workflow: 'wf-1234', workflowRun },
      [
        approvalEvent('$foreground', { tool_name: 'foreground_tool' }),
        approvalEvent('$wf-step', { background_run_id: 'tool-job:job-wf-step' }),
      ],
      ['$wf-step'],
    ],
    [
      'direct workflow script approval matching backgroundRunId === job.workflow',
      { jobId: 'job-wf', toolCallId: undefined, workflow: 'wf-1234' },
      [
        approvalEvent('$foreground', { tool_name: 'foreground_tool' }),
        approvalEvent('$wf-direct', { background_run_id: 'wf-1234' }),
      ],
      ['$wf-direct'],
    ],
    [
      'unrelated tagged card returns empty',
      { jobId: 'job-target', toolCallId: 'call-target' },
      [
        approvalEvent('$other-job', { background_run_id: 'tool-job:job-other' }),
        approvalEvent('$other-call', { tool_call_id: 'call-other' }),
      ],
      [],
    ],
    [
      'unrelated untagged foreground card returns empty',
      { jobId: 'job-target', toolCallId: undefined },
      [approvalEvent('$foreground', { tool_name: 'foreground_tool' })],
      [],
    ],
  ])('%s', (_name, job, events, expected) => {
    const records = collectThreadApprovals(events, '!room:example.org', '$thread-1');
    expect(matchJobApprovals(records, makeJob(job)).map((r) => r.eventId)).toEqual(expected);
  });
});

let container: HTMLDivElement;
let root: Root;

const addLive = (...events: MatrixEvent[]) => room.addLiveEvents(events, { addToState: false });
const renderDialog = (
  props: Partial<React.ComponentProps<typeof JobApprovalDialog>> & { key?: string } = {}
) => {
  const { key, ...rest } = props;
  return act(async () => {
    root.render(
      <JobApprovalDialog
        key={key}
        room={room}
        job={makeJob()}
        viewThreadId={null}
        onClose={vi.fn()}
        returnFocus={createRef<HTMLElement | null>()}
        {...rest}
      />
    );
  });
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.backfill.mockImplementation(async (_mx, _s, _r, _t, origins?: MatrixEvent[]) => ({
    events: [],
    repairedEventIds: (origins ?? []).flatMap((origin) => origin.getId() ?? []),
  }));
  mocks.signals.clear();
  mocks.liveArrive = undefined;
  mocks.ignored = [];

  mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
  sendEvent = vi.fn().mockResolvedValue({ event_id: '$resp-1' });
  mx.sendEvent = sendEvent as unknown as MatrixClient['sendEvent'];
  room = new Room('!room:example.org', mx, '@alice:example.org');
  mx.store.storeRoom(room);

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('JobApprovalDialog', () => {
  it('shows checking state until backfill matches, submits Approve, and keeps the receipt open', async () => {
    const foreground = approvalEvent('$fg', { tool_name: 'foreground_tool' });
    const matching = approvalEvent('$match-appr', {
      background_run_id: 'tool-job:job-alpha',
      tool_call_id: 'call-alpha',
    });
    await addLive(foreground);

    let resolveBackfill!: (value: { events: MatrixEvent[]; repairedEventIds: string[] }) => void;
    mocks.backfill.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveBackfill = r;
        })
    );

    const onClose = vi.fn();
    await renderDialog({ onClose });
    expect(dialogText()).toContain('Checking approval');
    expect(dialogText()).not.toContain('foreground_tool');

    await act(async () => resolveBackfill({ events: [matching], repairedEventIds: [] }));
    expect(dialogText()).toContain('run_sample_check');
    expect(dialogText()).not.toContain('foreground_tool');

    await clickButton('Approve');
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      expect.objectContaining({
        status: 'approved',
        'm.relates_to': expect.objectContaining({
          event_id: '$thread-1',
          'm.in_reply_to': { event_id: '$match-appr' },
        }),
      })
    );

    await act(async () => mocks.liveArrive?.(editApproval(matching, '$match-edit', 'approved')));
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogText()).toContain('Approved');
  });

  it('reuses an existing ThreadApprovalProvider for the same thread and submits Deny', async () => {
    const matching = approvalEvent('$reuse-appr', { tool_call_id: 'call-alpha' });
    mocks.backfill.mockResolvedValueOnce({ events: [matching], repairedEventIds: [] });

    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <ThreadApprovalProvider room={room} threadId="$thread-1">
          <JobApprovalDialog
            room={room}
            job={makeJob({ jobId: 'different-job-id', toolCallId: 'call-alpha' })}
            viewThreadId="$thread-1"
            onClose={onClose}
            returnFocus={createRef<HTMLElement | null>()}
          />
        </ThreadApprovalProvider>
      )
    );

    expect(mocks.backfill.mock.calls.filter((call) => !call[4])).toHaveLength(1);
    await clickButton('Deny');
    await clickButton('Confirm deny');
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      expect.objectContaining({ status: 'denied' })
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows Retry and Open thread on backfill error outside the thread, and omits Open thread inside it', async () => {
    mocks.backfill.mockResolvedValue({ events: [], repairedEventIds: [], error: 'unloadable' });
    const onClose = vi.fn();
    await renderDialog({ onClose });

    expect(dialogText()).toContain('Some approval history could not be loaded.');
    await clickButton('Retry history');
    expect(mocks.backfill).toHaveBeenCalledTimes(2);

    await clickButton('Open thread');
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith('!room:example.org', '$thread-1');
    expect(onClose).toHaveBeenCalledTimes(1);

    await renderDialog({ key: 'in-thread', viewThreadId: '$thread-1' });
    expect(buttonByText('Retry history')).toBeTruthy();
    expect(buttonByText('Open thread')).toBeUndefined();
  });

  it('shows unavailable + Open thread when only unrelated cards exist, and for unconfirmed thread IDs', async () => {
    mocks.backfill.mockResolvedValueOnce({
      events: [approvalEvent('$fg-only', { tool_name: 'foreground_tool' })],
      repairedEventIds: [],
    });
    await renderDialog({ job: makeJob({ jobId: 'job-target', toolCallId: undefined }) });
    expect(dialogText()).toContain('Some requests are no longer available.');
    expect(dialogText()).not.toContain('foreground_tool');
    expect(buttonByText('Open thread')).toBeTruthy();

    await addLive(
      approvalEvent('$room-card', {
        thread_id: null,
        background_run_id: 'tool-job:job-target',
        tool_name: 'room_only_tool',
      })
    );
    await renderDialog({
      key: 'unconfirmed',
      job: makeJob({ jobId: 'job-target', threadId: '~pending-thread' }),
    });
    expect(dialogText()).toContain('Some requests are no longer available.');
    expect(dialogText()).not.toContain('room_only_tool');
  });

  it('handles room-level (threadId: null) approvals and ignores non-agent senders', async () => {
    const roomApproval = approvalEvent('$room-appr', {
      thread_id: null,
      background_run_id: 'tool-job:job-room',
      tool_name: 'room_sample_tool',
    });
    await addLive(
      approvalEvent(
        '$forged',
        { thread_id: null, background_run_id: 'tool-job:job-room', tool_name: 'forged_tool' },
        '@mallory:example.org'
      ),
      roomApproval
    );

    await renderDialog({
      job: makeJob({ jobId: 'job-room', toolCallId: undefined, threadId: null }),
    });
    expect(dialogText()).toContain('room_sample_tool');
    expect(dialogText()).not.toContain('forged_tool');

    await clickButton('Approve');
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      expect.objectContaining({ status: 'approved' })
    );

    await addLive(editApproval(roomApproval, '$room-edit', 'approved'));
    await act(async () => mocks.signals.forEach((listener) => listener()));
    expect(dialogText()).toContain('Approved');
  });

  it('restores focus via fallbackFocus or focusConversation when the trigger detaches', async () => {
    const matching = approvalEvent('$focus-appr', { background_run_id: 'tool-job:job-alpha' });
    mocks.backfill.mockResolvedValueOnce({ events: [matching], repairedEventIds: [] });

    const [pill, barToggle, composer] = ['button', 'button', 'input'].map((t) =>
      document.createElement(t)
    );
    document.body.append(pill!, barToggle!, composer!);
    const returnFocus = { current: pill! } as React.RefObject<HTMLElement | null>;
    const focusConversation = vi.fn(() => composer!.focus());

    const Harness = () => {
      const [open, setOpen] = React.useState(true);
      return open ? (
        <JobApprovalDialog
          room={room}
          job={makeJob()}
          viewThreadId={null}
          onClose={() => setOpen(false)}
          returnFocus={returnFocus}
          focusConversation={focusConversation}
          fallbackFocus={() => (barToggle!.isConnected ? barToggle!.focus() : focusConversation())}
        />
      ) : null;
    };

    try {
      await act(async () => root.render(<Harness />));
      pill!.remove();
      await clickButton('Close');
      await vi.waitFor(() => expect(document.activeElement).toBe(barToggle));
      expect(focusConversation).not.toHaveBeenCalled();

      barToggle!.remove();
      mocks.backfill.mockResolvedValueOnce({ events: [matching], repairedEventIds: [] });
      await act(async () => root.render(<Harness key="bar-gone" />));
      await clickButton('Close');
      await vi.waitFor(() => expect(document.activeElement).toBe(composer));
      expect(focusConversation).toHaveBeenCalledTimes(1);
    } finally {
      [pill, barToggle, composer].forEach((node) => node?.remove());
    }
  });
});
