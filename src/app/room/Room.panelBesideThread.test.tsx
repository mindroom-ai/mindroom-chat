// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { type ComponentType, useEffect } from 'react';
import { getDefaultStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { callPanelRoomAtom } from '../calls/callStore';
import { openTranscriptPanel, transcriptPanelAtom } from '../calls/transcription/transcriptPanel';
import * as membersDrawer from '../members/useMembersDrawer';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { useRoomSidePanel } from '../plugins/sidePanels';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';
import { makeUiEvent } from '../ui-actions/testUtils';

// A plugin's side panel that opens itself beside the thread the room shows (`openBesideThread` of
// useRoomSidePanel), as the plugin's renderer of the thread's root message asks for it as it mounts.

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
      /** The query of the room's URL, which names the thread it shows. */
      search: '',
      view: undefined as RoomViewProps | undefined,
      /** The plugin's renderer of the root message of the thread shown, if the plugin renders it. */
      Root: undefined as ComponentType<{ eventId: string }> | undefined,
      /** What else the conversation shows, such as a card of another thread's root. */
      inView: undefined as React.ReactNode,
      /** Bumped when the conversation's components mount again, as on a switch of view. */
      viewMount: 0,
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
      // The thread of an agent's requests (makeUiEvent), whose root the room has.
      findEventById: (eventId: string) =>
        eventId === '$thread' ? { getId: () => '$thread', isSending: () => false } : undefined,
      on: () => undefined,
      removeListener: () => undefined,
    },
  };
});

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(state.search)],
}));
vi.mock('./RoomView', () => ({
  RoomView: (props: RoomViewProps) => {
    state.view = props;
    const { Root } = state;
    return (
      <div data-testid="room-view">
        {Root && props.threadId && (
          <Root key={`${props.threadId} ${state.viewMount}`} eventId={props.threadId} />
        )}
        {state.inView}
      </div>
    );
  },
}));
vi.mock('../members/MembersDrawer', () => ({ MembersDrawer: () => <aside /> }));
vi.mock('../members/useMembersDrawer', async () => {
  const { atom, useAtom } = await vi.importActual<typeof import('jotai')>('jotai');
  const membersOpenAtom = atom(false);
  return { membersOpenAtom, useMembersDrawer: () => useAtom(membersOpenAtom) };
});
vi.mock('../computer/ComputerPanel', () => ({
  ComputerPanel: () => <div data-testid="computer-panel" />,
}));
vi.mock('../canvas/RoomCanvasPanel', () => ({
  RoomCanvasPanel: () => <div data-testid="room-canvas-panel" />,
}));
vi.mock('../calls/CallPanel', () => ({ CallPanel: () => null }));
vi.mock('../calls/transcription/LiveTranscriptPanel', () => ({ LiveTranscriptPanel: () => null }));
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
// Two plugins, each with a panel that names its request.
vi.mock('../plugins/pluginEntries', () => {
  const panel = (label: string) => ({
    id: 'panel',
    label,
    Component: ({ request }: { request?: unknown }) => (
      <p>
        {label} request {JSON.stringify(request)}
      </p>
    ),
  });
  return {
    pluginEntries: [
      { id: 'notes', version: '1.0.0', plugin: { sidePanels: [panel('Notes')] } },
      { id: 'other', version: '1.0.0', plugin: { sidePanels: [panel('Other')] } },
    ],
  };
});

importBeforeTests(() => import('./Room'));

const store = getDefaultStore();
const { membersOpenAtom } = membersDrawer as unknown as { membersOpenAtom: PrimitiveAtom<boolean> };

/** The renderer of a message of the plugin `notes`, which opens its panel beside the message's thread. */
function Card({ eventId }: { eventId: string }) {
  const openBesideThread = useRoomSidePanel('notes', 'panel')?.openBesideThread;
  useEffect(() => openBesideThread?.(eventId, `beside ${eventId}`), [eventId, openBesideThread]);
  return null;
}

const notes = () => screen.queryByRole('region', { name: 'Notes' });
const notesRequest = () => screen.queryByText(/^Notes request/)?.textContent;
const frameButton = (name: string) => screen.queryByRole('button', { name });
const click = (name: string) => act(async () => screen.getByRole('button', { name }).click());

