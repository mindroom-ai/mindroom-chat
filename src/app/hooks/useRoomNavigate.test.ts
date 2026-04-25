import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavigateOptions } from 'react-router-dom';
import { getHomeRoomPath, withSearchParam } from '../pages/pathUtils';
import { useRoomNavigate } from './useRoomNavigate';
import { ROOM_THREAD_EXIT_TARGET_STATE_KEY } from './roomNavigateState';

const mocks = vi.hoisted(() => ({
  isNativeIOS: vi.fn(() => false),
  navigate: vi.fn(),
  roomToParentsAtom: Symbol('roomToParentsAtom'),
  mDirectAtom: Symbol('mDirectAtom'),
  settingsAtom: Symbol('settingsAtom'),
  roomToParents: new Map<string, string[]>(),
  mDirects: new Set<string>(),
  developerTools: false,
  selectedSpace: undefined as string | undefined,
  mx: {},
  historyState: { idx: 1, key: 'room-entry' },
  location: { pathname: '/home/!room:example.org', search: '', hash: '' },
}));

vi.stubGlobal('window', {
  history: {
    state: mocks.historyState,
  },
  location: mocks.location,
} as unknown as Window & typeof globalThis);

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();

  return {
    ...actual,
    useAtomValue: (atom: unknown) => {
      if (atom === mocks.roomToParentsAtom) return mocks.roomToParents;
      if (atom === mocks.mDirectAtom) return mocks.mDirects;
      throw new Error('Unexpected atom');
    },
  };
});

vi.mock('./useMatrixClient', () => ({
  useMatrixClient: () => mocks.mx,
}));

vi.mock('./router/useSelectedSpace', () => ({
  useSelectedSpace: () => mocks.selectedSpace,
}));

vi.mock('../state/settings', () => ({
  settingsAtom: mocks.settingsAtom,
}));

vi.mock('../state/hooks/settings', () => ({
  useSetting: () => [mocks.developerTools],
}));

vi.mock('../state/room/roomToParents', () => ({
  roomToParentsAtom: mocks.roomToParentsAtom,
}));

vi.mock('../state/mDirectList', () => ({
  mDirectAtom: mocks.mDirectAtom,
}));

vi.mock('../utils/matrix', () => ({
  getCanonicalAliasOrRoomId: (_mx: unknown, roomId: string) => roomId,
}));

vi.mock('../utils/room', () => ({
  getOrphanParents: () => [],
  guessPerfectParent: () => undefined,
}));

vi.mock('../mindroom/native/nativeSso', () => ({
  isNativeIOS: mocks.isNativeIOS,
}));

type HarnessProps = {
  onRender: (value: ReturnType<typeof useRoomNavigate>) => void;
};

function Harness({ onRender }: HarnessProps) {
  onRender(useRoomNavigate());
  return null;
}

const renderHookHarness = (): {
  getSnapshot: () => ReturnType<typeof useRoomNavigate>;
  renderer: ReactTestRenderer;
} => {
  let latestValue: ReturnType<typeof useRoomNavigate> | undefined;
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(
      React.createElement(Harness, {
        onRender: (value) => {
          latestValue = value;
        },
      })
    );
  });

  return {
    getSnapshot: () => {
      if (!latestValue) {
        throw new Error('Hook snapshot was not captured');
      }

      return latestValue;
    },
    renderer: renderer as ReactTestRenderer,
  };
};

describe('useRoomNavigate', () => {
  afterEach(() => {
    mocks.isNativeIOS.mockReset();
    mocks.isNativeIOS.mockReturnValue(false);
    mocks.navigate.mockReset();
    mocks.roomToParents.clear();
    mocks.mDirects.clear();
    mocks.developerTools = false;
    mocks.selectedSpace = undefined;
    mocks.historyState = { idx: 1, key: 'room-entry' };
    window.history.state = mocks.historyState;
    mocks.location.pathname = '/home/!room:example.org';
    mocks.location.search = '';
    mocks.location.hash = '';
  });

  it('marks pushed thread opens for history back without rewriting the current entry', () => {
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    const threadEventRoomPath = getHomeRoomPath(roomId, eventId);

    expect(mocks.navigate).toHaveBeenNthCalledWith(
      1,
      withSearchParam(threadEventRoomPath, { threadId }),
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId,
            threadId,
            useHistoryBack: true,
          },
        },
      }
    );

    renderer.unmount();
  });

  it('skips pre-seeding when thread navigation already replaces the current history entry', () => {
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const opts: NavigateOptions = { replace: true };
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, undefined, opts);
    });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId), { threadId }),
      opts
    );

    renderer.unmount();
  });

  it('preserves existing navigate state when marking a thread exit target', () => {
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const opts: NavigateOptions = {
      state: {
        source: 'test-suite',
      },
    };
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId, opts);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      {
        state: {
          source: 'test-suite',
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId,
            threadId,
            useHistoryBack: true,
          },
        },
      }
    );

    renderer.unmount();
  });

  it('can navigate directly to a thread route without pre-seeding the current history entry', () => {
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThreadDirect(roomId, threadId, eventId);
    });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      undefined
    );

    renderer.unmount();
  });

  it('still marks thread-to-thread navigation for history back', () => {
    mocks.location.search = '?threadId=$threadA';
    const roomId = '!room:example.org';
    const threadId = '$threadB';
    const eventId = '$reply';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org?threadId=$threadA',
            roomId,
            threadId,
            useHistoryBack: true,
          },
        },
      }
    );

    renderer.unmount();
  });

  it('marks native iOS thread exits with the exact previous path instead of history back', () => {
    mocks.isNativeIOS.mockReturnValue(true);
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      {
        state: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath: '/home/!room:example.org',
            roomId,
            threadId,
            useHistoryBack: false,
          },
        },
      }
    );

    renderer.unmount();
  });

  it('navigates to a focused room event without reopening the thread', () => {
    const roomId = '!room:example.org';
    const eventId = '$thread';
    const opts: NavigateOptions = { replace: true };
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomFocusEvent(roomId, eventId, opts);
    });

    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { focusEvent: '1' }),
      opts
    );

    renderer.unmount();
  });
});
