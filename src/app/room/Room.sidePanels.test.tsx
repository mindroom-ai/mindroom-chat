// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { getDefaultStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { callPanelRoomAtom } from '../calls/callStore';
import {
  clearCallWindowStore,
  getCallWindowSettingsAtom,
  type CallWindowMode,
} from '../calls/window/callWindowState';
import { conversationOutOfSightAtom } from '../navigation/conversationCover';
import type { AgentServer } from '../computer/agentServer';
import { computerServicePreferenceAtom } from '../computer/computerServiceSettings';
import * as membersDrawer from '../members/useMembersDrawer';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { putSession } from '../matrix/session/sessions';
import { type RoomSidePanelControl, useRoomSidePanel } from '../plugins/sidePanels';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';
import { makeUiEvent } from '../ui-actions/testUtils';

// The room's side panels (the computer, a canvas, the call, the members and a plugin's panel),
// opened as their users open them, through the room: the header's controls, an agent's live
// request, the call store, which the call buttons and a call started elsewhere set, and a plugin's
// code in the room (a card in the conversation).

const reportBoundaryError = vi.hoisted(() => vi.fn());
vi.mock('../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError,
}));

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
      // The servers the room's agents publish, which count when the homeserver binds tokens.
      servers: [] as AgentServer[],
      bindsOpenIdTokens: false,
      view: undefined as RoomViewProps | undefined,
      viewRenders: 0,
      // What the conversation shows besides the mock's own element, such as a plugin's cards.
      inView: undefined as React.ReactNode,
      userId: '@alice:example.org',
      /** How many times the conversation mounted. */
      mounts: 0,
      computer: undefined as { expanded?: boolean; onToggleExpanded?: () => void } | undefined,
      canvas: undefined as { expanded?: boolean; onToggleExpanded?: () => void } | undefined,
      roomId: '!room:example.org',
    },
    mx: {
      getSafeUserId: () => state.userId,
      isInitialSyncComplete: () => true,
      getSyncState: () => 'SYNCING',
      on: (name: string, handler: (...args: unknown[]) => void) => listeners.set(name, handler),
      removeListener: (name: string) => listeners.delete(name),
    },
    room: {
      roomId: '!room:example.org',
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
vi.mock('./RoomView', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react');
  return {
    RoomView: (props: RoomViewProps) => {
      state.view = props;
      state.viewRenders += 1;
      // Which mount of the conversation this is: one that stays keeps its draft and recording.
      const [mount] = useState(() => (state.mounts += 1));
      return (
        <div data-testid="room-view" data-mount={mount}>
          <input aria-label="Message" />
          {state.inView}
        </div>
      );
    },
  };
});
vi.mock('../members/MembersDrawer', () => ({ MembersDrawer: () => <aside /> }));
vi.mock('../members/useMembersDrawer', async () => {
  const { atom, useAtom } = await vi.importActual<typeof import('jotai')>('jotai');
  const membersOpenAtom = atom(false);
  return { membersOpenAtom, useMembersDrawer: () => useAtom(membersOpenAtom) };
});
vi.mock('../computer/ComputerPanel', () => ({
  ComputerPanel: (props: typeof state.computer) => {
    state.computer = props;
    return null;
  },
}));
vi.mock('../canvas/RoomCanvasPanel', () => ({
  RoomCanvasPanel: (props: typeof state.canvas) => {
    state.canvas = props;
    return <div data-testid="room-canvas-panel" />;
  },
}));
vi.mock('../calls/CallPanel', () => ({ CallPanel: () => null }));
vi.mock('../canvas/canvasIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../canvas/canvasIndex')>()),
  useConversationCanvases: () => [],
  useComputerShown: () => false,
}));
// The room the route shows: `room`, or the same room under another id.
vi.mock('../matrix/hooks/useRoom', () => ({
  useRoom: () => (state.roomId === room.roomId ? room : { ...room, roomId: state.roomId }),
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useRoomMembers', () => ({ useRoomMembers: () => state.members }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) => children,
  usePowerLevels: () => ({}),
}));
vi.mock('../config/useClientConfig', () => ({ useClientConfig: () => state.config }));
vi.mock('../computer/useAgentServers', () => ({
  useRoomAgentServers: () => state.servers,
  useBindsOpenIdTokens: () => state.bindsOpenIdTokens,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'threaded', setViewMode: () => undefined }),
}));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: () => undefined, navigateRoomThread: () => undefined }),
}));
const { neverLoads } = vi.hoisted(() => ({ neverLoads: new Promise<never>(() => undefined) }));
// Two plugins of the build: one whose panels name their room and request, the second of which
// remembers it is open, and one whose panels fail or wait for their code (a lazy component that
// never loads).
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
            Component: ({ roomId, request }: { roomId: string; request?: unknown }) => {
              if (request === 'missing note') throw new Error('no such note');
              return (
                <>
                  <p>Notes of {roomId}</p>
                  {request !== undefined && <p>Notes request {JSON.stringify(request)}</p>}
                </>
              );
            },
          },
          {
            id: 'board',
            label: 'Board',
            remember: true,
            Component: ({ roomId, request }: { roomId: string; request?: unknown }) => (
              <>
                <p>Board of {roomId}</p>
                {request !== undefined && <p>Board request {JSON.stringify(request)}</p>}
              </>
            ),
          },
        ],
        headerActions: [{ id: 'add', label: 'Add a note', icon: () => null, run: () => undefined }],
      },
    },
    {
      id: 'broken',
      version: '2.0.0',
      plugin: {
        sidePanels: [
          {
            id: 'panel',
            label: 'Broken',
            Component: () => {
              throw new Error('no notes today');
            },
          },
          {
            id: 'opaque',
            label: 'Opaque',
            Component: () => {
              // A value with no way to become text.
              throw Object.create(null);
            },
          },
          {
            id: 'waiting',
            label: 'Waiting',
            Component: () => {
              throw neverLoads;
            },
          },
        ],
      },
    },
  ],
}));