let rerenderRoom: (() => Promise<void>) | undefined;
const renderRoom = async (thread?: string, size: ScreenSize = ScreenSize.Desktop) => {
  state.search = thread ? `threadId=${encodeURIComponent(thread)}` : '';
  const { Room } = await import('./Room');
  const ui = () => (
    <ScreenSizeProvider value={size}>
      <Room />
    </ScreenSizeProvider>
  );
  const { rerender } = await act(async () => render(ui()));
  rerenderRoom = () => act(async () => rerender(ui()));
};
/** Shows the thread `thread`, or the room's own timeline, as a link or the thread list does. */
const showThread = async (thread: string | undefined) => {
  state.search = thread ? `threadId=${encodeURIComponent(thread)}` : '';
  await rerenderRoom?.();
};
/** Mounts the conversation's components again, as a switch of view does. */
const mountAgain = async () => {
  state.viewMount += 1;
  await rerenderRoom?.();
};

let serial = 0;
/** The other side panels, opened as their users open them. */
const OTHERS = {
  members: () => act(async () => state.view?.onPanelToggle?.('members')),
  computer: () => act(async () => state.view?.onComputerToggle?.()),
  canvas: () =>
    act(async () => {
      state.listeners.get('Room.timeline')?.(
        makeUiEvent(
          { action: 'show_canvas', canvas: { title: 'Choose', html: '<p></p>' } },
          { event_id: `$request-${(serial += 1)}`, origin_server_ts: Date.now() }
        ),
        room,
        false,
        false,
        { liveEvent: true }
      );
    }),
  call: () => act(async () => store.set(callPanelRoomAtom, room.roomId)),
  transcript: () => act(async () => openTranscriptPanel(store, room.roomId)),
  "another plugin's panel": () => act(async () => state.view?.onPanelToggle?.('other/panel')),
};

describe("a plugin's side panel beside the thread shown", () => {
  beforeEach(() => {
    state.config = {
      mindroom: {
        computers: { apiUrl: 'https://computer.example.org' },
        uiActions: { autoOpenFromHomeservers: ['example.org'] },
        canvas: { enabled: true },
      },
    };
    state.Root = Card;
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
    state.view = undefined;
    state.inView = undefined;
    state.viewMount = 0;
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens as the root of the thread shown asks, beside the conversation', async () => {
    await renderRoom('$a');
    expect(notes()).not.toBeNull();
    expect(notesRequest()).toBe('Notes request "beside $a"');
    expect(frameButton('Fill the room with Notes')?.getAttribute('aria-pressed')).toBe('false');
    expect(state.view?.shownPanel).toBe('notes/panel');
  });

  it('does not open on a phone', async () => {
    await renderRoom('$a', ScreenSize.Mobile);
    expect(notes()).toBeNull();
  });

  it.each(Object.keys(OTHERS) as (keyof typeof OTHERS)[])(
    'does not open while %s shows',
    async (other) => {
      state.Root = undefined;
      await renderRoom('$thread');
      await OTHERS[other]();
      const before = state.view?.shownPanel;
      expect(before).toBeDefined();
      state.Root = Card;
      await mountAgain();
      expect(notes()).toBeNull();
      expect(state.view?.shownPanel).toBe(before);
    }
  );

  it('does not open for a thread the room does not show, which leaves the shown thread its chance', async () => {
    state.Root = undefined;
    state.inView = <Card eventId="$b" />;
    await renderRoom();
    await showThread('$a');
    expect(notes()).toBeNull();

    state.Root = Card;
    await mountAgain();
    expect(notesRequest()).toBe('Notes request "beside $a"');
  });

  it('stays closed while the thread shows once the person closed it', async () => {
    await renderRoom('$a');
    await click('Close Notes');
    expect(notes()).toBeNull();
    await mountAgain();
    expect(notes()).toBeNull();
  });

  it('opens again once another thread, or the room, has shown and the thread shows again', async () => {
    await renderRoom('$a');
    await click('Close Notes');
    await showThread('$b');
    expect(notesRequest()).toBe('Notes request "beside $b"');
    await click('Close Notes');
    await showThread('$a');
    expect(notesRequest()).toBe('Notes request "beside $a"');

    await click('Close Notes');
    await showThread(undefined);
    expect(notes()).toBeNull();
    await showThread('$a');
    expect(notesRequest()).toBe('Notes request "beside $a"');
  });

  it('gives a panel that already shows the new request, and leaves it folded or filling the room', async () => {
    await renderRoom();
    await act(async () => state.view?.onPanelToggle?.('notes/panel'));
    await click('Fold Notes to the edge');
    await showThread('$a');
    expect(notesRequest()).toBe('Notes request "beside $a"');
    expect(frameButton('Unfold Notes')).not.toBeNull();

    await click('Unfold Notes');
    await click('Fill the room with Notes');
    await showThread('$b');
    expect(notesRequest()).toBe('Notes request "beside $b"');
    expect(frameButton('Fill the room with Notes')?.getAttribute('aria-pressed')).toBe('true');
  });
});
