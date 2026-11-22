// @vitest-environment jsdom
import type { ReactNode, RefObject } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { createClient, Room } from 'matrix-js-sdk';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import {
  conversationBehindPanelAtom,
  conversationCoveredAtom,
} from '../navigation/conversationCover';
import { RoomView } from './RoomView';
import type { RoomViewHeaderProps } from './RoomViewHeader';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');

const { capturedHeaderProps, threadRouteState, sendMessage } = vi.hoisted(() => ({
  capturedHeaderProps: [] as RoomViewHeaderProps[],
  threadRouteState: { effectiveThreadId: undefined as string | undefined },
  sendMessage: vi.fn(async () => ({ event_id: '$sent' })),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => Object.assign(mx, { sendMessage, makeTxnId: () => 'txn-room-1' }),
}));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => true }),
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../event-store/engine/engineContext', () => ({
  useSyncEngine: () => ({ noteRoomFocused: () => undefined, clearRoomFocus: () => undefined }),
}));
vi.mock('./threadLayout', () => ({
  THREAD_COLUMN_WIDTH_KEY: 'thread-col-width',
  useThreadLayout: () => ({ layout: 'full', roomy: false, setLayout: vi.fn() }),
}));
vi.mock('./useRoomViewThreadState', () => ({
  useRoomViewThreadState: () => ({
    effectiveThreadId: threadRouteState.effectiveThreadId,
    viewMode: 'compact',
    threadNotFound: false,
    handleExitThread: () => undefined,
    handleThreadRootDeleted: () => undefined,
    storeThreadSummary: () => undefined,
    summaryMap: new Map(),
    threadSortFreezeState: null,
  }),
}));
vi.mock('./RoomViewHeader', () => ({
  RoomViewHeader: (props: RoomViewHeaderProps) => {
    capturedHeaderProps.push(props);
    return null;
  },
}));
vi.mock('./ThreadView', () => ({
  ThreadView: ({ roomHeader }: { roomHeader?: (headerRef: RefObject<HTMLElement>) => ReactNode }) =>
    roomHeader?.({ current: null }) ?? null,
}));
vi.mock('../timeline/RoomTimeline', () => ({ RoomTimeline: () => null }));
vi.mock('../timeline/typing/RoomViewTyping', () => ({ RoomViewTyping: () => null }));
vi.mock('../timeline/RoomViewFollowing', () => ({ RoomViewFollowing: () => null }));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({ BackgroundJobsBar: () => null }));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../composer/RoomInput', () => ({ RoomInput: () => null }));

const makeTask = (overrides: Partial<ParsedScheduledTask> = {}): ParsedScheduledTask => ({
  taskId: 'layout-task-1',
  status: 'pending',
  threadId: null,
  newThread: false,
  executeAt: null,
  scheduleType: 'once',
  ...overrides,
});

afterEach(() => {
  cleanup();
  capturedHeaderProps.length = 0;
  threadRouteState.effectiveThreadId = undefined;
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ event_id: '$sent' });
  getDefaultStore().set(conversationCoveredAtom, false);
  getDefaultStore().set(conversationBehindPanelAtom, false);
});

describe('RoomView schedule wiring', () => {
  it('enables canEditSchedule when the room composer is visible and disables it under a plugin cover or side panel', () => {
    render(<RoomView room={room} hasMindroomAgents />);
    expect(capturedHeaderProps.at(-1)?.canEditSchedule).toBe(true);

    cleanup();
    capturedHeaderProps.length = 0;
    getDefaultStore().set(conversationCoveredAtom, true);
    render(<RoomView room={room} hasMindroomAgents />);
    expect(capturedHeaderProps.at(-1)?.canEditSchedule).toBe(false);

    cleanup();
    capturedHeaderProps.length = 0;
    getDefaultStore().set(conversationCoveredAtom, false);
    getDefaultStore().set(conversationBehindPanelAtom, true);
    render(<RoomView room={room} hasMindroomAgents />);
    expect(capturedHeaderProps.at(-1)?.canEditSchedule).toBe(false);
  });

  it('preserves in-flight schedule cancel state across switching from the room header to a full-width thread header', async () => {
    let resolveSend!: () => void;
    sendMessage.mockImplementationOnce(
      () =>
        new Promise<{ event_id: string }>((resolve) => {
          resolveSend = () => resolve({ event_id: '$cancelled' });
        })
    );

    const { rerender } = render(<RoomView room={room} hasMindroomAgents />);
    const roomHeaderProps = capturedHeaderProps.at(-1)!;
    expect(roomHeaderProps.threadId).toBeUndefined();

    const target = makeTask();
    let cancelPromise!: Promise<boolean>;
    act(() => {
      cancelPromise = roomHeaderProps.scheduleCancelState!.handleCancelTask(target);
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    // Switch into a full-width thread column whose own RoomViewHeader takes over.
    capturedHeaderProps.length = 0;
    threadRouteState.effectiveThreadId = '$thread-1';
    rerender(<RoomView room={room} threadId="$thread-1" hasMindroomAgents />);

    const threadHeaderProps = capturedHeaderProps.find((props) => props.threadId === '$thread-1');
    expect(threadHeaderProps).toBeDefined();
    expect(threadHeaderProps?.scheduleCancelState?.pendingCancelIds.has('layout-task-1')).toBe(
      true
    );

    // Duplicate cancel from the thread header is blocked while the room-level send is still in flight.
    let duplicate = true;
    await act(async () => {
      duplicate = await threadHeaderProps!.scheduleCancelState!.handleCancelTask(target);
    });
    expect(duplicate).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend();
      await cancelPromise;
    });
    const settledThreadHeaderProps = capturedHeaderProps
      .filter((props) => props.threadId === '$thread-1')
      .at(-1);
    expect(
      settledThreadHeaderProps?.scheduleCancelState?.pendingCancelIds.has('layout-task-1')
    ).toBe(false);
    expect(settledThreadHeaderProps?.scheduleCancelState?.cancelSentIds.has('layout-task-1')).toBe(
      true
    );
  });
});
