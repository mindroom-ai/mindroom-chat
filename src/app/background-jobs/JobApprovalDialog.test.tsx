// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient, MatrixEvent, RelationType, Room, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadApprovalProvider } from '../approvals/ThreadApprovalProvider';
import { MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT } from '../matrix/protocol/toolApproval';
import type { BackgroundJobsBarItem } from './backgroundJobsPresentation';
import { JobApprovalDialog } from './JobApprovalDialog';

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  abort: vi.fn(),
  persist: vi.fn(),
  navigateRoomThread: vi.fn(),
  signals: new Set<() => void>(),
  liveArrive: undefined as ((event: MatrixEvent) => void) | undefined,
  ignored: [] as string[],
}));

let mx: MatrixClient;
let room: Room;
let sendEvent: ReturnType<typeof vi.fn>;

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useIgnoredUsers', () => ({ useIgnoredUsers: () => mocks.ignored }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: mocks.navigateRoomThread }),
}));
const scheduler = { abort: mocks.abort };
const persist = { persistThreadEventCache: mocks.persist };
vi.mock('../event-store/engine', () => ({
  enqueueThreadApprovalBackfill: mocks.backfill,
  useSyncEngine: () => ({ scheduler, persist }),
}));
vi.mock('../event-store/timeline/roomLiveEventArrive', () => ({
  useLiveEventArrive: (_room: Room, onArrive: (event: MatrixEvent) => void) => {
    mocks.liveArrive = onArrive;
  },
}));
vi.mock('../threads/cross-room/threadSignalsReader', () => ({
  subscribeRoomSignals: (_mx: unknown, _roomId: string, onChange: () => void) => {
    mocks.signals.add(onChange);
    return () => {
      mocks.signals.delete(onChange);
    };
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
        focusTrapOptions={{
          ...props.focusTrapOptions,
          tabbableOptions: { displayCheck: 'none' },
        }}
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

const buttonByText = (text: string) =>
  [...document.body.querySelectorAll('button')].find(
    (btn) => btn.textContent?.trim() === text || btn.getAttribute('aria-label') === text
  );

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.backfill
    .mockReset()
    .mockImplementation(async (_mx, _scheduler, _roomId, _threadId, origins?: MatrixEvent[]) => ({
      events: [],
      repairedEventIds: (origins ?? []).flatMap((origin) => origin.getId() ?? []),
    }));
  mocks.abort.mockReset();
  mocks.persist.mockReset();
  mocks.navigateRoomThread.mockReset();
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
  it('opens from Room Overview, matches the job approval, submits Approve, and keeps the receipt open', async () => {
    const unrelated = approvalEvent('$other-appr', {
      background_run_id: 'tool-job:job-beta',
      tool_name: 'other_tool',
      arguments: { target: 'beta-widget' },
    });
    const matching = approvalEvent('$match-appr', {
      background_run_id: 'tool-job:job-alpha',
      tool_call_id: 'call-alpha',
    });
    mocks.backfill.mockResolvedValueOnce({
      events: [unrelated, matching],
      repairedEventIds: [],
    });

    const onClose = vi.fn();
    const returnFocus = createRef<HTMLElement | null>();
    await act(async () => {
      root.render(
        <JobApprovalDialog
          room={room}
          job={makeJob()}
          viewThreadId={null}
          onClose={onClose}
          returnFocus={returnFocus}
        />
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('run_sample_check');
    expect(dialog?.textContent).not.toContain('other_tool');

    await act(async () => {
      buttonByText('Approve')?.click();
    });
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

    // Server edit resolves the approval; the receipt remains visible until the user closes it.
    await act(async () => {
      mocks.liveArrive?.(editApproval(matching, '$match-edit', 'approved'));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Approved');
  });

  it('reuses an existing ThreadApprovalProvider for the same thread without duplicating backfill', async () => {
    const matching = approvalEvent('$reuse-appr', { tool_call_id: 'call-alpha' });
    mocks.backfill.mockResolvedValueOnce({ events: [matching], repairedEventIds: [] });

    const onClose = vi.fn();
    await act(async () => {
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
      );
    });

    // Discovery backfill ran once (for the outer provider), plus at most a repair pass for the origin.
    const discoveryCalls = mocks.backfill.mock.calls.filter((call) => !call[4]);
    expect(discoveryCalls).toHaveLength(1);
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'run_sample_check'
    );

    await act(async () => {
      buttonByText('Deny')?.click();
    });
    await act(async () => {
      buttonByText('Confirm deny')?.click();
    });
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      expect.objectContaining({ status: 'denied' })
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('waits for backfill before falling back to an untagged pending approval in the same thread', async () => {
    const untagged = approvalEvent('$untagged', {
      tool_name: 'other_tool',
    });
    const matching = approvalEvent('$exact', {
      background_run_id: 'tool-job:job-alpha',
      tool_name: 'run_sample_check',
    });
    // Put only the unrelated event into the live timeline before backfill finishes.
    await room.addLiveEvents([untagged], { addToState: false });

    let resolveBackfill!: (value: { events: MatrixEvent[]; repairedEventIds: string[] }) => void;
    mocks.backfill.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBackfill = resolve;
        })
    );

    await act(async () => {
      root.render(
        <JobApprovalDialog
          room={room}
          job={makeJob()}
          viewThreadId={null}
          onClose={vi.fn()}
          returnFocus={createRef<HTMLElement | null>()}
        />
      );
    });

    // While loading, shows the checking indicator instead of latching onto the unrelated approval.
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'Checking approval'
    );
    expect(document.body.querySelector('[role="dialog"]')?.textContent).not.toContain('other_tool');

    await act(async () => {
      resolveBackfill({ events: [matching], repairedEventIds: [] });
    });

    // Once backfill delivers the job's approval, shows only the matched approval.
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'run_sample_check'
    );
    expect(document.body.querySelector('[role="dialog"]')?.textContent).not.toContain('other_tool');
  });

  it('never offers a pending card tagged for a different job or tool call', async () => {
    const otherJobCard = approvalEvent('$other-job', {
      background_run_id: 'tool-job:job-other',
      tool_name: 'other_job_tool',
    });
    const otherCallCard = approvalEvent('$other-call', {
      tool_call_id: 'call-other',
      tool_name: 'other_call_tool',
    });
    mocks.backfill.mockResolvedValueOnce({
      events: [otherJobCard, otherCallCard],
      repairedEventIds: [],
    });

    await act(async () => {
      root.render(
        <JobApprovalDialog
          room={room}
          job={makeJob({ jobId: 'job-target', toolCallId: 'call-target' })}
          viewThreadId={null}
          onClose={vi.fn()}
          returnFocus={createRef<HTMLElement | null>()}
        />
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Some requests are no longer available.');
    expect(dialog?.textContent).not.toContain('other_job_tool');
    expect(dialog?.textContent).not.toContain('other_call_tool');
  });

  it('falls back to an untagged workflow/legacy approval after backfill finishes', async () => {
    const workflowCard = approvalEvent('$wf-card', {
      background_run_id: 'wf-1234',
      tool_call_id: 'call-wf',
      tool_name: 'workflow_step_tool',
    });
    mocks.backfill.mockResolvedValueOnce({ events: [workflowCard], repairedEventIds: [] });

    await act(async () => {
      root.render(
        <JobApprovalDialog
          room={room}
          job={makeJob({ jobId: 'job-wf', toolCallId: undefined, workflow: 'wf-1234' })}
          viewThreadId={null}
          onClose={vi.fn()}
          returnFocus={createRef<HTMLElement | null>()}
        />
      );
    });

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'workflow_step_tool'
    );
  });

  it('shows unavailable state for a non-null unconfirmed threadId instead of room-level approvals', async () => {
    const roomApproval = approvalEvent('$room-only', {
      thread_id: null,
      tool_name: 'room_only_tool',
    });
    await room.addLiveEvents([roomApproval], { addToState: false });

    await act(async () => {
      root.render(
        <JobApprovalDialog
          room={room}
          job={makeJob({ threadId: '~pending-local-thread' })}
          viewThreadId={null}
          onClose={vi.fn()}
          returnFocus={createRef<HTMLElement | null>()}
        />
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Some requests are no longer available.');
    expect(dialog?.textContent).not.toContain('room_only_tool');
  });

  it('shows Retry and Open thread on backfill error when outside the thread, and omits Open thread inside it', async () => {
    mocks.backfill.mockResolvedValueOnce({
      events: [],
      repairedEventIds: [],
      error: 'unloadable',
    });

    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <JobApprovalDialog
          room={room}
          job={makeJob()}
          viewThreadId={null}
          onClose={onClose}
          returnFocus={createRef<HTMLElement | null>()}
        />
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Some approval history could not be loaded.');
    expect(buttonByText('Retry history')).toBeTruthy();
    expect(buttonByText('Open thread')).toBeTruthy();

    // Retry triggers a fresh backfill.
    mocks.backfill.mockResolvedValueOnce({
      events: [],
      repairedEventIds: [],
      error: 'unloadable',
    });
    await act(async () => {
      buttonByText('Retry history')?.click();
    });
    expect(mocks.backfill).toHaveBeenCalledTimes(2);

    // Open thread navigates to the job's thread and closes the dialog.
    await act(async () => {
      buttonByText('Open thread')?.click();
    });
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith('!room:example.org', '$thread-1');
    expect(onClose).toHaveBeenCalledTimes(1);

    // Inside the same thread, Open thread is omitted.
    mocks.backfill.mockResolvedValueOnce({
      events: [],
      repairedEventIds: [],
      error: 'unloadable',
    });
    await act(async () => {
      root.render(
        <JobApprovalDialog
          key="in-thread"
          room={room}
          job={makeJob()}
          viewThreadId="$thread-1"
          onClose={vi.fn()}
          returnFocus={createRef<HTMLElement | null>()}
        />
      );
    });
    expect(buttonByText('Retry history')).toBeTruthy();
    expect(buttonByText('Open thread')).toBeUndefined();
  });

  it('shows the unavailable fallback with Open thread when no pending approval remains', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <JobApprovalDialog
          room={room}
          job={makeJob()}
          viewThreadId={null}
          onClose={onClose}
          returnFocus={createRef<HTMLElement | null>()}
        />
      );
    });

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'Some requests are no longer available.'
    );
    expect(buttonByText('Open thread')).toBeTruthy();
  });

  it('handles room-level (threadId: null) approvals from the live timeline and ignores non-agent senders', async () => {
    const forged = approvalEvent(
      '$forged',
      { thread_id: null, background_run_id: 'tool-job:job-room', tool_name: 'forged_tool' },
      '@mallory:example.org'
    );
    const roomApproval = approvalEvent('$room-appr', {
      thread_id: null,
      background_run_id: 'tool-job:job-room',
      tool_name: 'room_sample_tool',
    });
    await room.addLiveEvents([forged, roomApproval], { addToState: false });

    await act(async () => {
      root.render(
        <JobApprovalDialog
          room={room}
          job={makeJob({ jobId: 'job-room', toolCallId: undefined, threadId: null })}
          viewThreadId={null}
          onClose={vi.fn()}
          returnFocus={createRef<HTMLElement | null>()}
        />
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('room_sample_tool');
    expect(dialog?.textContent).not.toContain('forged_tool');

    await act(async () => {
      buttonByText('Approve')?.click();
    });
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
      expect.objectContaining({
        status: 'approved',
        'm.relates_to': expect.objectContaining({
          event_id: '$room-appr',
          'm.in_reply_to': { event_id: '$room-appr' },
        }),
      })
    );

    // Room edit arrives via subscribeRoomSignals; receipt stays visible inside the dialog.
    await room.addLiveEvents([editApproval(roomApproval, '$room-edit', 'approved')], {
      addToState: false,
    });
    await act(async () => {
      mocks.signals.forEach((listener) => listener());
    });
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Approved');
  });

  it('restores focus via fallbackFocus or focusConversation when the trigger disappears after approval', async () => {
    const matching = approvalEvent('$focus-appr', {
      background_run_id: 'tool-job:job-alpha',
    });
    mocks.backfill.mockResolvedValueOnce({ events: [matching], repairedEventIds: [] });

    const pill = document.createElement('button');
    const barToggle = document.createElement('button');
    const composer = document.createElement('input');
    document.body.append(pill, barToggle, composer);
    const returnFocus = { current: pill } as React.RefObject<HTMLElement | null>;
    const focusConversation = vi.fn(() => composer.focus());

    const Harness = ({ fallbackToBar }: { fallbackToBar: boolean }) => {
      const [open, setOpen] = React.useState(true);
      if (!open) return null;
      return (
        <JobApprovalDialog
          room={room}
          job={makeJob()}
          viewThreadId={null}
          onClose={() => setOpen(false)}
          returnFocus={returnFocus}
          focusConversation={focusConversation}
          fallbackFocus={
            fallbackToBar
              ? () => {
                  if (barToggle.isConnected) barToggle.focus();
                  else focusConversation();
                }
              : undefined
          }
        />
      );
    };

    try {
      await act(async () => {
        root.render(<Harness fallbackToBar />);
      });
      // Simulate the folded pill detaching after approval while the bar toggle remains connected.
      pill.remove();
      await act(async () => {
        buttonByText('Close')?.click();
      });
      await vi.waitFor(() => expect(document.activeElement).toBe(barToggle));
      expect(focusConversation).not.toHaveBeenCalled();

      // When the bar itself unmounts too, closing falls back to focusConversation.
      barToggle.remove();
      mocks.backfill.mockResolvedValueOnce({ events: [matching], repairedEventIds: [] });
      await act(async () => {
        root.render(<Harness key="bar-gone" fallbackToBar />);
      });
      await act(async () => {
        buttonByText('Close')?.click();
      });
      await vi.waitFor(() => expect(document.activeElement).toBe(composer));
      expect(focusConversation).toHaveBeenCalledTimes(1);
    } finally {
      pill.remove();
      barToggle.remove();
      composer.remove();
    }
  });
});
