// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { getDefaultStore, type PrimitiveAtom } from 'jotai';
import { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { callPanelRoomAtom } from '../calls/callStore';
import * as membersDrawer from '../members/useMembersDrawer';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';

// The room's side panels (the computer, a canvas, the call and the members), opened as their
// users open them, through the room: the header's controls, an agent's live request, and the call
// store, which the call buttons and a call started elsewhere set.

const { mx, room, state } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const members = [
    { membership: 'join', userId: '@mindroom_helper:example.org', name: 'Helper' },
    { membership: 'join', userId: '@alice:example.org', name: 'Alice' },
  ];
  return {
    state: {
      listeners,
      members,
      config: {} as ClientConfig,
      view: undefined as RoomViewProps | undefined,
    },
    mx: {
      getSafeUserId: () => '@alice:example.org',
      getHomeserverUrl: () => 'https://example.org',
      relations: () => Promise.resolve({ originalEvent: null, events: [] }),
      isInitialSyncComplete: () => true,
      getSyncState: () => 'SYNCING',
      on: (name: string, handler: (...args: unknown[]) => void) => listeners.set(name, handler),
      removeListener: (name: string) => listeners.delete(name),
    },
    room: {
      roomId: '!room:example.org',
      getMembers: () => members,
      getMember: (userId: string) => members.find((member) => member.userId === userId),
      getThread: () => undefined,
      findEventById: (eventId: string) =>
        eventId === '$thread' ? { getId: () => '$thread', isSending: () => false } : undefined,
      on: () => undefined,
      removeListener: () => undefined,
    },
  };
});

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams('threadId=%24thread')],
}));
vi.mock('./RoomView', () => ({
  RoomView: (props: RoomViewProps) => {
    state.view = props;
    return null;
  },
}));
vi.mock('../members/MembersDrawer', () => ({ MembersDrawer: () => <aside /> }));
vi.mock('../members/useMembersDrawer', async () => {
  const { atom, useAtom } = await vi.importActual<typeof import('jotai')>('jotai');
  const membersOpenAtom = atom(false);
  return { membersOpenAtom, useMembersDrawer: () => useAtom(membersOpenAtom) };
});
vi.mock('../computer/ComputerPanel', () => ({ ComputerPanel: () => null }));
vi.mock('../canvas/RoomCanvasPanel', () => ({
  RoomCanvasPanel: () => <div data-testid="room-canvas-panel" />,
}));
vi.mock('../calls/CallPanel', () => ({ CallPanel: () => null }));
vi.mock('../canvas/canvasIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../canvas/canvasIndex')>()),
  useConversationCanvases: () => [],
  useComputerShown: () => false,
}));
vi.mock('../matrix/hooks/useRoom', () => ({ useRoom: () => room }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  usePowerLevels: () => ({}),
}));
vi.mock('../config/useClientConfig', () => ({ useClientConfig: () => state.config }));
vi.mock('../computer/useAgentServers', () => ({
  useRoomAgentServers: () => [],
  useBindsOpenIdTokens: () => false,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'threaded', setViewMode: () => undefined }),
}));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: () => undefined, navigateRoomThread: () => undefined }),
}));

importBeforeTests(() => import('./Room'));

const store = getDefaultStore();
const { membersOpenAtom } = membersDrawer as unknown as { membersOpenAtom: PrimitiveAtom<boolean> };

type CorePanel = 'computer' | 'canvas' | 'call' | 'members';
const PANELS: CorePanel[] = ['computer', 'canvas', 'call', 'members'];
const TEST_IDS: Record<CorePanel, string> = {
  computer: 'resizable-computer-panel',
  canvas: 'room-canvas-panel',
  call: 'resizable-call-panel',
  members: 'resizable-members-panel',
};

let serial = 0;
/** An agent's live request in the conversation, as sync delivers it. */
const agentRequest = (action: string, extra: Record<string, unknown> = {}) =>
  act(async () => {
    state.listeners.get('Room.timeline')?.(
      new MatrixEvent({
        event_id: `$request-${(serial += 1)}`,
        room_id: room.roomId,
        sender: '@mindroom_helper:example.org',
        type: 'm.room.message',
        origin_server_ts: Date.now(),
        content: {
          msgtype: 'm.notice',
          body: 'Open this view.',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
          'io.mindroom.ui_action': {
            version: 1,
            action,
            requester_id: '@alice:example.org',
            agent_user_id: '@mindroom_helper:example.org',
            room_id: room.roomId,
            thread_id: '$thread',
            ...extra,
          },
        },
      }),
      room,
      false,
      false,
      { liveEvent: true }
    );
  });

const open = async (panel: CorePanel) => {
  if (panel === 'computer') {
    await act(async () => state.view?.onComputerToggle?.());
  } else if (panel === 'canvas') {
    await agentRequest('show_canvas', { canvas: { title: 'Choose', html: '<p></p>' } });
  } else if (panel === 'call') {
    await act(async () => store.set(callPanelRoomAtom, room.roomId));
  } else {
    await agentRequest('open_panel', { panel: 'members' });
  }
};

const isOpen = (panel: CorePanel): boolean => {
  if (panel === 'computer') return state.view?.computerOpen === true;
  if (panel === 'canvas') return state.view?.canvasOpen === true;
  if (panel === 'call') return store.get(callPanelRoomAtom) === room.roomId;
  return store.get(membersOpenAtom);
};

const shown = () => PANELS.filter((panel) => screen.queryByTestId(TEST_IDS[panel]));

const renderRoom = async () => {
  const { Room } = await import('./Room');
  await act(async () => {
    render(<Room />);
  });
};

describe('the side panels of a room', () => {
  beforeEach(() => {
    state.config = {
      mindroom: {
        computers: { apiUrl: 'https://computer.example.org' },
        uiActions: { autoOpenFromHomeservers: ['example.org'] },
        canvas: { enabled: true },
      },
    };
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    cleanup();
    store.set(callPanelRoomAtom, undefined);
    store.set(membersOpenAtom, false);
    state.view = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(
    PANELS.flatMap((first) =>
      PANELS.filter((then) => then !== first).map((then) => ({ first, then }))
    )
  )('$then takes the side panel from $first', async ({ first, then }) => {
    await renderRoom();
    await open(first);
    expect(isOpen(first)).toBe(true);
    expect(shown()).toEqual([first]);

    await open(then);
    expect(isOpen(then)).toBe(true);
    expect(shown()).toEqual([then]);
    if (first === 'members' && then === 'call') {
      // The members stay open behind the call and come back when it closes.
      expect(isOpen('members')).toBe(true);
      await act(async () => store.set(callPanelRoomAtom, undefined));
      expect(shown()).toEqual(['members']);
    } else {
      expect(isOpen(first)).toBe(false);
    }
  });
});
