// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { getDefaultStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { callPanelRoomAtom } from '../calls/callStore';
import {
  closeTranscriptPanel,
  openTranscriptPanel,
  transcriptPanelAtom,
} from '../calls/transcription/transcriptPanel';
import type { AgentServer } from '../computer/agentServer';
import { computerServicePreferenceAtom } from '../computer/computerServiceSettings';
import * as membersDrawer from '../members/useMembersDrawer';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';
import { makeUiEvent } from '../ui-actions/testUtils';

// The room's side panels (the computer, a canvas, the call, its live transcript, the members and a
// plugin's panel), opened as their users open them, through the room: the header's controls, an
// agent's live request, and the call store, which the call buttons, a call started elsewhere, the
// call controls' Transcript and a call row's Transcript set.

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
      computer: undefined as { expanded?: boolean; onToggleExpanded?: () => void } | undefined,
      canvas: undefined as { expanded?: boolean; onToggleExpanded?: () => void } | undefined,
      roomId: '!room:example.org',
    },
    mx: {
      getSafeUserId: () => '@alice:example.org',
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
vi.mock('./RoomView', () => ({
  RoomView: (props: RoomViewProps) => {
    state.view = props;
    return <div data-testid="room-view" />;
  },
}));
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
// Two plugins of the build: one whose panel names its room, one whose panels fail or wait for
// their code (a lazy component that never loads).
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
            Component: ({ roomId }: { roomId: string }) => <p>Notes of {roomId}</p>,
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

  it("covers the conversation with a plugin's panel on phones, which has no frame", async () => {
    await renderRoom(ScreenSize.Mobile);
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    expect(notes()).not.toBeNull();
    expect(screen.queryByTestId('room-view')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fill the room with Notes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fold Notes to the edge' })).toBeNull();
    await act(async () => screen.getByRole('button', { name: 'Close Notes' }).click());
    expect(screen.queryByTestId('room-view')).not.toBeNull();
  });

  const conversation = () => screen.queryByTestId('room-view');
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

      // Filling the room, the panel takes the conversation's place until Fill is pressed again.
      await act(async () => frameButton(fill)?.click());
      expect(conversation()).toBeNull();
      expect(frameButton(fill)?.getAttribute('aria-pressed')).toBe('true');
      await act(async () => frameButton(fill)?.click());
      expect(conversation()).not.toBeNull();

      // Folded, it stays open as a tab at the room's edge beside the whole conversation.
      await act(async () => frameButton(fold)?.click());
      expect(conversation()).not.toBeNull();
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
      expect(conversation()).not.toBeNull();

      // Opened again, a panel shows beside the conversation.
      await act(async () => frameButton(fold)?.click());
      await toggleFramed(id);
      await toggleFramed(id);
      expect(frameButton(fill)).not.toBeNull();
    }
  );

  it('fills the room with the computer from its own Expand, as from its Fill', async () => {
    await renderRoom();
    await open('computer');
    await act(async () =>
      screen.getByRole('button', { name: 'Fill the room with Computer' }).click()
    );
    expect(conversation()).toBeNull();
    // The frame and the computer's own Expand share the layout.
    expect(state.computer?.expanded).toBe(true);
    await act(async () => state.computer?.onToggleExpanded?.());
    expect(conversation()).not.toBeNull();
    expect(frameButton('Fill the room with Computer')?.getAttribute('aria-pressed')).toBe('false');
  });

  it("keeps the computer filling the room when an agent shows it again, but shows an agent's new canvas beside", async () => {
    await renderRoom();
    await open('computer');
    await act(async () => state.computer?.onToggleExpanded?.());
    await agentRequest('show_computer');
    expect(state.computer?.expanded).toBe(true);
    expect(conversation()).toBeNull();

    await open('canvas');
    await act(async () => state.canvas?.onToggleExpanded?.());
    expect(conversation()).toBeNull();
    await open('canvas');
    expect(state.canvas?.expanded).toBe(false);
    expect(conversation()).not.toBeNull();
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
});
