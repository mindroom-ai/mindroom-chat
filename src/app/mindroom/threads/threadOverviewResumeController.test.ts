import React, { type MutableRefObject } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAndPersistThreadContent } from './threadContentPrefetch';
import { loadRoomThreads } from './roomThreadList';
import { useThreadOverviewResumeController } from './threadOverviewResumeController';

const resumeState = vi.hoisted(() => ({
  callback: undefined as
    | ((reason: 'focus' | 'online' | 'pageshow' | 'visibility') => void)
    | undefined,
}));

vi.mock('./usePageResume', () => ({
  usePageResume: (callback: (reason: 'focus' | 'online' | 'pageshow' | 'visibility') => void) => {
    resumeState.callback = callback;
  },
}));

vi.mock('./roomThreadList', async (importOriginal) => {
  const original = await importOriginal<typeof import('./roomThreadList')>();
  return {
    ...original,
    loadRoomThreads: vi.fn(),
  };
});

vi.mock('./threadContentPrefetch', () => ({
  fetchAndPersistThreadContent: vi.fn(async () => undefined),
}));

vi.mock('./threadOverviewRefreshTargets', () => ({
  resolveThreadOverviewRefreshTargets: () => ({
    overviewResumeRefreshIds: ['$thread-root'],
    visibleThreadSummaryRefreshIds: ['$thread-root'],
  }),
}));

vi.mock('./timelineDebug', () => ({
  logTimelineDebug: vi.fn(),
}));

vi.mock('../engine', () => ({
  useMindroomSyncEngine: () => ({ scheduler: {} }),
}));

const mockedFetchAndPersistThreadContent = vi.mocked(fetchAndPersistThreadContent);
const mockedLoadRoomThreads = vi.mocked(loadRoomThreads);

type HarnessProps = {
  onApplyThreadRelations: ReturnType<typeof vi.fn>;
  room: Room;
  setOverviewRefreshCounter: ReturnType<typeof vi.fn>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
};

function Harness({
  onApplyThreadRelations,
  room,
  setOverviewRefreshCounter,
  threadId,
  threadIdRef,
}: HarnessProps) {
  useThreadOverviewResumeController({
    activeTimelineRange: { start: 0, end: 1 },
    alive: () => true,
    compactFilteredThreadRootIds: [],
    compactViewRequested: false,
    debugTraceId: 'resume-test',
    filteredThreadRootIds: ['$thread-root'],
    limit: 20,
    mx: {} as never,
    onApplyThreadRelations,
    onStoreThreadSummary: vi.fn(),
    persistThreadEventCache: vi.fn(),
    refreshCompactThreadList: vi.fn(async () => undefined),
    room,
    setOverviewRefreshCounter,
    showCompactRoomView: false,
    threadFilteredEventEntries: [],
    threadId,
    threadIdRef,
    threadReplyCountMap: new Map(),
    threadResolutionMap: new Map(),
  });
  return null;
}

afterEach(() => {
  resumeState.callback = undefined;
  vi.clearAllMocks();
});

describe('useThreadOverviewResumeController', () => {
  it('abandons a pending general-overview list load when a thread opens', async () => {
    let finishListLoad: (() => void) | undefined;
    let listLoadSignal: AbortSignal | undefined;
    mockedLoadRoomThreads.mockImplementation((_room, _onProgress, signal) => {
      listLoadSignal = signal;
      return new Promise<void>((resolve) => {
        finishListLoad = resolve;
      });
    });

    const room = { roomId: '!room:example.org' } as Room;
    const threadIdRef = { current: undefined } as MutableRefObject<string | undefined>;
    const onApplyThreadRelations = vi.fn();
    const setOverviewRefreshCounter = vi.fn();
    let renderer!: ReactTestRenderer;
    const render = (threadId: string | undefined) =>
      React.createElement(Harness, {
        onApplyThreadRelations,
        room,
        setOverviewRefreshCounter,
        threadId,
        threadIdRef,
      });

    await act(async () => {
      renderer = create(render(undefined));
    });

    await act(async () => {
      resumeState.callback?.('focus');
      await Promise.resolve();
    });
    expect(mockedLoadRoomThreads).toHaveBeenCalledOnce();
    expect(listLoadSignal).toBeDefined();
    expect(listLoadSignal?.aborted).toBe(false);

    threadIdRef.current = '$thread-root';
    await act(async () => {
      renderer.update(render('$thread-root'));
    });
    expect(listLoadSignal?.aborted).toBe(true);

    await act(async () => {
      finishListLoad?.();
      await Promise.resolve();
    });

    expect(mockedFetchAndPersistThreadContent).not.toHaveBeenCalled();
    expect(onApplyThreadRelations).not.toHaveBeenCalled();
    expect(setOverviewRefreshCounter).not.toHaveBeenCalled();

    renderer.unmount();
  });
});
