import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavigateOptions } from 'react-router-dom';
import { getHomeRoomPath, withSearchParam } from '../pages/pathUtils';
import { useRoomNavigate } from './useRoomNavigate';
import type { ClientConfig } from './useClientConfig';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  roomToParentsAtom: Symbol('roomToParentsAtom'),
  mDirectAtom: Symbol('mDirectAtom'),
  settingsAtom: Symbol('settingsAtom'),
  roomToParents: new Map<string, string[]>(),
  mDirects: new Set<string>(),
  developerTools: false,
  selectedSpace: undefined as string | undefined,
  mx: {},
  historyState: { idx: 1 },
  replaceState: vi.fn(),
  clientConfig: {} as ClientConfig,
  location: { search: '', hash: '' },
}));

vi.stubGlobal('window', {
  history: {
    state: mocks.historyState,
    replaceState: mocks.replaceState,
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

vi.mock('./useClientConfig', () => ({
  useClientConfig: () => mocks.clientConfig,
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
    mocks.navigate.mockReset();
    mocks.replaceState.mockReset();
    mocks.roomToParents.clear();
    mocks.mDirects.clear();
    mocks.developerTools = false;
    mocks.selectedSpace = undefined;
    mocks.clientConfig = {};
    mocks.location.search = '';
    mocks.location.hash = '';
    delete (globalThis as any).__APP_BASE_PATH__;
  });

  it('pre-seeds the current history entry with the thread root before pushing the thread route', () => {
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const currentHistoryState = window.history.state;
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    const threadRootRoomPath = withSearchParam(getHomeRoomPath(roomId, threadId), {
      focusEvent: '1',
    });
    const threadEventRoomPath = getHomeRoomPath(roomId, eventId);

    expect(mocks.replaceState).toHaveBeenCalledTimes(1);
    expect(mocks.replaceState).toHaveBeenCalledWith(currentHistoryState, '', threadRootRoomPath);
    expect(mocks.navigate).toHaveBeenNthCalledWith(
      1,
      withSearchParam(threadEventRoomPath, { threadId }),
      undefined
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

    expect(mocks.replaceState).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId), { threadId }),
      opts
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

    expect(mocks.replaceState).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      undefined
    );

    renderer.unmount();
  });

  it('prepends hash fragment for replaceState URL in hash router mode', () => {
    mocks.clientConfig = { hashRouter: { enabled: true } };
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const currentHistoryState = window.history.state;
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    const threadRootRoomPath = withSearchParam(getHomeRoomPath(roomId, threadId), {
      focusEvent: '1',
    });
    expect(mocks.replaceState).toHaveBeenCalledWith(
      currentHistoryState,
      '',
      `#${threadRootRoomPath}`
    );

    renderer.unmount();
  });

  it('skips pre-seeding on thread-to-thread navigation', () => {
    mocks.location.search = '?threadId=$threadA';
    const roomId = '!room:example.org';
    const threadId = '$threadB';
    const eventId = '$reply';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    expect(mocks.replaceState).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { threadId }),
      undefined
    );

    renderer.unmount();
  });

  it('skips pre-seeding on thread-to-thread navigation in hash router mode', () => {
    mocks.clientConfig = { hashRouter: { enabled: true } };
    mocks.location.hash = '#/home/!room:example.org/$eventId?threadId=$threadA';
    const roomId = '!room:example.org';
    const threadId = '$threadB';
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId);
    });

    expect(mocks.replaceState).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('prepends app base path for replaceState URL in browser router mode', () => {
    (globalThis as any).__APP_BASE_PATH__ = '/mindroom';
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const currentHistoryState = window.history.state;
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    const threadRootRoomPath = withSearchParam(getHomeRoomPath(roomId, threadId), {
      focusEvent: '1',
    });
    expect(mocks.replaceState).toHaveBeenCalledWith(
      currentHistoryState,
      '',
      `/mindroom${threadRootRoomPath}`
    );

    renderer.unmount();
  });

  it('includes hash router basename in replaceState URL', () => {
    mocks.clientConfig = { hashRouter: { enabled: true, basename: '/app' } };
    const roomId = '!room:example.org';
    const threadId = '$thread';
    const eventId = '$reply';
    const currentHistoryState = window.history.state;
    const { getSnapshot, renderer } = renderHookHarness();

    act(() => {
      getSnapshot().navigateRoomThread(roomId, threadId, eventId);
    });

    const threadRootRoomPath = withSearchParam(getHomeRoomPath(roomId, threadId), {
      focusEvent: '1',
    });
    expect(mocks.replaceState).toHaveBeenCalledWith(
      currentHistoryState,
      '',
      `#/app${threadRootRoomPath}`
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

    expect(mocks.replaceState).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, eventId), { focusEvent: '1' }),
      opts
    );

    renderer.unmount();
  });
});
