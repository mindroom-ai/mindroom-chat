// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { getDefaultStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../config/useClientConfig';
import { callPanelRoomAtom } from '../calls/callStore';
import { clearCallWindowStore, getCallWindowSettingsAtom } from '../calls/window/callWindowState';
import { openTranscriptPanel, transcriptPanelAtom } from '../calls/transcription/transcriptPanel';
import * as membersDrawer from '../members/useMembersDrawer';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { putSession } from '../matrix/session/sessions';
import type { RoomViewProps } from './RoomView';
import { importBeforeTests } from '../../test/utils/importBeforeTests';

// A plugin's side panel that remembers it is open, as its room shows again (after a reload, or a
// switch to another room and back) while the members list is open beside the conversation: one
// with `opensOverMembers` opens again in the list's place and closes the list, as its toggle would;
// one without stays closed behind the list.

const { mx, room, state } = vi.hoisted(() => ({
  state: {
    members: [],
    config: {} as ClientConfig,
    view: undefined as RoomViewProps | undefined,
    roomId: '!room:example.org',
    /** Whether the room is too narrow for the members beside the conversation. */
    overlay: false,
  },
  mx: {
    getSafeUserId: () => '@alice:example.org',
    isInitialSyncComplete: () => true,
    getSyncState: () => 'SYNCING',
    on: () => undefined,
    removeListener: () => undefined,
  },
  room: {
    roomId: '!room:example.org',
    getMember: () => undefined,
    getThread: () => undefined,
    findEventById: () => undefined,
    on: () => undefined,
    removeListener: () => undefined,
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams()],
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
vi.mock('../members/PanelRow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../members/PanelRow')>()),
  useMembersOverlay: () => state.overlay,
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
vi.mock('../config/useClientConfig', () => ({
  useClientConfig: () => state.config,
  useOptionalClientConfig: () => state.config,
}));
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
// A plugin with two panels that remember they are open: one that may open over the members list,
// and one that may not.
vi.mock('../plugins/pluginEntries', () => {
  const panel = (id: string, label: string, opensOverMembers?: true) => ({
    id,
    label,
    remember: true,
    opensOverMembers,
    Component: () => <p>{label} content</p>,
  });
  return {
    pluginEntries: [
      {
        id: 'notes',
        version: '1.0.0',
        plugin: { sidePanels: [panel('over', 'Over', true), panel('board', 'Board')] },
      },
    ],
  };
});

importBeforeTests(() => import('./Room'));

const store = getDefaultStore();
const { membersOpenAtom } = membersDrawer as unknown as { membersOpenAtom: PrimitiveAtom<boolean> };
const OTHER_ROOM = '!other:example.org';

const region = (name: string) => screen.queryByRole('region', { name });
const membersShown = () => screen.queryByTestId('resizable-members-panel') !== null;
const toggle = (id: string) => act(async () => state.view?.onPanelToggle?.(id));

const renderRoom = async (size: ScreenSize = ScreenSize.Desktop) => {
  const { Room } = await import('./Room');
  const ui = () => (
    <ScreenSizeProvider value={size}>
      <Room />
    </ScreenSizeProvider>
  );
  const { rerender } = await act(async () => render(ui()));
  /** Shows another room in the same place, as a link from one room to another does. */
  return async (roomId: string) => {
    state.roomId = roomId;
    await act(async () => rerender(ui()));
  };
};

/** Opens `panel` from its toggle, which the room then remembers, and reloads the page. */
const rememberOpen = async (panel: 'over' | 'board') => {
  await renderRoom();
  await toggle(`notes/${panel}`);
  cleanup();
};

describe("a remembered plugin's side panel and the members list", () => {
  beforeEach(() => {
    // Alice's login in this browser, without which nothing is remembered for her.
    putSession({
      baseUrl: 'https://example.org',
      userId: '@alice:example.org',
      deviceId: 'ROOMTEST',
      accessToken: 'room-test',
    });
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
    clearCallWindowStore('@alice:example.org');
    store.set(transcriptPanelAtom, undefined);
    store.set(membersOpenAtom, false);
    state.view = undefined;
    state.roomId = room.roomId;
    state.overlay = false;
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens one with opensOverMembers again after a reload in place of the members beside the conversation, which close', async () => {
    await rememberOpen('over');
    store.set(membersOpenAtom, true);
    await renderRoom();
    expect(region('Over')).not.toBeNull();
    expect(store.get(membersOpenAtom)).toBe(false);
    // Closed, it leaves no members behind it.
    await act(async () => screen.getByRole('button', { name: 'Close Over' }).click());
    expect(membersShown()).toBe(false);
  });

  it('opens one with opensOverMembers again as its room shows after another, where the members opened, and the members take its place again from their toggle', async () => {
    const showRoom = await renderRoom();
    await toggle('notes/over');
    await showRoom(OTHER_ROOM);
    await toggle('members');
    expect(membersShown()).toBe(true);

    await showRoom(room.roomId);
    expect(region('Over')).not.toBeNull();
    expect(store.get(membersOpenAtom)).toBe(false);

    await toggle('members');
    expect(region('Over')).toBeNull();
    expect(membersShown()).toBe(true);
  });

  it('keeps one without opensOverMembers closed behind the members beside the conversation', async () => {
    await rememberOpen('board');
    store.set(membersOpenAtom, true);
    const showRoom = await renderRoom();
    expect(region('Board')).toBeNull();
    expect(membersShown()).toBe(true);
    await showRoom(OTHER_ROOM);
    await showRoom(room.roomId);
    expect(region('Board')).toBeNull();
    expect(store.get(membersOpenAtom)).toBe(true);
  });

  // The computer and a canvas belong to the conversation they opened in: none is open yet as a
  // room shows.
  it.each(['call', 'transcript'] as const)(
    'keeps one with opensOverMembers closed while the %s is open',
    async (other) => {
      await rememberOpen('over');
      store.set(membersOpenAtom, true);
      // The call as a side panel: docked (on desktop it floats by default, beside every panel).
      if (other === 'call') {
        store.set(getCallWindowSettingsAtom('@alice:example.org'), { mode: 'docked' });
        store.set(callPanelRoomAtom, room.roomId);
      } else openTranscriptPanel(store, room.roomId);
      await renderRoom();
      expect(region('Over')).toBeNull();
      expect(store.get(membersOpenAtom)).toBe(true);
    }
  );

  it.each(
    [
      { where: 'on a phone', size: ScreenSize.Mobile, overlay: false },
      { where: 'in a room too narrow for them beside it', size: ScreenSize.Desktop, overlay: true },
    ].flatMap((place) => (['Over', 'Board'] as const).map((label) => ({ ...place, label })))
  )(
    'opens $label again over the members $where, and leaves them to the navigation',
    async ({ size, overlay, label }) => {
      await rememberOpen(label === 'Over' ? 'over' : 'board');
      state.overlay = overlay;
      store.set(membersOpenAtom, true);
      await renderRoom(size);
      expect(region(label)).not.toBeNull();
      expect(store.get(membersOpenAtom)).toBe(true);
    }
  );

  it('closes the members only as it opens again: opened elsewhere afterwards, they stay open behind it', async () => {
    await rememberOpen('over');
    store.set(membersOpenAtom, true);
    await renderRoom();
    expect(store.get(membersOpenAtom)).toBe(false);
    // As the setting changes in another tab.
    await act(async () => store.set(membersOpenAtom, true));
    expect(region('Over')).not.toBeNull();
    expect(store.get(membersOpenAtom)).toBe(true);
  });
});
