// @vitest-environment jsdom
import React, { useContext } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import type { ClientConfig } from '../config/useClientConfig';
import { callPanelRoomAtom } from '../calls/callStore';
import { openTranscriptPanel } from '../calls/transcription/transcriptPanel';
import { getCallWindowSettingsAtom } from '../calls/window/callWindowState';
import { subagentsPanelAtom } from '../navigation/subagentsPanel';
import { RoomPanelEdgeSwipeContext } from '../navigation/roomPanelEdgeSwipeContext';
import { SWIPE_PRIORITY } from '../navigation/interactiveSwipe';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import type { RoomViewHeaderProps } from './RoomViewHeader';
import { Room } from './Room';

const ALICE = '@alice:example.org';
const ROOM_ID = '!room:example.org';

const { state, mx, room, innerBackSpy } = vi.hoisted(() => {
  const members = [
    { userId: '@alice:example.org', name: 'Alice', membership: 'join', powerLevel: 100 },
    {
      userId: '@mindroom_assistant:example.org',
      name: 'Assistant',
      membership: 'join',
      powerLevel: 50,
    },
  ];
  return {
    innerBackSpy: vi.fn(),
    state: {
      members,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed for mock type
      config: {} as ClientConfig,
      servers: [] as never[],
      view: undefined as RoomViewHeaderProps | undefined,
      inCall: false,
      subagentsDetailOpen: false,
      subagentsSawRoomContext: false,
    },
    mx: {
      getSafeUserId: () => '@alice:example.org',
      getRoom: () => null,
      isInitialSyncComplete: () => true,
      getSyncState: () => 'SYNCING',
      on: () => undefined,
      removeListener: () => undefined,
    },
    room: {
      roomId: '!room:example.org',
      name: 'Planning Room',
      getMember: (userId: string) => members.find((member) => member.userId === userId),
      getThread: () => undefined,
      findEventById: (eventId: string) =>
        eventId === '$thread' ? { getId: () => '$thread', isSending: () => false } : undefined,
      on: () => undefined,
      removeListener: () => undefined,
    },
  };
});

vi.mock('../navigation/useRoomRouteParams', () => ({ useRoomRouteParams: () => ({}) }));
vi.mock('react-router-dom', () => ({
  NavigationType: { Push: 'PUSH' },
  useNavigationType: () => 'POP',
  useLocation: () => ({}),
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams('threadId=%24thread')],
}));
vi.mock('./RoomView', () => ({
  RoomView: (props: RoomViewHeaderProps) => {
    state.view = props;
    return <div data-testid="room-view">Conversation</div>;
  },
}));
vi.mock('../members/MembersDrawer', () => ({ MembersDrawer: () => <aside /> }));
vi.mock('../members/useMembersDrawer', async () => {
  const { atom, useAtom } = await vi.importActual<typeof import('jotai')>('jotai');
  const membersOpenAtom = atom(false);
  return { membersOpenAtom, useMembersDrawer: () => useAtom(membersOpenAtom) };
});
vi.mock('../computer/ComputerPanel', () => ({
  ComputerPanel: () => <div data-testid="computer-panel">Computer</div>,
}));
vi.mock('../canvas/RoomCanvasPanel', () => ({
  RoomCanvasPanel: () => <div data-testid="room-canvas-panel">Canvas</div>,
}));
vi.mock('../calls/CallPanel', () => ({
  CallPanel: () => <div data-testid="call-panel">Call</div>,
}));
vi.mock('../calls/transcription/LiveTranscriptPanel', () => ({
  LiveTranscriptPanel: () => <div data-testid="transcript-panel">Transcript</div>,
}));
vi.mock('../calls/callStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../calls/callStore')>();
  return {
    ...actual,
    useInCall: () => state.inCall,
  };
});
vi.mock('../subagents/SubagentsPanel', () => ({
  SubagentsPanel: ({ onClose }: { onClose: () => void }) => {
    const handledByRoom = useContext(RoomPanelEdgeSwipeContext);
    state.subagentsSawRoomContext = handledByRoom;
    useEdgeSwipeBack(innerBackSpy, state.subagentsDetailOpen, {
      priority: SWIPE_PRIORITY.PANEL_INNER,
    });
    return (
      <div data-testid="subagents-panel">
        <button type="button" onClick={onClose}>
          Close subagents
        </button>
      </div>
    );
  },
}));
vi.mock('../canvas/canvasIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../canvas/canvasIndex')>()),
  useConversationCanvases: () => [
    {
      event: {
        getId: () => '$canvas-1',
        getContent: () => ({}),
        getSender: () => '@mindroom_assistant:example.org',
      },
      title: 'Chart',
      eventId: '$canvas-1',
    },
  ],
  useComputerShown: () => false,
}));
vi.mock('../matrix/hooks/useRoom', () => ({ useRoom: () => room }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  usePowerLevels: () => ({}),
}));
vi.mock('../config/useClientConfig', () => ({
  useClientConfig: () => state.config,
  useOptionalClientConfig: () => state.config,
}));
vi.mock('../computer/useAgentServers', () => ({
  useRoomAgentServers: () => state.servers,
  useBindsOpenIdTokens: () => false,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'threaded', setViewMode: () => undefined }),
}));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: () => undefined, navigateRoomThread: () => undefined }),
}));
vi.mock('../navigation/recentRooms', () => ({ bumpRecentRoom: vi.fn() }));
vi.mock('../plugins/pluginEntries', () => ({
  pluginEntries: [
    {
      id: 'notes',
      version: '1.0.0',
      plugin: {
        sidePanels: [
          {
            id: 'panel',
            label: 'Notes',
            Component: () => <div data-testid="notes-panel">Notes</div>,
          },
        ],
      },
    },
  ],
}));

