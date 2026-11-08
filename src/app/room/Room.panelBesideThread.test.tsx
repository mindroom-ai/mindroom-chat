// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { type ComponentType, useEffect } from 'react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { callPanelRoomAtom } from '../calls/callStore';
import { clearCallWindowStore, getCallWindowSettingsAtom } from '../calls/window/callWindowState';
import { openTranscriptPanel, transcriptPanelAtom } from '../calls/transcription/transcriptPanel';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { putSession } from '../matrix/session/sessions';
import { useShownThread } from '../../client-sdk/room';
import { type RoomSidePanelControl, useRoomSidePanel } from '../plugins/sidePanels';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';
import { makeUiEvent } from '../ui-actions/testUtils';

// A plugin's side panel that opens itself beside the thread the room shows (`openBesideThread` of
// useRoomSidePanel), as the plugin's renderer of the thread's root message asks for it as it mounts.

const { mx, room, state, PENDING } = vi.hoisted(() => {
  /** The local echo of a new thread's root, which the server has not confirmed yet. */
  const PENDING = '~!room:example.org:m1';
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const members = [
    { membership: 'join', userId: '@mindroom_helper:example.org', name: 'Helper' },
    { membership: 'join', userId: '@alice:example.org', name: 'Alice' },
  ];
  return {
    state: {
      listeners,
      members,
      config: {
        mindroom: {
          computers: { apiUrl: 'https://computer.example.org' },
          uiActions: { autoOpenFromHomeservers: ['example.org'] },
          canvas: { enabled: true },
        },
      } as ClientConfig,
      /** The room the URL names, and the thread it names. */
      roomId: '!room:example.org',
      thread: undefined as string | undefined,
      view: undefined as RoomViewProps | undefined,
      /** The plugin's renderer of the root message of the thread shown, if the plugin renders it. */
      Root: undefined as ComponentType<{ eventId: string }> | undefined,
      /** What else the conversation shows, such as a card of another thread's root. */
      inView: undefined as React.ReactNode,
      /** Bumped when the conversation's components mount again, as on a switch of view. */
      viewMount: 0,
      /** An event below that the room has not loaded yet. */
      unloaded: undefined as string | undefined,
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
      // The thread of an agent's requests (makeUiEvent) and another, whose roots the room has, a
      // reply in the first, and the root of a new thread, still sending.
      findEventById: (eventId: string) =>
        ['$thread', '$other', '$reply', PENDING].includes(eventId) && eventId !== state.unloaded
          ? {
              getId: () => eventId,
              threadRootId: eventId === '$reply' ? '$thread' : eventId,
              isSending: () => eventId === PENDING,
              getUnsigned: () => ({}),
            }
          : undefined,
      on: () => undefined,
      removeListener: () => undefined,
    },
    PENDING,
  };
});

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(state.thread ? { threadId: state.thread } : {})],
}));
vi.mock('./RoomView', () => ({
  RoomView: (props: RoomViewProps) => {
    state.view = props;
    const { Root } = state;
    return (
      <div data-testid="room-view">
        {state.inView}
        {Root && props.threadId && (
          <Root key={`${props.threadId} ${state.viewMount}`} eventId={props.threadId} />
        )}
      </div>
    );
  },
}));
vi.mock('../members/MembersDrawer', () => ({ MembersDrawer: () => <aside /> }));
vi.mock('../members/useMembersDrawer', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react');
  return { useMembersDrawer: () => useState(false) };
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
  useRoomAgentServers: () => [],
  useBindsOpenIdTokens: () => false,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'threaded', setViewMode: () => undefined }),
}));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: () => undefined, navigateRoomThread: () => undefined }),
}));
// Two plugins, each with a panel that names its request and remembers it is open; the first has
// another, which may open over the members.
vi.mock('../plugins/pluginEntries', () => {
  const panel = (label: string) => ({
    id: 'panel',
    label,
    remember: true,
    Component: ({ request }: { request?: unknown }) => (
      <p>
        {label} request {JSON.stringify(request)}
      </p>
    ),
  });
  return {
    pluginEntries: [
      {
        id: 'notes',
        version: '1.0.0',
        plugin: {
          sidePanels: [panel('Notes'), { ...panel('Over'), id: 'over', opensOverMembers: true }],
        },
      },
      { id: 'other', version: '1.0.0', plugin: { sidePanels: [panel('Other')] } },
    ],
  };
});

importBeforeTests(() => import('./Room'));

