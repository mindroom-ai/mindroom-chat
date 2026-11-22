// @vitest-environment jsdom
import type { ReactNode, RefObject } from 'react';
import { cleanup, render } from '@testing-library/react';
import { createClient, Room } from 'matrix-js-sdk';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationBehindPanelAtom,
  conversationCoveredAtom,
} from '../navigation/conversationCover';
import { RoomView } from './RoomView';
import type { RoomViewHeaderProps } from './RoomViewHeader';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');

const { capturedHeaderProps, threadRouteState, threadLayoutState, focusEditor, focusThreadColumn } =
  vi.hoisted(() => {
    const layoutState: { layout: 'full' | 'beside'; roomy: boolean } = {
      layout: 'full',
      roomy: false,
    };
    return {
      capturedHeaderProps: [] as RoomViewHeaderProps[],
      threadRouteState: { effectiveThreadId: undefined as string | undefined },
      threadLayoutState: layoutState,
      focusEditor: vi.fn(),
      focusThreadColumn: vi.fn(),
    };
  });

vi.mock('slate-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('slate-react')>()),
  ReactEditor: { focus: focusEditor },
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
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
  useThreadLayout: () => ({
    layout: threadLayoutState.layout,
    roomy: threadLayoutState.roomy,
    setLayout: vi.fn(),
  }),
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
  ThreadView: ({
    roomHeader,
    focusRef,
  }: {
    roomHeader?: (headerRef: RefObject<HTMLElement>) => ReactNode;
    focusRef?: { current?: () => void };
  }) => {
    if (focusRef) focusRef.current = focusThreadColumn;
    return roomHeader?.({ current: null }) ?? null;
  },
}));
vi.mock('../timeline/RoomTimeline', () => ({ RoomTimeline: () => null }));
vi.mock('../timeline/typing/RoomViewTyping', () => ({ RoomViewTyping: () => null }));
vi.mock('../timeline/RoomViewFollowing', () => ({ RoomViewFollowing: () => null }));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({ BackgroundJobsBar: () => null }));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../composer/RoomInput', () => ({ RoomInput: () => null }));

afterEach(() => {
  cleanup();
  capturedHeaderProps.length = 0;
  threadRouteState.effectiveThreadId = undefined;
  threadLayoutState.layout = 'full';
  threadLayoutState.roomy = false;
  focusEditor.mockClear();
  focusThreadColumn.mockClear();
  getDefaultStore().set(conversationCoveredAtom, false);
  getDefaultStore().set(conversationBehindPanelAtom, false);
});

describe('RoomView schedule wiring', () => {
  it('wires canEditSchedule and onFocusComposer for room view, plugin cover, and side panel', () => {
    render(<RoomView room={room} hasMindroomAgents />);
    const roomHeader = capturedHeaderProps.at(-1)!;
    expect(roomHeader.canEditSchedule).toBe(true);
    roomHeader.onFocusComposer?.(undefined);
    expect(focusEditor).toHaveBeenCalledTimes(1);

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

  it('wires canEditSchedule and onFocusComposer for full-width thread, forkAt, and behindPanel', () => {
    threadRouteState.effectiveThreadId = '$thread-1';
    render(<RoomView room={room} threadId="$thread-1" hasMindroomAgents />);
    const threadHeader = capturedHeaderProps.find((props) => props.threadId === '$thread-1')!;
    expect(threadHeader.canEditSchedule).toBe(true);
    threadHeader.onFocusComposer?.('$thread-1');
    expect(focusThreadColumn).toHaveBeenCalledTimes(1);

    cleanup();
    capturedHeaderProps.length = 0;
    render(<RoomView room={room} threadId="$thread-1" forkAt="$event-1" hasMindroomAgents />);
    expect(capturedHeaderProps.find((p) => p.threadId === '$thread-1')?.canEditSchedule).toBe(
      false
    );

    cleanup();
    capturedHeaderProps.length = 0;
    getDefaultStore().set(conversationBehindPanelAtom, true);
    render(<RoomView room={room} threadId="$thread-1" hasMindroomAgents />);
    expect(capturedHeaderProps.find((p) => p.threadId === '$thread-1')?.canEditSchedule).toBe(
      false
    );
  });

  it('keeps canEditSchedule enabled on the room header in side-by-side layout even with forkAt', () => {
    const prevResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    try {
      threadRouteState.effectiveThreadId = '$thread-1';
      threadLayoutState.layout = 'beside';
      threadLayoutState.roomy = true;
      render(<RoomView room={room} threadId="$thread-1" forkAt="$event-1" hasMindroomAgents />);
      const roomHeader = capturedHeaderProps.find((props) => props.threadId === undefined);
      expect(roomHeader?.openThreadId).toBe('$thread-1');
      expect(roomHeader?.canEditSchedule).toBe(true);
    } finally {
      globalThis.ResizeObserver = prevResizeObserver;
    }
  });
});