const createTouchEvent = (
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  points: Array<{ clientX: number; clientY: number; identifier?: number }>,
  timeStamp: number
): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = points.map((p, i) => ({
    identifier: p.identifier ?? i,
    clientX: p.clientX,
    clientY: p.clientY,
  }));
  Object.defineProperty(event, 'touches', { value: list });
  Object.defineProperty(event, 'changedTouches', { value: list });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  return event;
};

const dispatchEdgeTouch = (
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  points: Array<{ clientX: number; clientY: number }>,
  timeStamp: number
) => {
  window.dispatchEvent(createTouchEvent(type, points, timeStamp));
};

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const mockWidth = (element: HTMLElement, width: number) => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 700,
    top: 0,
    left: 0,
    right: width,
    bottom: 700,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
};

describe('Room covering side panel interactive swipes on phones', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
    store = createStore();
    state.view = undefined;
    state.inCall = false;
    state.subagentsDetailOpen = false;
    state.subagentsSawRoomContext = false;
    innerBackSpy.mockReset();
    state.config = {
      mindroom: {
        computers: { apiUrl: 'https://computer.example.org' },
        uiActions: { autoOpenFromHomeservers: ['example.org'] },
        canvas: { enabled: true },
      },
    };
    store.set(getCallWindowSettingsAtom(ALICE), { mode: 'docked' });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.documentElement.dir = '';
  });

  const renderPhoneRoom = () =>
    render(
      <Provider store={store}>
        <ScreenSizeProvider value={ScreenSize.Mobile}>
          <Room />
        </ScreenSizeProvider>
      </Provider>
    );

  const getConversation = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-conversation-behind-panel]')!;

  const getHost = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-phone-side-panel-host]');

  it('never renders a blanket edge-catcher overlay over covering panels (including computer and canvas)', async () => {
    const { container } = renderPhoneRoom();

    // Plugin panel: no edge catcher.
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    expect(getHost(container)).not.toBeNull();
    expect(container.querySelector('[data-swipe-edge-catcher]')).toBeNull();

    // Computer panel: no edge catcher blocking taps or touches over noVNC canvas.
    await act(async () => state.view?.onComputerToggle?.());
    expect(getHost(container)).not.toBeNull();
    expect(container.querySelector('[data-swipe-edge-catcher]')).toBeNull();

    // Canvas panel: no edge catcher blocking taps or vertical scrolls over canvas controls.
    await act(async () => state.view?.onCanvasOpen?.('$canvas-1'));
    expect(getHost(container)).not.toBeNull();
    expect(container.querySelector('[data-swipe-edge-catcher]')).toBeNull();

    // Subagents panel: no edge catcher.
    await act(async () => store.set(subagentsPanelAtom, { roomId: ROOM_ID }));
    expect(getHost(container)).not.toBeNull();
    expect(container.querySelector('[data-swipe-edge-catcher]')).toBeNull();
  });

  it('tracks drag over mounted conversation and restores cleanly on cancel', async () => {
    const { container } = renderPhoneRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));

    const host = getHost(container)!;
    const conversation = getConversation(container);
    mockWidth(host, 400);

    expect(conversation.dataset.conversationBehindPanel).toBe('true');

    // Start in edge band (x = 12), lock at x = 22 (slop = 10), drag to x = 102 (offset = 80, progress = 0.2).
    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 12, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 102, clientY: 200 }], 400);
      vi.advanceTimersToNextFrame();
    });

    expect(host.hasAttribute('data-swiping')).toBe(true);
    expect(host.hasAttribute('data-swipe-shadow')).toBe(true);
    expect(host.style.translate).toBe('80px');
    expect(conversation.hasAttribute('data-swipe-under-panel')).toBe(true);
    expect(conversation.hasAttribute('data-swiping')).toBe(true);
    expect(conversation.dataset.conversationBehindPanel).toBe('true');
    expect(conversation.inert).toBe(true);
    expect(conversation.style.translate).toBe('-96px');
    const stage = container.querySelector<HTMLElement>('[data-panel-row]')!;
    expect(container.querySelector('[data-swipe-panel-dim]')).not.toBeNull();
    expect(stage.hasAttribute('data-swipe-panel-stage')).toBe(true);

    // Hold briefly past the 100 ms velocity window and release below 35% -> cancel.
    act(() => {
      dispatchEdgeTouch('touchend', [], 550);
    });
    await flushMicrotasks();

    expect(getHost(container)).not.toBeNull();
    expect(conversation.dataset.conversationBehindPanel).toBe('true');
    expect(host.hasAttribute('data-swiping')).toBe(false);
    expect(host.hasAttribute('data-swipe-shadow')).toBe(false);
    expect(host.style.translate).toBe('');
    expect(conversation.hasAttribute('data-swipe-under-panel')).toBe(false);
    expect(conversation.hasAttribute('data-swiping')).toBe(false);
    expect(conversation.style.translate).toBe('');
    expect(container.querySelector('[data-swipe-panel-dim]')).toBeNull();
    expect(stage.hasAttribute('data-swipe-panel-stage')).toBe(false);
  });

  it('commits drag past threshold, closes panel, and cleans up styles', async () => {
    const { container } = renderPhoneRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));

    const host = getHost(container)!;
    const conversation = getConversation(container);
    mockWidth(host, 400);

    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 220, clientY: 200 }], 250);
      vi.advanceTimersToNextFrame();
    });
    expect(host.style.translate).toBe('200px');

    act(() => {
      dispatchEdgeTouch('touchend', [], 270);
    });
    await flushMicrotasks();

    expect(getHost(container)).toBeNull();
    expect(conversation.dataset.conversationBehindPanel).toBe('false');
    expect(conversation.hasAttribute('data-swipe-under-panel')).toBe(false);
    expect(conversation.style.translate).toBe('');
    expect(container.querySelector('[data-swipe-panel-dim]')).toBeNull();
    expect(
      container.querySelector('[data-panel-row]')?.hasAttribute('data-swipe-panel-stage')
    ).toBe(false);
  });

  it('does not close a different panel that replaced the dragged panel mid-drag', async () => {
    const { container } = renderPhoneRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));

    const host = getHost(container)!;
    mockWidth(host, 400);

    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 220, clientY: 200 }], 250);
      vi.advanceTimersToNextFrame();
    });

    // Another panel takes over mid-drag before release.
    await act(async () => store.set(subagentsPanelAtom, { roomId: ROOM_ID }));
    expect(container.querySelector('[data-testid="subagents-panel"]')).not.toBeNull();

    act(() => {
      dispatchEdgeTouch('touchend', [], 270);
    });
    await flushMicrotasks();

    // Stale-panel guard kept the newly opened subagents panel open and cleaned up swipe styles.
    expect(container.querySelector('[data-testid="subagents-panel"]')).not.toBeNull();
    expect(host.hasAttribute('data-swiping')).toBe(false);
    expect(host.style.translate).toBe('');
  });

  it('shows themed backdrop instead of conversation when transcript restores docked call', async () => {
    state.inCall = true;
    store.set(callPanelRoomAtom, ROOM_ID);
    openTranscriptPanel(store, ROOM_ID, false);

    const { container } = renderPhoneRoom();
    await flushMicrotasks();

    const host = getHost(container)!;
    const conversation = getConversation(container);
    mockWidth(host, 400);

    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 210, clientY: 200 }], 250);
      vi.advanceTimersToNextFrame();
    });

    expect(conversation.hasAttribute('data-swipe-under-panel')).toBe(false);
    expect(container.querySelector('[data-swipe-panel-backdrop]')).not.toBeNull();

    act(() => {
      dispatchEdgeTouch('touchend', [], 270);
    });
    await flushMicrotasks();

    // transcript.close() restored the docked call panel rather than permanently dismissing it.
    expect(store.get(callPanelRoomAtom)).toBe(ROOM_ID);
    expect(container.querySelector('[data-swipe-panel-backdrop]')).toBeNull();
    expect(container.querySelector('[data-swipe-panel-dim]')).toBeNull();
  });

  it('reveals conversation when transcript did not replace a docked call, even while inCall', async () => {
    state.inCall = true;
    // No docked call panel was open when transcript opened, so replacedCall is false.
    openTranscriptPanel(store, ROOM_ID, false);

    const { container } = renderPhoneRoom();
    await flushMicrotasks();

    const host = getHost(container)!;
    const conversation = getConversation(container);
    mockWidth(host, 400);

    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 210, clientY: 200 }], 250);
      vi.advanceTimersToNextFrame();
    });

    expect(conversation.hasAttribute('data-swipe-under-panel')).toBe(true);
    expect(container.querySelector('[data-swipe-panel-backdrop]')).toBeNull();

    act(() => {
      dispatchEdgeTouch('touchend', [], 270);
    });
    await flushMicrotasks();

    expect(store.get(callPanelRoomAtom)).toBeUndefined();
    expect(conversation.dataset.conversationBehindPanel).toBe('false');
  });

  it('yields to higher-priority PANEL_INNER swipe while subagents detail is open', async () => {
    state.subagentsDetailOpen = true;
    store.set(subagentsPanelAtom, { roomId: ROOM_ID });

    const { container } = renderPhoneRoom();
    await flushMicrotasks();

    const host = getHost(container)!;
    const conversation = getConversation(container);
    mockWidth(host, 400);

    expect(state.subagentsSawRoomContext).toBe(true);

    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 10, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 150, clientY: 200 }], 200);
      dispatchEdgeTouch('touchend', [], 220);
    });
    await flushMicrotasks();

    expect(innerBackSpy).toHaveBeenCalledTimes(1);
    // Room's PANEL swipe did not activate or close the subagents panel.
    expect(conversation.hasAttribute('data-swipe-under-panel')).toBe(false);
    expect(store.get(subagentsPanelAtom)).toEqual({ roomId: ROOM_ID });
  });

  it('mirrors covering panel translation in RTL', async () => {
    document.documentElement.dir = 'rtl';
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });

    const { container } = renderPhoneRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));

    const host = getHost(container)!;
    const conversation = getConversation(container);
    mockWidth(host, 400);

    // RTL start edge is physical right (x = 390 -> drag left to 280: lock at 380, offset = 100).
    act(() => {
      dispatchEdgeTouch('touchstart', [{ clientX: 390, clientY: 200 }], 100);
      dispatchEdgeTouch('touchmove', [{ clientX: 280, clientY: 200 }], 250);
      vi.advanceTimersToNextFrame();
    });

    expect(host.style.translate).toBe('-100px');
    expect(conversation.style.translate).toBe('90px');
  });
});