const store = getDefaultStore();

/** The renderer of a message of the plugin `notes`, which opens its panel beside the message's thread. */
function Card({ eventId, panel = 'panel' }: { eventId: string; panel?: string }) {
  const openBesideThread = useRoomSidePanel('notes', panel)?.openBesideThread;
  useEffect(() => openBesideThread?.(eventId, `beside ${eventId}`), [eventId, openBesideThread]);
  return null;
}

/** The renderer of a message whose panel may open over the members. */
function OverCard({ eventId }: { eventId: string }) {
  return <Card eventId={eventId} panel="over" />;
}

const notes = () => screen.queryByRole('region', { name: 'Notes' });
const notesRequest = () => screen.queryByText(/^Notes request/)?.textContent;
const frameButton = (name: string) => screen.queryByRole('button', { name });
const click = (name: string) => act(async () => screen.getByRole('button', { name }).click());

let rerenderRoom: (() => Promise<void>) | undefined;
const renderRoom = async (thread?: string, size: ScreenSize = ScreenSize.Desktop) => {
  state.thread = thread;
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
  state.thread = thread;
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
  // The call as a side panel: docked (on desktop it floats by default, beside every panel).
  call: () =>
    act(async () => {
      store.set(getCallWindowSettingsAtom('@alice:example.org'), { mode: 'docked' });
      store.set(callPanelRoomAtom, room.roomId);
    }),
  transcript: () => act(async () => openTranscriptPanel(store, room.roomId)),
  "another plugin's panel": () => act(async () => state.view?.onPanelToggle?.('other/panel')),
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("a plugin's side panel beside the thread shown", () => {
  beforeEach(() => {
    state.Root = Card;
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    store.set(callPanelRoomAtom, undefined);
    clearCallWindowStore('@alice:example.org');
    store.set(transcriptPanelAtom, undefined);
    state.view = undefined;
    state.inView = undefined;
    state.viewMount = 0;
    state.roomId = room.roomId;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('opens as the root of the thread shown asks, beside the conversation', async () => {
    await renderRoom('$a');
    expect(notes()).not.toBeNull();
    expect(notesRequest()).toBe('Notes request "beside $a"');
    expect(frameButton('Fill the room with Notes')?.getAttribute('aria-pressed')).toBe('false');
    expect(state.view?.shownPanel).toBe('notes/panel');
  });

  it("opens as the thread shows when the root's card stays mounted", async () => {
    state.Root = undefined;
    state.inView = <Card eventId="$a" />;
    await renderRoom();
    expect(notes()).toBeNull();
    await showThread('$a');
    expect(notesRequest()).toBe('Notes request "beside $a"');
  });

  it('gives a new openBesideThread as the room shows another thread, but keeps open and close', async () => {
    let control: RoomSidePanelControl | undefined;
    function Keeps() {
      control = useRoomSidePanel('notes', 'panel');
      return null;
    }
    state.Root = undefined;
    state.inView = <Keeps />;
    await renderRoom('$a');
    const before = control;
    await showThread('$b');
    expect(control?.openBesideThread).not.toBe(before?.openBesideThread);
    expect(control?.open).toBe(before?.open);
    expect(control?.close).toBe(before?.close);
  });

  it('does not open on a phone', async () => {
    await renderRoom('$a', ScreenSize.Mobile);
    expect(notes()).toBeNull();
  });

  const others = Object.keys(OTHERS) as (keyof typeof OTHERS)[];
  it.each([
    ...others.map((other) => ({ other, name: 'Notes', Root: Card })),
    // One that may open over the members opens over no other panel.
    ...others
      .filter((other) => other !== 'members')
      .map((other) => ({ other, name: 'Over', Root: OverCard })),
  ])('does not open $name while $other shows', async ({ other, name, Root }) => {
    state.Root = undefined;
    await renderRoom('$thread');
    await OTHERS[other]();
    const before = state.view?.shownPanel;
    expect(before).toBeDefined();
    state.Root = Root;
    await mountAgain();
    expect(screen.queryByRole('region', { name })).toBeNull();
    expect(state.view?.shownPanel).toBe(before);
  });

  it('opens over the members when it may, and the members close', async () => {
    state.Root = undefined;
    await renderRoom('$thread');
    await OTHERS.members();
    expect(state.view?.shownPanel).toBe('members');
    state.Root = OverCard;
    await mountAgain();
    expect(screen.queryByText(/^Over request/)?.textContent).toBe('Over request "beside $thread"');
    expect(state.view?.shownPanel).toBe('notes/over');
    // Closed, it leaves no members behind it.
    await click('Close Over');
    expect(state.view?.shownPanel).toBeUndefined();
  });

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

  it('leaves the thread its chance when the call names a panel the plugin lacks', async () => {
    state.inView = <Card eventId="$a" panel="missing" />;
    await renderRoom('$a');
    expect(notesRequest()).toBe('Notes request "beside $a"');
  });

  /** What the room remembers open, which needs Alice's login in this browser. */
  const remembered = () => Object.keys(localStorage).filter((key) => key.includes(':side-panel/'));
  const signIn = () =>
    putSession({
      baseUrl: 'https://example.org',
      userId: '@alice:example.org',
      deviceId: 'ROOMTEST',
      accessToken: 'room-test',
    });
  /** The call a plugin's code got last, which it may make later. */
  let late: RoomSidePanelControl['openBesideThread'] | undefined;
  function Holds() {
    late = useRoomSidePanel('notes', 'panel')?.openBesideThread;
    return null;
  }

  it("does nothing for a plugin's late call after the room's page has gone", async () => {
    signIn();
    state.Root = undefined;
    state.inView = <Holds />;
    await renderRoom('$a');
    cleanup();
    await act(async () => late?.('$a', 'late'));
    expect(remembered()).toEqual([]);
    // Called while the page shows, the panel opens and the room remembers it.
    await renderRoom('$a');
    await act(async () => late?.('$a', 'now'));
    expect(notesRequest()).toBe('Notes request "now"');
    expect(remembered()).toHaveLength(1);
  });

  it("does nothing for a late call from a room no longer shown, though the next one's route names its thread", async () => {
    signIn();
    state.Root = undefined;
    state.inView = <Holds />;
    await renderRoom('$a');
    const fromFirst = late;
    state.roomId = '!other:example.org';
    await rerenderRoom?.();
    await act(async () => fromFirst?.('$a', 'late'));
    expect(remembered()).toEqual([]);
    expect(notes()).toBeNull();
    // The call of the room shown opens it there.
    await act(async () => late?.('$a', 'here'));
    expect(notesRequest()).toBe('Notes request "here"');
  });

  it('does nothing for a late call from a thread no longer shown', async () => {
    state.Root = undefined;
    state.inView = <Holds />;
    await renderRoom('$a');
    const fromA = late;
    await showThread('$b');
    await act(async () => fromA?.('$a', 'late'));
    expect(notes()).toBeNull();
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

describe('the thread shown, as a plugin component in the room reads it (useShownThread)', () => {
  /** What a plugin's component in the conversation, such as its slot under the room header, read. */
  let shown: string | undefined;
  function Shown() {
    shown = useShownThread();
    return null;
  }

  beforeEach(() => {
    shown = 'not rendered';
    state.Root = undefined;
    state.inView = <Shown />;
  });

  afterEach(() => {
    cleanup();
    state.inView = undefined;
    state.unloaded = undefined;
    localStorage.clear();
  });

  it("is undefined in the room's own timeline", async () => {
    await renderRoom();
    expect(shown).toBeUndefined();
  });

  it("is the thread's root when the address names a reply in it, the thread openBesideThread takes", async () => {
    state.inView = (
      <>
        <Shown />
        <Card eventId="$thread" />
      </>
    );
    await renderRoom('$reply');
    expect(shown).toBe('$thread');
    expect(notesRequest()).toBe('Notes request "beside $thread"');
  });

  it.each([
    { named: 'a reply', address: '$reply', root: '$thread' },
    { named: 'a root', address: '$other', root: '$other' },
  ])(
    "is undefined until the room has $named the address names, then the thread's root",
    async ({ address, root }) => {
      state.unloaded = address;
      await renderRoom(address);
      expect(shown).toBeUndefined();
      state.unloaded = undefined;
      await rerenderRoom?.();
      expect(shown).toBe(root);
    }
  );

  it("is undefined while the server has not confirmed the thread's root", async () => {
    await renderRoom(PENDING);
    expect(shown).toBeUndefined();
  });

  it("is the root a thread's address names, and changes as the room shows another thread or its own timeline", async () => {
    await renderRoom('$thread');
    expect(shown).toBe('$thread');
    await showThread('$other');
    expect(shown).toBe('$other');
    await showThread(undefined);
    expect(shown).toBeUndefined();
  });
});