importBeforeTests(() => import('./Room'));

const store = getDefaultStore();
const ALICE = '@alice:example.org';
/** Where the call view shows on desktop: the floating window, or this side panel. */
const setCallMode = (mode: CallWindowMode) =>
  act(async () => store.set(getCallWindowSettingsAtom(ALICE), { mode }));
const { membersOpenAtom } = membersDrawer as unknown as { membersOpenAtom: PrimitiveAtom<boolean> };

const PANELS = ['computer', 'canvas', 'call', 'members'] as const;
type CorePanel = (typeof PANELS)[number];
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
      makeUiEvent(
        { action, ...extra },
        { event_id: `$request-${(serial += 1)}`, origin_server_ts: Date.now() }
      ),
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
  if (panel === 'canvas') return state.view?.openCanvasId !== undefined;
  if (panel === 'call') return store.get(callPanelRoomAtom) === room.roomId;
  return store.get(membersOpenAtom);
};

const shown = () => PANELS.filter((panel) => screen.queryByTestId(TEST_IDS[panel]));

const renderRoom = async (size: ScreenSize = ScreenSize.Desktop) => {
  const { Room } = await import('./Room');
  const { rerender } = await act(async () =>
    render(<Room />, {
      wrapper: ({ children }) => <ScreenSizeProvider value={size}>{children}</ScreenSizeProvider>,
    })
  );
  /** Shows another room in the same place, as a link from one room to another does. */
  return async (roomId: string) => {
    state.roomId = roomId;
    await act(async () => rerender(<Room />));
  };
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
    // The rule between the panels holds for the call docked beside the conversation.
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
    cleanup();
    store.set(callPanelRoomAtom, undefined);
    store.set(membersOpenAtom, false);
    store.set(computerServicePreferenceAtom, null);
    clearCallWindowStore(ALICE);
    state.servers = [];
    state.bindsOpenIdTokens = false;
    state.view = undefined;
    state.inView = undefined;
    state.userId = '@alice:example.org';
    localStorage.clear();
    state.mounts = 0;
    state.computer = undefined;
    state.canvas = undefined;
    state.roomId = room.roomId;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    reportBoundaryError.mockClear();
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

  it('leaves the call to the floating window on desktop, and shows it on phones and docked', async () => {
    await setCallMode('floating');
    await renderRoom();
    await open('canvas');
    await open('call');
    expect(isOpen('canvas')).toBe(true);
    expect(shown()).toEqual(['canvas']);

    // Docking the window shows the call here, in place of the canvas; floating again gives the
    // side panel back to the conversation.
    await setCallMode('docked');
    expect(shown()).toEqual(['call']);
    expect(isOpen('canvas')).toBe(false);
    await setCallMode('floating');
    expect(shown()).toEqual([]);
    cleanup();

    await renderRoom(ScreenSize.Mobile);
    expect(shown()).toEqual(['call']);
  });

  it('renders again when the call docks or floats, not when the floating window moves', async () => {
    await setCallMode('floating');
    await renderRoom();
    await open('call');
    const before = state.viewRenders;
    const rect = { x: 100, y: 100, width: 400, height: 480 };
    await act(async () => store.set(getCallWindowSettingsAtom(ALICE), { mode: 'floating', rect }));
    expect(state.viewRenders).toBe(before);
    await setCallMode('docked');
    expect(state.viewRenders).toBeGreaterThan(before);
  });

  it('keeps the members beside the conversation while the call floats', async () => {
    await setCallMode('floating');
    await renderRoom(ScreenSize.Tablet);
    await open('members');
    await open('call');
    expect(shown()).toEqual(['members']);
  });

  it.each(['canvas', 'call', 'members'] as const)(
    "an agent's request for the computer takes the side panel from %s",
    async (first) => {
      await renderRoom();
      await open(first);
      await agentRequest('show_computer');
      expect(isOpen('computer')).toBe(true);
      expect(shown()).toEqual(['computer']);
      expect(isOpen(first)).toBe(false);
    }
  );

  it.each(['canvas', 'call', 'members'] as const)(
    "an agent's request for its published computer leaves %s open while computers are off here",
    async (first) => {
      // The agent publishes its server with a computer; no deployment server is configured.
      state.config = { mindroom: { ...state.config.mindroom, computers: {} } };
      state.bindsOpenIdTokens = true;
      state.servers = [
        {
          agentUserId: '@mindroom_helper:example.org',
          apiUrl: 'https://helper.example.org',
          computer: true,
          ts: 1,
        },
      ];
      await renderRoom();
      await open(first);
      await agentRequest('show_computer');
      expect(shown()).toEqual(['computer']);
      await open(first);

      // Turned off in this device's settings.
      await act(async () => store.set(computerServicePreferenceAtom, ''));
      await agentRequest('show_computer');
      expect(isOpen(first)).toBe(true);
      expect(isOpen('computer')).toBe(false);
      expect(shown()).toEqual([first]);
    }
  );

  it('toggles the members from the header by the same rule, even behind the call', async () => {
    await renderRoom();
    await open('computer');
    await act(async () => state.view?.onPanelToggle?.('members'));
    expect(isOpen('computer')).toBe(false);
    expect(shown()).toEqual(['members']);
    expect(state.view?.shownPanel).toBe('members');

    await open('call');
    expect(shown()).toEqual(['call']);
    await act(async () => state.view?.onPanelToggle?.('members'));
    expect(isOpen('call')).toBe(false);
    expect(shown()).toEqual(['members']);

    await act(async () => state.view?.onPanelToggle?.('members'));
    expect(isOpen('members')).toBe(false);
    expect(shown()).toEqual([]);
  });

  const notes = () => screen.queryByRole('region', { name: 'Notes' });

  it.each(PANELS)(
    "a plugin's panel takes the side panel from %s, and gives it back",
    async (core) => {
      await renderRoom();
      await open(core);
      await act(async () => state.view?.onPanelToggle?.('notes/panel'));
      expect(notes()).not.toBeNull();
      expect(screen.getByText(`Notes of ${room.roomId}`)).toBeTruthy();
      expect(state.view?.shownPanel).toBe('notes/panel');
      expect(isOpen(core)).toBe(false);
      expect(shown()).toEqual([]);

      await open(core);
      expect(notes()).toBeNull();
      expect(shown()).toEqual([core]);
    }
  );

  it("closes a plugin's panel from its Close button and from the header", async () => {
    await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    await act(async () => screen.getByRole('button', { name: 'Close Notes' }).click());
    expect(notes()).toBeNull();

    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    expect(notes()).not.toBeNull();
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    expect(notes()).toBeNull();
  });

  it("keeps a plugin's panel with the room it was opened in", async () => {
    const showRoom = await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    await showRoom('!other:example.org');
    expect(notes()).toBeNull();
    expect(state.view?.shownPanel).toBeUndefined();
    await showRoom(room.roomId);
    expect(notes()).not.toBeNull();
  });

  /** What the plugin's code in the conversation gets for each of its panels. */
  const controls: Record<string, RoomSidePanelControl | undefined> = {};
  function Card({ panel }: { panel: string }) {
    controls[panel] = useRoomSidePanel('notes', panel);
    return null;
  }
  const withCards = () => {
    state.inView = ['panel', 'board', 'missing'].map((panel) => <Card key={panel} panel={panel} />);
  };
  const board = () => screen.queryByRole('region', { name: 'Board' });
  /** Stores Alice's login in this browser, without which nothing is remembered for her. */
  const signIn = () =>
    putSession({
      baseUrl: 'https://example.org',
      userId: '@alice:example.org',
      deviceId: 'ROOMTEST',
      accessToken: 'room-test',
    });

  it("opens a plugin's panel from the plugin's code with a request, which each open replaces", async () => {
    withCards();
    await renderRoom();
    await open('computer');
    expect(controls.panel?.isOpen).toBe(false);
    await act(async () => controls.panel?.open({ note: 1 }));
    expect(isOpen('computer')).toBe(false);
    expect(screen.getByText('Notes request {"note":1}')).toBeTruthy();
    expect(controls.panel?.isOpen).toBe(true);
    expect(controls.board?.isOpen).toBe(false);

    await act(async () => controls.panel?.open({ note: 2 }));
    expect(screen.getByText('Notes request {"note":2}')).toBeTruthy();
    // Another plugin panel's close, or the open of a panel the build lacks, leaves it.
    await act(async () => controls.board?.close());
    await act(async () => controls.missing?.open('nothing'));
    expect(controls.panel?.isOpen).toBe(true);

    await act(async () => controls.panel?.close());
    expect(notes()).toBeNull();
    expect(controls.panel?.isOpen).toBe(false);
    // The room menu opens it with no request.
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    expect(screen.getByText(`Notes of ${room.roomId}`)).toBeTruthy();
    expect(screen.queryByText(/^Notes request/)).toBeNull();
  });

  it("acts on the room's panels as they are when a plugin's code calls, not when it got them", async () => {
    withCards();
    const showRoom = await renderRoom();
    await act(async () => controls.panel?.open());
    const notesThen = controls.panel;
    await act(async () => controls.board?.open());
    // A late close of the panel that showed before closes nothing now.
    await act(async () => notesThen?.close());
    expect(board()).not.toBeNull();

    // Nor does a late open from a room no longer shown take the panel of the one that is.
    const boardThen = controls.board;
    await showRoom('!other:example.org');
    await act(async () => controls.panel?.open());
    await act(async () => boardThen?.open());
    expect(notes()).not.toBeNull();
    expect(controls.panel?.isOpen).toBe(true);
    // Nor a late close from there the same panel shown here.
    await act(async () => controls.board?.open());
    await act(async () => boardThen?.close());
    expect(board()).not.toBeNull();
  });

  /** A plugin's code that opens its panel from a layout effect, before the room's effects run. */
  function OpensAtOnce() {
    const open = useRoomSidePanel('notes', 'panel')?.open;
    useLayoutEffect(() => open?.('at once'), [open]);
    return null;
  }

  it("lets the room's other panels open over a panel a plugin opened as it showed", async () => {
    state.inView = <OpensAtOnce />;
    await renderRoom();
    expect(notes()).not.toBeNull();
    await act(async () => state.view?.onPanelToggle?.('members'));
    expect(shown()).toEqual(['members']);
    expect(notes()).toBeNull();
  });

  it("acts on the room shown for a plugin's call made before the room's own effects run", async () => {
    state.inView = <OpensAtOnce />;
    const showRoom = await renderRoom();
    expect(screen.getByText('Notes request "at once"')).toBeTruthy();
    await showRoom('!other:example.org');
    expect(screen.getByText('Notes request "at once"')).toBeTruthy();
  });

  it("keeps what a room remembers when a plugin's layout effect opens a panel in the next room", async () => {
    signIn();
    withCards();
    const showRoom = await renderRoom();
    await act(async () => controls.board?.open('kept'));
    state.inView = <OpensAtOnce />;
    await showRoom('!other:example.org');
    expect(screen.getByText('Notes request "at once"')).toBeTruthy();
    withCards();
    await showRoom(room.roomId);
    expect(screen.getByText('Board request "kept"')).toBeTruthy();
  });

  it("leaves the call of the room left when a plugin's layout effect opens a panel in the next room", async () => {
    const showRoom = await renderRoom();
    await open('call');
    state.inView = <OpensAtOnce />;
    await showRoom('!other:example.org');
    expect(screen.getByText('Notes request "at once"')).toBeTruthy();
    expect(store.get(callPanelRoomAtom)).toBe(room.roomId);
  });

  it("does nothing for a plugin's late call after the room's page has gone", async () => {
    signIn();
    withCards();
    await renderRoom();
    const boardThen = controls.board;
    cleanup();
    await act(async () => boardThen?.open('late'));
    expect(Object.keys(localStorage).filter((key) => key.includes(':side-panel/'))).toEqual([]);
    await renderRoom();
    expect(board()).toBeNull();

    // Nor does a late close forget what the room remembers.
    await act(async () => controls.board?.open('kept'));
    const keptThen = controls.board;
    cleanup();
    await act(async () => keptThen?.close());
    await renderRoom();
    expect(screen.getByText('Board request "kept"')).toBeTruthy();
  });

  it("gives a plugin's code no panels outside a room's page", async () => {
    render(<Card panel="panel" />);
    expect(controls.panel).toBeUndefined();
  });

  it('keeps a panel that remembers open in its room for the account, across reloads and rooms', async () => {
    signIn();
    withCards();
    await renderRoom();
    await act(async () => controls.board?.open({ item: 'a' }));
    cleanup();

    const showRoom = await renderRoom();
    expect(board()).not.toBeNull();
    expect(screen.getByText('Board request {"item":"a"}')).toBeTruthy();
    // Not in another room, whose own plugin panel then takes the page's place for one.
    await showRoom('!other:example.org');
    expect(board()).toBeNull();
    await act(async () => controls.panel?.open());
    await showRoom(room.roomId);
    expect(screen.getByText('Board request {"item":"a"}')).toBeTruthy();
    cleanup();

    // Another account never sees it.
    state.userId = '@bob:example.org';
    await renderRoom();
    expect(board()).toBeNull();
    cleanup();

    // A panel that does not remember is gone after a reload, and keeps nothing.
    state.userId = '@alice:example.org';
    await renderRoom();
    await act(async () => controls.panel?.open());
    expect(Object.keys(localStorage).filter((key) => key.includes(':side-panel/'))).toEqual([]);
    cleanup();
    await renderRoom();
    expect(notes()).toBeNull();
  });

  it('reads what the room remembers at its documented key, and opens no panel for what it cannot read or a panel that does not remember', async () => {
    const key = `mindroom.plugin:${encodeURIComponent(
      '@alice:example.org'
    )}/:side-panel/${encodeURIComponent(room.roomId)}`;
    for (const stored of ['{not json', 'null', '"notes/board"', '{"id":"notes/panel"}']) {
      localStorage.setItem(key, stored);
      // eslint-disable-next-line no-await-in-loop
      await renderRoom();
      expect(state.view?.shownPanel).toBeUndefined();
      expect(screen.getByTestId('room-view')).toBeTruthy();
      cleanup();
    }
    localStorage.setItem(key, '{"id":"notes/board","request":"kept"}');
    await renderRoom();
    expect(screen.getByText('Board request "kept"')).toBeTruthy();
  });

  it('forgets a panel that remembers when it closes, or another panel opens, in its room', async () => {
    signIn();
    withCards();
    await renderRoom();
    await act(async () => controls.board?.open());
    await act(async () => screen.getByRole('button', { name: 'Close Board' }).click());
    cleanup();
    await renderRoom();
    expect(board()).toBeNull();

    await act(async () => controls.board?.open());
    await act(async () => state.view?.onPanelToggle?.('members'));
    await act(async () => state.view?.onPanelToggle?.('members'));
    cleanup();
    await renderRoom();
    expect(board()).toBeNull();
  });

  it.each(['call', 'members'] as const)(
    'opens a panel that remembers again only when no other panel of its room is open: %s',
    async (core) => {
      signIn();
      withCards();
      await renderRoom();
      await act(async () => controls.board?.open());
      cleanup();
      if (core === 'call') store.set(callPanelRoomAtom, room.roomId);
      else store.set(membersOpenAtom, true);
      await renderRoom();
      expect(board()).toBeNull();
      expect(shown()).toEqual([core]);
      // Nor when that panel closes.
      await act(async () => {
        if (core === 'call') store.set(callPanelRoomAtom, undefined);
        else store.set(membersOpenAtom, false);
      });
      expect(board()).toBeNull();
    }
  );

  it("opens a panel that remembers again over a phone's members, which the navigation puts away", async () => {
    signIn();
    withCards();
    const showRoom = await renderRoom(ScreenSize.Mobile);
    await act(async () => controls.board?.open('kept'));
    await showRoom('!other:example.org');
    await act(async () => controls.panel?.open());
    // The members the other room showed are still open as the room shows again; the navigation puts
    // them away after.
    state.roomId = room.roomId;
    await act(async () => store.set(membersOpenAtom, true));
    expect(screen.getByText('Board request "kept"')).toBeTruthy();
  });

  it('remembers nothing for an account whose login this browser no longer has', async () => {
    withCards();
    await renderRoom();
    await act(async () => controls.board?.open());
    expect(board()).not.toBeNull();
    cleanup();
    await renderRoom();
    expect(board()).toBeNull();
  });

  it("covers the conversation with a plugin's panel on phones, which has no frame", async () => {
    await renderRoom(ScreenSize.Mobile);
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    expect(notes()).not.toBeNull();
    expect(hidden()).toBe(true);
    expect(screen.queryByRole('button', { name: 'Fill the room with Notes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fold Notes to the edge' })).toBeNull();
    await act(async () => screen.getByRole('button', { name: 'Close Notes' }).click());
    expect(hidden()).toBe(false);
  });

  /**
   * Whether the conversation is hidden behind the panel shown: out of reach (inert) and out of
   * sight, so no read receipt goes out for it. Hidden or not, it is the one that first mounted, with
   * its draft and a recording in progress.
   */
  const hidden = () => {
    const view = screen.getByTestId('room-view');
    const outOfSight = store.get(conversationOutOfSightAtom);
    expect(view.dataset.mount).toBe('1');
    expect(view.parentElement?.inert).toBe(outOfSight);
    return outOfSight;
  };
  const frameButton = (name: string) => screen.queryByRole('button', { name });

  /** Opens or closes a panel with a frame as its users do: the call from the call store. */
  const toggleFramed = (id: string) =>
    act(async () => {
      if (id !== 'call') state.view?.onPanelToggle?.(id);
      else store.set(callPanelRoomAtom, isOpen('call') ? undefined : room.roomId);
    });

  it.each([
    ['the call', 'call', 'Call'],
    ["a plugin's panel", 'notes/panel', 'Notes'],
  ])(
    '%s fills the room and folds to a tab, per room, and the conversation follows',
    async (_panel, id, label) => {
      const fill = `Fill the room with ${label}`;
      const fold = `Fold ${label} to the edge`;
      const unfold = `Unfold ${label}`;
      const showRoom = await renderRoom();
      await toggleFramed(id);
      expect(frameButton(fill)?.getAttribute('aria-pressed')).toBe('false');

      // Filling the room, the panel takes the conversation's place until Fill is pressed again;
      // the conversation stays under it as it was.
      await act(async () => frameButton(fill)?.click());
      expect(hidden()).toBe(true);
      expect(frameButton(fill)?.getAttribute('aria-pressed')).toBe('true');
      await act(async () => frameButton(fill)?.click());
      expect(hidden()).toBe(false);

      // Folded, it stays open as a tab at the room's edge beside the whole conversation.
      await act(async () => frameButton(fold)?.click());
      expect(hidden()).toBe(false);
      expect(frameButton(unfold)).not.toBeNull();
      expect(frameButton(fill)).toBeNull();
      expect(state.view?.shownPanel).toBe(id);

      // Another room has its own layout; back here the panel is still folded.
      await showRoom('!other:example.org');
      expect(frameButton(unfold)).toBeNull();
      await showRoom(room.roomId);
      expect(frameButton(unfold)).not.toBeNull();
      await act(async () => frameButton(unfold)?.click());
      expect(frameButton(fill)?.getAttribute('aria-pressed')).toBe('false');
      expect(hidden()).toBe(false);

      // Opened again, a panel shows beside the conversation.
      await act(async () => frameButton(fold)?.click());
      await toggleFramed(id);
      await toggleFramed(id);
      expect(frameButton(fill)).not.toBeNull();
    }
  );

  it('takes the focus out of the conversation as a panel fills the room', async () => {
    await renderRoom();
    await open('computer');
    screen.getByRole('textbox', { name: 'Message' }).focus();
    // As a browser that keeps the focus on a pressed button (Safari) leaves it in the composer.
    await act(async () => state.computer?.onToggleExpanded?.());
    expect(hidden()).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });

  it('fills the room with the computer from its own Expand, as from its Fill', async () => {
    await renderRoom();
    await open('computer');
    await act(async () =>
      screen.getByRole('button', { name: 'Fill the room with Computer' }).click()
    );
    expect(hidden()).toBe(true);
    // The frame and the computer's own Expand share the layout.
    expect(state.computer?.expanded).toBe(true);
    await act(async () => state.computer?.onToggleExpanded?.());
    expect(hidden()).toBe(false);
    expect(frameButton('Fill the room with Computer')?.getAttribute('aria-pressed')).toBe('false');
  });

  it("keeps the computer filling the room when an agent shows it again, but shows an agent's new canvas beside", async () => {
    await renderRoom();
    await open('computer');
    await act(async () => state.computer?.onToggleExpanded?.());
    await agentRequest('show_computer');
    expect(state.computer?.expanded).toBe(true);
    expect(hidden()).toBe(true);

    await open('canvas');
    await act(async () => state.canvas?.onToggleExpanded?.());
    expect(hidden()).toBe(true);
    await open('canvas');
    expect(state.canvas?.expanded).toBe(false);
    expect(hidden()).toBe(false);
  });

  it('gives the members no frame: their header button shows and hides them', async () => {
    await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('members'));
    expect(shown()).toEqual(['members']);
    expect(screen.queryByRole('button', { name: /^Fill the room with/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Fold .* to the edge$/ })).toBeNull();
  });

  it("lists the plugins' panels and actions for the header, but none of a plugin config.json turns off", async () => {
    await renderRoom();
    expect(state.view?.pluginPanels?.map(({ id, label }) => [id, label])).toEqual([
      ['notes/panel', 'Notes'],
      ['notes/board', 'Board'],
      ['broken/panel', 'Broken'],
      ['broken/opaque', 'Opaque'],
      ['broken/waiting', 'Waiting'],
    ]);
    expect(state.view?.pluginActions?.map(({ id, label }) => [id, label])).toEqual([
      ['notes/add', 'Add a note'],
    ]);
    cleanup();

    state.config = { ...state.config, plugins: { notes: { enabled: false } } } as ClientConfig;
    await renderRoom();
    expect(state.view?.pluginPanels?.map(({ id }) => id)).toEqual([
      'broken/panel',
      'broken/opaque',
      'broken/waiting',
    ]);
    expect(state.view?.pluginActions).toEqual([]);
  });

  it("keeps the room when a plugin's panel throws a value that cannot become text", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('broken/opaque'));
    const panel = screen.getByRole('region', { name: 'Opaque' });
    expect(panel.textContent).toContain('This panel stopped working.');
    expect(screen.queryByTestId('room-view')).not.toBeNull();
    expect(reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '[plugin broken@2.0.0] a value that cannot be shown as text',
      }),
      expect.any(String)
    );
  });

  it("keeps the room on screen while a plugin's panel waits for its code", async () => {
    await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('broken/waiting'));
    const panel = screen.getByRole('region', { name: 'Waiting' });
    expect(panel.textContent).not.toContain('This panel stopped working.');
    expect(screen.queryByTestId('room-view')).not.toBeNull();
  });

  it("keeps the room when a plugin's panel fails, and says so in the panel", async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('broken/panel'));
    const panel = screen.getByRole('region', { name: 'Broken' });
    expect(panel.textContent).toContain('This panel stopped working.');
    expect(state.view?.shownPanel).toBe('broken/panel');
    expect(logged).toHaveBeenCalledWith(
      '[plugin broken@2.0.0] its side panel failed',
      expect.objectContaining({ message: 'no notes today' })
    );
    expect(reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Error', message: '[plugin broken@2.0.0] no notes today' }),
      expect.any(String)
    );
  });

  it("tries a plugin's failed panel again with its next request", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    withCards();
    await renderRoom();
    await act(async () => controls.panel?.open('missing note'));
    expect(notes()?.textContent).toContain('This panel stopped working.');
    await act(async () => controls.panel?.open({ note: 3 }));
    expect(notes()?.textContent).toContain('Notes request {"note":3}');
  });
});
