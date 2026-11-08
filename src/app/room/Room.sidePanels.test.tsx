// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useLayoutEffect } from 'react';
import { getDefaultStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { callPanelRoomAtom } from '../calls/callStore';
import {
  closeTranscriptPanel,
  openTranscriptPanel,
  transcriptPanelAtom,
} from '../calls/transcription/transcriptPanel';
import { conversationOutOfSightAtom } from '../navigation/conversationCover';
import type { AgentServer } from '../computer/agentServer';
import { computerServicePreferenceAtom } from '../computer/computerServiceSettings';
import * as membersDrawer from '../members/useMembersDrawer';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { putSession } from '../matrix/session/sessions';
import { type RoomSidePanelControl, useRoomSidePanel } from '../plugins/sidePanels';
import { type PanelFrame, usePanelFrame } from '../ui/panels/panelFrameContext';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';
import { makeUiEvent } from '../ui-actions/testUtils';

// The room's side panels (the computer, a canvas, the call, its live transcript, the members and a
// plugin's panel), opened as their users open them, through the room: the header's controls, an
// agent's live request, the call store, which the call buttons, a call started elsewhere, the call
// controls' Transcript and a call row's Transcript set, and a plugin's code in the room (a card in
// the conversation).

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
vi.mock('../calls/transcription/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => null }));
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
/**
 * What the sketch below last saw of its frame, and, while `fillFromEffect`, how often its effect
 * filled the room (20 at most).
 */
const sketchSeen = { frame: undefined as PanelFrame | undefined, fillFromEffect: false, fills: 0 };

/** A plugin's panel that draws its own frame: a card with its own Fill and Hide. */
function Sketch({ roomId }: { roomId: string }) {
  // As the client SDK gives it.
  const frame = usePanelFrame();
  sketchSeen.frame = frame;
  // A plugin may set its layout from an effect that depends on its frame.
  useEffect(() => {
    if (!sketchSeen.fillFromEffect || sketchSeen.fills >= 20) return;
    sketchSeen.fills += 1;
    frame?.setLayout('filled');
  }, [frame]);
  const layout = frame?.layout;
  return (
    <div data-testid="sketch">
      <p>
        Sketch of {roomId}, {layout ?? 'no layout'}
      </p>
      <button
        type="button"
        onClick={() => frame?.setLayout(layout === 'filled' ? 'beside' : 'filled')}
      >
        Fill the room with the sketch
      </button>
      <button type="button" onClick={() => frame?.setLayout('folded')}>
        Hide the sketch
      </button>
    </div>
  );
}

// Two plugins of the build: one whose panels name their room and request and say what they see of
// their frame, the second of which remembers it is open and the third of which draws its own
// frame, and one whose panels fail or wait for their code (a lazy component that never loads).
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
              const layout = usePanelFrame()?.layout;
              if (request === 'missing note') throw new Error('no such note');
              return (
                <>
                  <p>Notes of {roomId}</p>
                  <p>Notes frame {layout ?? 'none'}</p>
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
          { id: 'sketch', label: 'Sketch', frame: 'own', Component: Sketch },
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
          {
            id: 'own',
            label: 'Broken sketch',
            frame: 'own',
            Component: () => {
              throw new Error('no sketch today');
            },
          },
          {
            id: 'later',
            label: 'Later sketch',
            frame: 'own',
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
const { membersOpenAtom } = membersDrawer as unknown as { membersOpenAtom: PrimitiveAtom<boolean> };

const PANELS = ['computer', 'canvas', 'call', 'transcript', 'members'] as const;
type CorePanel = (typeof PANELS)[number];
const TEST_IDS: Record<CorePanel, string> = {
  computer: 'resizable-computer-panel',
  canvas: 'room-canvas-panel',
  call: 'resizable-call-panel',
  transcript: 'resizable-transcript-panel',
  members: 'resizable-members-panel',
};
/** The panels the members stay open behind. */
const MEMBERS_YIELD_TO: readonly CorePanel[] = ['call', 'transcript'];

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
  } else if (panel === 'transcript') {
    await act(async () => openTranscriptPanel(store, room.roomId));
  } else {
    await agentRequest('open_panel', { panel: 'members' });
  }
};

const isOpen = (panel: CorePanel): boolean => {
  if (panel === 'computer') return state.view?.computerOpen === true;
  if (panel === 'canvas') return state.view?.openCanvasId !== undefined;
  if (panel === 'call') return store.get(callPanelRoomAtom) === room.roomId;
  if (panel === 'transcript') return store.get(transcriptPanelAtom)?.roomId === room.roomId;
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
    store.set(transcriptPanelAtom, undefined);
    store.set(membersOpenAtom, false);
    store.set(computerServicePreferenceAtom, null);
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
    sketchSeen.frame = undefined;
    sketchSeen.fillFromEffect = false;
    sketchSeen.fills = 0;
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
    if (first === 'members' && MEMBERS_YIELD_TO.includes(then)) {
      // The members stay open behind the call or its transcript and come back when it closes.
      expect(isOpen('members')).toBe(true);
      await act(async () => {
        store.set(callPanelRoomAtom, undefined);
        closeTranscriptPanel(store, room.roomId);
      });
      expect(shown()).toEqual(['members']);
    } else {
      expect(isOpen(first)).toBe(false);
    }
  });

  it.each(['canvas', 'call', 'transcript', 'members'] as const)(
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

  it("shows the live transcript in the call panel's place, and the call again when it closes", async () => {
    await renderRoom();
    await open('call');
    await open('transcript');
    expect(isOpen('call')).toBe(false);
    expect(shown()).toEqual(['transcript']);

    await act(async () => closeTranscriptPanel(store, room.roomId));
    expect(isOpen('transcript')).toBe(false);
    expect(shown()).toEqual(['call']);
  });

  it("lets another panel take the live transcript's place for good", async () => {
    await renderRoom();
    await open('call');
    await open('transcript');
    await open('canvas');
    expect(shown()).toEqual(['canvas']);
    expect(isOpen('transcript')).toBe(false);
    expect(isOpen('call')).toBe(false);
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
    // Its toggle opens it with no request.
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

  it.each(['call', 'transcript', 'members'] as const)(
    'opens a panel that remembers again only when no other panel of its room is open: %s',
    async (core) => {
      signIn();
      withCards();
      await renderRoom();
      await act(async () => controls.board?.open());
      cleanup();
      if (core === 'call') store.set(callPanelRoomAtom, room.roomId);
      else if (core === 'transcript') openTranscriptPanel(store, room.roomId);
      else store.set(membersOpenAtom, true);
      await renderRoom();
      expect(board()).toBeNull();
      expect(shown()).toEqual([core]);
      // Nor when that panel closes.
      await act(async () => {
        if (core === 'call') store.set(callPanelRoomAtom, undefined);
        else if (core === 'transcript') closeTranscriptPanel(store, room.roomId);
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
    expect(notes()?.textContent).toContain('Notes frame none');
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

  /** Opens a panel with a frame as its users do: the call from the call store. */
  const openFramed = (id: string) =>
    act(async () => {
      if (id !== 'call') state.view?.onPanelToggle?.(id);
      else store.set(callPanelRoomAtom, room.roomId);
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
      await openFramed(id);
      expect(frameButton(fill)?.getAttribute('aria-pressed')).toBe('false');

      // Filling the room, the panel takes the conversation's place until Fill is pressed again;
      // the conversation stays under it as it was.
      await act(async () => frameButton(fill)?.click());
      expect(hidden()).toBe(true);
      expect(frameButton(fill)?.getAttribute('aria-pressed')).toBe('true');
      await act(async () => frameButton(fill)?.click());
      expect(hidden()).toBe(false);

      // Folded, it stays open as a tab at the room's edge beside the whole conversation; the
      // header's toggles mark it as not showing.
      await act(async () => frameButton(fold)?.click());
      expect(hidden()).toBe(false);
      expect(frameButton(unfold)).not.toBeNull();
      expect(frameButton(fill)).toBeNull();
      expect(state.view?.shownPanel).toBeUndefined();

      // Another room has its own layout; back here the panel is still folded.
      await showRoom('!other:example.org');
      expect(frameButton(unfold)).toBeNull();
      await showRoom(room.roomId);
      expect(frameButton(unfold)).not.toBeNull();
      await act(async () => frameButton(unfold)?.click());
      expect(frameButton(fill)?.getAttribute('aria-pressed')).toBe('false');
      expect(hidden()).toBe(false);

      // Closed while folded, here as the members take its place, and opened again, a panel shows
      // beside the conversation.
      await act(async () => frameButton(fold)?.click());
      await act(async () => state.view?.onPanelToggle?.('members'));
      await openFramed(id);
      expect(frameButton(fill)).not.toBeNull();
    }
  );

  it("gives a framed panel's component its frame beside the conversation", async () => {
    await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    expect(notes()?.textContent).toContain('Notes frame beside');
    expect(screen.queryByRole('separator', { name: 'Resize Notes' })).not.toBeNull();
    await act(async () => frameButton('Fill the room with Notes')?.click());
    expect(notes()?.textContent).toContain('Notes frame filled');
  });

  it('covers the conversation on a phone with a framed panel that was folded on a wide screen', async () => {
    const { Room } = await import('./Room');
    let size = ScreenSize.Desktop;
    const ui = () => (
      <ScreenSizeProvider value={size}>
        <Room />
      </ScreenSizeProvider>
    );
    const { rerender } = await act(async () => render(ui()));
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    await act(async () => frameButton('Fold Notes to the edge')?.click());
    expect(hidden()).toBe(false);

    size = ScreenSize.Mobile;
    await act(async () => rerender(ui()));
    expect(notes()).not.toBeNull();
    expect(hidden()).toBe(true);
  });

  const sketch = () => screen.queryByTestId('sketch');
  const sketchButton = (name: string) => screen.getByRole('button', { name });

  it.each([ScreenSize.Desktop, ScreenSize.Mobile])(
    'draws no frame, title, Close or splitter around a panel that draws its own (%s)',
    async (size) => {
      await renderRoom(size);
      await act(async () => state.view?.onPanelToggle?.('notes/sketch'));
      expect(sketch()?.textContent).toContain(`Sketch of ${room.roomId}, beside`);
      expect(state.view?.shownPanel).toBe('notes/sketch');
      expect(screen.queryByRole('region', { name: 'Sketch' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Sketch' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Close Sketch' })).toBeNull();
      expect(screen.queryByRole('separator')).toBeNull();
      expect(frameButton('Fill the room with Sketch')).toBeNull();
      expect(frameButton('Fold Sketch to the edge')).toBeNull();
      expect(screen.queryByTestId('resizable-plugin-panel')).toBeNull();
    }
  );

  it.each([ScreenSize.Desktop, ScreenSize.Mobile])(
    'gives a panel that draws its own frame its layout (%s): it fills the room, and folded it covers nothing',
    async (size) => {
      const phone = size === ScreenSize.Mobile;
      const showRoom = await renderRoom(size);
      await act(async () => state.view?.onPanelToggle?.('notes/sketch'));
      // Beside the conversation, or over it on phones.
      expect(hidden()).toBe(phone);

      await act(async () => sketchButton('Fill the room with the sketch').click());
      expect(sketch()?.textContent).toContain('filled');
      expect(hidden()).toBe(true);
      expect(state.view?.shownPanel).toBe('notes/sketch');
      await act(async () => sketchButton('Fill the room with the sketch').click());
      expect(sketch()?.textContent).toContain('beside');
      expect(hidden()).toBe(phone);

      // Folded to the tab it draws, the conversation lays out as with no panel; the header's toggle
      // marks it as not showing, and unfolds it.
      await act(async () => sketchButton('Hide the sketch').click());
      expect(sketch()?.textContent).toContain('folded');
      expect(hidden()).toBe(false);
      expect(state.view?.shownPanel).toBeUndefined();
      // Each room keeps its own layout.
      await showRoom('!other:example.org');
      expect(sketch()).toBeNull();
      await showRoom(room.roomId);
      expect(sketch()?.textContent).toContain('folded');
      expect(hidden()).toBe(false);
      await act(async () => state.view?.onPanelToggle?.('notes/sketch'));
      expect(sketch()?.textContent).toContain('beside');
      expect(hidden()).toBe(phone);
    }
  );

  it('keeps the frame a panel gets while its layout stays, so an effect that sets it settles', async () => {
    sketchSeen.fillFromEffect = true;
    const showRoom = await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/sketch'));
    expect(sketch()?.textContent).toContain('filled');
    expect(hidden()).toBe(true);
    // As it mounted, and once more for the frame that filled the room.
    expect(sketchSeen.fills).toBe(2);
    const filled = sketchSeen.frame;
    await showRoom(room.roomId);
    expect(sketchSeen.frame).toBe(filled);
    expect(sketchSeen.fills).toBe(2);
  });

  it("acts on the room a panel's frame came from, not on the room shown when it is called", async () => {
    const showRoom = await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/sketch'));
    const there = sketchSeen.frame;
    await showRoom('!other:example.org');
    await act(async () => state.view?.onPanelToggle?.('notes/sketch'));
    expect(sketchSeen.frame).not.toBe(there);
    // A late call of the frame the panel had in the first room changes nothing here.
    await act(async () => there?.setLayout('filled'));
    expect(sketch()?.textContent).toContain('beside');
    expect(hidden()).toBe(false);
    await act(async () => there?.setLayout('folded'));
    expect(sketch()?.textContent).toContain('beside');
  });

  it.each([ScreenSize.Desktop, ScreenSize.Mobile])(
    'frames a panel that draws its own while its code loads, so it can be closed (%s)',
    async (size) => {
      await renderRoom(size);
      await act(async () => state.view?.onPanelToggle?.('broken/later'));
      const panel = screen.getByRole('region', { name: 'Later sketch' });
      expect(panel.textContent).not.toContain('This panel stopped working.');
      await act(async () => screen.getByRole('button', { name: 'Close Later sketch' }).click());
      expect(screen.queryByRole('region', { name: 'Later sketch' })).toBeNull();
      expect(hidden()).toBe(false);
    }
  );

  it.each([ScreenSize.Desktop, ScreenSize.Mobile])(
    'frames a failed panel that draws its own, which says so and can still be closed (%s)',
    async (size) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await renderRoom(size);
      await act(async () => state.view?.onPanelToggle?.('broken/own'));
      const panel = screen.getByRole('region', { name: 'Broken sketch' });
      expect(panel.textContent).toContain('This panel stopped working.');
      await act(async () => screen.getByRole('button', { name: 'Close Broken sketch' }).click());
      expect(screen.queryByRole('region', { name: 'Broken sketch' })).toBeNull();
      expect(hidden()).toBe(false);
    }
  );

  it('unfolds the live transcript when Transcript is pressed again, which still brings back the call on close', async () => {
    await renderRoom();
    await open('call');
    await open('transcript');
    await act(async () => frameButton('Fold Live transcript to the edge')?.click());
    expect(frameButton('Unfold Live transcript')).not.toBeNull();

    await open('transcript');
    expect(frameButton('Unfold Live transcript')).toBeNull();
    expect(frameButton('Fill the room with Live transcript')?.getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(shown()).toEqual(['transcript']);

    await act(async () => closeTranscriptPanel(store, room.roomId));
    expect(shown()).toEqual(['call']);
  });

  it("unfolds a plugin's folded panel from its toggle in the header, with its request, and closes it then", async () => {
    withCards();
    await renderRoom();
    await act(async () => controls.panel?.open({ note: 1 }));
    expect(state.view?.shownPanel).toBe('notes/panel');
    await act(async () => frameButton('Fold Notes to the edge')?.click());
    // Folded, the plugin's code still sees it open.
    expect(controls.panel?.isOpen).toBe(true);

    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    expect(frameButton('Unfold Notes')).toBeNull();
    expect(frameButton('Fill the room with Notes')?.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Notes request {"note":1}')).toBeTruthy();
    expect(state.view?.shownPanel).toBe('notes/panel');

    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    expect(notes()).toBeNull();
  });

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
      ['notes/sketch', 'Sketch'],
      ['broken/panel', 'Broken'],
      ['broken/opaque', 'Opaque'],
      ['broken/waiting', 'Waiting'],
      ['broken/own', 'Broken sketch'],
      ['broken/later', 'Later sketch'],
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
      'broken/own',
      'broken/later',
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
