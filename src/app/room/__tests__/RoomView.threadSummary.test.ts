import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearThreadSummarySharedState } from '../../event-store/threads/threadSummaryState';
import type { ThreadContextBannerProps } from '../../threads/ThreadContextBanner';
import type { RoomTimelineProps } from '../../timeline/RoomTimeline';
import { RoomView } from '../RoomView';

const {
  passthrough,
  threadContextBannerState,
  roomTimelineState,
  loadCachedThreadSummariesMock,
  saveCachedThreadSummaryMock,
} = vi.hoisted(() => ({
  passthrough: 'div',
  threadContextBannerState: {
    props: undefined as ThreadContextBannerProps | undefined,
  },
  roomTimelineState: {
    props: undefined as RoomTimelineProps | undefined,
  },
  loadCachedThreadSummariesMock: vi.fn(async () => new Map()),
  saveCachedThreadSummaryMock: vi.fn(async () => undefined),
}));

const storageState = new Map<string, string>();

vi.stubGlobal('localStorage', {
  get length() {
    return storageState.size;
  },
  clear: () => {
    storageState.clear();
  },
  getItem: (key: string) => storageState.get(key) ?? null,
  key: (index: number) => Array.from(storageState.keys())[index] ?? null,
  setItem: (key: string, value: string) => {
    storageState.set(key, value);
  },
  removeItem: (key: string) => {
    storageState.delete(key);
  },
});

vi.stubGlobal('window', {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
  navigator: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
});

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Box: passthrough,
    Chip: passthrough,
    Text: passthrough,
  };
});

vi.mock('slate-react', () => ({
  ReactEditor: {
    focus: vi.fn(),
  },
}));

vi.mock('../../matrix/hooks/useStateEvent', () => ({
  useStateEvent: () => undefined,
}));

vi.mock('../../matrix/hooks/usePowerLevels', () => {
  // The thread column's view reads the room's levels itself, the same ones every render.
  const levels = {};
  return {
    usePowerLevelsContext: () => ({}),
    usePowerLevels: () => levels,
    PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

// The thread column's view lists the room's members, of a client this test makes anew each render.
vi.mock('../../matrix/hooks/useRoomMembers', () => {
  const members: never[] = [];
  return { useRoomMembers: () => members };
});

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRooms: () => [],
    getHomeserverUrl: () => 'https://mindroom.chat',
    getSafeUserId: () => '@alice:example.org',
    getRoom: () => null,
    on: () => undefined,
    removeListener: () => undefined,
  }),
}));

vi.mock('../../editor/Editor', () => ({
  useEditor: () => ({}),
}));

vi.mock('../../timeline/RoomTimeline', () => ({
  RoomTimeline: (props: RoomTimelineProps) => {
    const { threadHeader } = props;
    roomTimelineState.props = props;
    return React.createElement('div', null, threadHeader);
  },
}));

vi.mock('../../timeline/typing/RoomViewTyping', () => ({
  RoomViewTyping: passthrough,
}));

vi.mock('../RoomTombstone', () => ({
  RoomTombstone: passthrough,
}));

vi.mock('../../composer/RoomInput', () => ({
  RoomInput: passthrough,
}));

vi.mock('../../timeline/RoomViewFollowing', () => ({
  RoomViewFollowing: passthrough,
}));

vi.mock('../../ui/page/Page', () => ({
  Page: passthrough,
}));

vi.mock('../RoomViewHeader', () => ({
  RoomViewHeader: passthrough,
}));

vi.mock('../../threads/ThreadContextBanner', () => ({
  ThreadContextBanner: (props: ThreadContextBannerProps) => {
    threadContextBannerState.props = props;
    return React.createElement('div');
  },
}));

vi.mock('../../lib/hooks/useKeyDown', () => ({
  useKeyDown: vi.fn(),
}));

vi.mock('../../lib/dom', () => ({
  editableActiveElement: () => false,
}));

vi.mock('../../preferences/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../preferences/useSetting', () => ({
  useSetting: () => [false],
}));

vi.mock('../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    event: () => true,
  }),
}));

vi.mock('../../matrix/hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoomFocusEvent: vi.fn(),
  }),
}));

vi.mock('../../navigation/useEdgeSwipeBack', () => ({
  useEdgeSwipeBack: vi.fn(),
}));

vi.mock('../../threads/useThreadRootEvent', () => ({
  useThreadRootEvent: (_room: unknown, threadId: string | undefined) => threadId,
}));

vi.mock('../../event-store/cache/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../event-store/cache/db')>();
  return {
    ...actual,
    loadCachedThreadSummaries: loadCachedThreadSummariesMock,
    saveCachedThreadSummary: saveCachedThreadSummaryMock,
  };
});

const flushAsyncWork = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
};

describe('RoomView thread summary sharing', () => {
  beforeEach(() => {
    clearThreadSummarySharedState();
    storageState.clear();
    threadContextBannerState.props = undefined;
    roomTimelineState.props = undefined;
    loadCachedThreadSummariesMock.mockReset();
    saveCachedThreadSummaryMock.mockReset();
    loadCachedThreadSummariesMock.mockResolvedValue(
      new Map([
        [
          '$thread-root',
          {
            summaryText: 'Cached summary',
            generatedTs: 1,
            messageCount: 10,
          },
        ],
      ])
    );
    saveCachedThreadSummaryMock.mockResolvedValue(undefined);
  });

  it('shows cached summary first and upgrades banner and room state when a newer live summary arrives', async () => {
    const room = {
      roomId: '!room:example.org',
      getThread: () => undefined,
      findEventById: () => undefined,
    };
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(RoomView, {
          room: room as never,
          hasMindroomAgents: false,
          threadId: '$thread-root',
        })
      );
      await flushAsyncWork();
    });

    expect(loadCachedThreadSummariesMock).toHaveBeenCalledWith(
      'https%3A%2F%2Fmindroom.chat::%40alice%3Aexample.org',
      '!room:example.org'
    );
    expect(roomTimelineState.props?.hasMindroomAgents).toBe(false);
    expect(threadContextBannerState.props?.summaryInfo?.summaryText).toBe('Cached summary');
    expect(roomTimelineState.props?.summaryMap.get('$thread-root')?.summaryText).toBe(
      'Cached summary'
    );

    await act(async () => {
      roomTimelineState.props?.onStoreThreadSummary('$thread-root', {
        summaryText: 'Live summary',
        generatedTs: 2,
        messageCount: 12,
      });
      await flushAsyncWork();
    });

    expect(threadContextBannerState.props?.summaryInfo?.summaryText).toBe('Live summary');
    expect(roomTimelineState.props?.summaryMap.get('$thread-root')?.summaryText).toBe(
      'Live summary'
    );
    expect(saveCachedThreadSummaryMock).toHaveBeenCalledWith(
      'https%3A%2F%2Fmindroom.chat::%40alice%3Aexample.org',
      '!room:example.org',
      '$thread-root',
      expect.objectContaining({
        summaryText: 'Live summary',
        generatedTs: 2,
        messageCount: 12,
      })
    );

    renderer?.unmount();
  });
});

vi.mock('../../approvals/ThreadApprovalControls', () => ({ ThreadApprovalQueue: () => null }));
vi.mock('../../background-jobs/BackgroundJobsBar', () => ({ BackgroundJobsBar: () => null }));
vi.mock('../../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: 'thread-approval-provider',
}));

vi.mock('../../event-store/engine/engineContext', () => ({
  useSyncEngine: () => ({
    noteRoomFocused: () => undefined,
    clearRoomFocus: () => undefined,
  }),
}));
