// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import {
  EventStatus,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomInput } from '../composer/RoomInput';
import {
  clearRoomInputDrafts,
  composerUploadItemsAtom,
  getHomeAskDraftKey,
  homeAskDestinationAtomFamily,
  homeAskPendingAtomFamily,
  roomIdToMsgDraftAtomFamily,
} from '../composer/roomInputDrafts';
import { HOME_ASK_VIEW } from '../navigation/conversationView';
import { ROOM_THREAD_MODE_EVENT } from '../matrix/protocol/roomThreadMode';
import { StateEvent } from '../matrix/types/room';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { HomeAsk } from './HomeAsk';
import { startDirectChat, type HomeAgent } from '../sidebar/home/homeAgents';

const ME = '@robin:example.org';
const HELPER = '@mindroom_helper:example.org';
const QUILL = '@mindroom_quill:example.org';
const ECHO_ID = '~!eng:txn-1';

const { lastRoomInputProps, navigateRoom, navigateRoomThreadDirect } = vi.hoisted(() => ({
  lastRoomInputProps: {
    current: undefined as Partial<ComponentProps<typeof RoomInput>> | undefined,
  },
  navigateRoom: vi.fn(),
  navigateRoomThreadDirect: vi.fn(),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
vi.mock('../sidebar/home/homeAgents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sidebar/home/homeAgents')>()),
  startDirectChat: vi.fn(),
}));
vi.mock('../matrix/hooks/useCapabilities', () => ({ useCapabilities: () => ({}) }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom, navigateRoomThreadDirect }),
}));
vi.mock('../composer/RoomInput', () => ({
  RoomInput: (props: ComponentProps<typeof RoomInput>) => {
    lastRoomInputProps.current = props;
    return (
      <div data-testid="room-input" data-room-id={props.roomId}>
        {props.ask?.pickers}
      </div>
    );
  },
}));
vi.mock('../ui/IconTooltip', () => ({
  IconTooltip: ({ children }: { children: (ref: (el: HTMLElement | null) => void) => ReactNode }) =>
    children(() => undefined),
}));
vi.mock('../ui/directional', () => ({
  IsolatedText: ({ text }: { text: string }) => <span>{text}</span>,
  isolateInSentence: (text: string) => text,
  ownDirectionLine: {},
  revealDirectionControls: (text: string) => text,
  PopOut: ({
    anchor,
    content,
    children,
  }: {
    anchor?: unknown;
    content: ReactNode;
    children: ReactNode;
  }) => (
    <>
      {children}
      {anchor ? <div data-testid="menu-popout">{content}</div> : null}
    </>
  ),
}));
vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

type FakeRoom = Room & {
  members: Record<string, string>;
  joined: number;
  echoes: Map<string, MatrixEvent>;
  alias: string | null;
  threadMode?: 'room' | 'thread';
};

const makeRoom = (roomId: string, name: string, joinedAgents: string[] = [], joined = 3) => {
  const room = {
    roomId,
    name,
    myUserId: ME,
    members: Object.fromEntries(joinedAgents.map((id) => [id, 'join'])),
    joined,
    echoes: new Map<string, MatrixEvent>(),
    alias: null as string | null,
    threadMode: undefined as 'room' | 'thread' | undefined,
    getCanonicalAlias: () => room.alias,
    findEventById: (eventId: string) => room.echoes.get(eventId),
    getMyMembership: () => 'join',
    getMxcAvatarUrl: () => null,
    getMember: (userId: string) =>
      room.members[userId] ? { membership: room.members[userId] } : null,
    getMembers: () =>
      Object.entries(room.members).map(([userId, membership]) => ({ userId, membership })),
    getJoinedMemberCount: () => room.joined,
    getInvitedMemberCount: () => 0,
    membersLoaded: () => true,
    currentState: {
      getStateEvents: (type: string, stateKey?: string) =>
        type === ROOM_THREAD_MODE_EVENT && stateKey === '' && room.threadMode
          ? { getContent: () => ({ mode: room.threadMode }) }
          : stateKey === undefined
            ? []
            : null,
    },
    getLiveTimeline: () => ({
      getEvents: () => [],
      getState: () => ({ getStateEvents: () => undefined }),
    }),
    getThreads: () => [],
  };
  return room as unknown as FakeRoom;
};

const makeClient = (rooms: Room[]) =>
  Object.assign(new EventEmitter(), {
    getAccountData: () => ({ getContent: () => ({}) }),
    getSafeUserId: () => ME,
    getUserId: () => ME,
    getRoom: (roomId: string) => rooms.find((r) => r.roomId === roomId) ?? null,
    resendEvent: vi.fn(async () => ({ event_id: '$resent' })),
    cancelPendingEvent: vi.fn(),
  });

const helperAgent: HomeAgent = {
  userId: HELPER,
  name: 'Helper',
  roomIds: ['!eng', '!lobby'],
  defaultRoomId: '!eng',
  lastUsedTs: 200,
};

const quillAgent: HomeAgent = {
  userId: QUILL,
  name: 'Quill',
  roomIds: [],
  defaultRoomId: undefined,
  lastUsedTs: 0,
};

const renderAsk = (
  mx: ReturnType<typeof makeClient>,
  agents: HomeAgent[],
  store = createStore(),
  fileDropContainerRef?: ComponentProps<typeof HomeAsk>['fileDropContainerRef']
) => {
  vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);
  const tree = (shown: HomeAgent[]) => (
    <Provider store={store}>
      <HomeAsk agents={shown} fileDropContainerRef={fileDropContainerRef} />
    </Provider>
  );
  const view = render(tree(agents));
  return { ...view, refresh: (next = [...agents]) => view.rerender(tree(next)) };
};

const sendEcho = (room: FakeRoom, from = lastRoomInputProps.current) => {
  const sent = { status: EventStatus.SENDING, error: new Error('offline'), getId: () => ECHO_ID };
  room.echoes.set(ECHO_ID, sent as unknown as MatrixEvent);
  act(() => from?.ask?.onLocalEcho?.(ECHO_ID, room));
  return sent as unknown as MatrixEvent;
};

const settleEcho = (mx: ReturnType<typeof makeClient>, room: FakeRoom, status: EventStatus) => {
  const sent = room.echoes.get(ECHO_ID)!;
  sent.status = status;
  if (status === EventStatus.CANCELLED) room.echoes.delete(ECHO_ID);
  act(() => {
    mx.emit(RoomEvent.LocalEchoUpdated, sent, room, undefined);
  });
};

const confirmEcho = (mx: ReturnType<typeof makeClient>, room: FakeRoom, eventId: string) => {
  room.echoes.delete(ECHO_ID);
  const confirmed = { status: EventStatus.SENT, getId: () => eventId } as unknown as MatrixEvent;
  act(() => {
    mx.emit(RoomEvent.LocalEchoUpdated, confirmed, room, ECHO_ID);
  });
};

const ask = () => lastRoomInputProps.current?.ask;
const draftValue = (text: string) => [{ type: 'paragraph' as const, children: [{ text }] }];
const storedDestination = () => createStore().get(homeAskDestinationAtomFamily(ME));

beforeEach(() => {
  localStorage.clear();
  clearRoomInputDrafts(ME);
  lastRoomInputProps.current = undefined;
  navigateRoom.mockReset();
  navigateRoomThreadDirect.mockReset();
  vi.mocked(startDirectChat).mockReset();
});

afterEach(() => {
  cleanup();
  clearRoomInputDrafts(ME);
  localStorage.clear();
});

describe('HomeAsk', () => {
  it('persists draft destination across remounts, handles missing/orphaned drafts, and leaves newer tab drafts intact', () => {
    const rooms = [
      makeRoom('!eng', 'Engineering', [HELPER]),
      makeRoom('!lobby', 'Lobby', [HELPER]),
    ];
    const mx = makeClient(rooms);
    const store = createStore();
    const draftAtom = roomIdToMsgDraftAtomFamily(getHomeAskDraftKey(ME));

    const first = renderAsk(mx, [helperAgent, quillAgent], store);
    fireEvent.click(screen.getByRole('button', { name: 'In Engineering' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Lobby/ }));
    act(() => store.set(draftAtom, draftValue('Private note')));
    expect(storedDestination()).toEqual({ agentId: HELPER, roomId: '!lobby', isDirect: false });

    // Remount keeps Lobby for the saved draft; clearing draft clears storage.
    first.unmount();
    const second = renderAsk(mx, [helperAgent, quillAgent], store);
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');
    expect(ask()?.canSend()).toBe(true);
    act(() => store.set(draftAtom, []));
    expect(localStorage.length).toBe(0);
    second.unmount();

    // Another tab stores a newer draft: opening this tab or a new tab does not overwrite it.
    const storageKey = `roomInputDraft:${getHomeAskDraftKey(ME)}`;
    const otherTab = createStore();
    otherTab.set(homeAskDestinationAtomFamily(ME), { agentId: HELPER, roomId: '!lobby' });
    otherTab.set(draftAtom, draftValue('From other tab'));
    const newer = localStorage.getItem(storageKey);
    const third = renderAsk(mx, [helperAgent], createStore());
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');
    expect(localStorage.getItem(storageKey)).toBe(newer);
    third.unmount();

    // Orphaned draft without destination refuses default room and hides room picker until agent picked.
    clearRoomInputDrafts(ME);
    localStorage.setItem(storageKey, JSON.stringify({ draft: draftValue('Orphaned draft') }));
    const orphaned = renderAsk(mx, [helperAgent, quillAgent]);
    expect(screen.getByRole('alert').textContent).toMatch(/no longer works/i);
    expect(screen.queryByTestId('room-input')).toBeNull();
    expect(screen.queryByRole('button', { name: /^In / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose who answers', expanded: false }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Helper/ }));
    expect(lastRoomInputProps.current?.roomId).toBe('!eng');
    orphaned.unmount();

    // Kept draft for a room no longer in mx asks for another choice without showing busy.
    clearRoomInputDrafts(ME);
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        draft: draftValue('Kept note'),
        destination: { agentId: HELPER, roomId: '!gone', isDirect: false },
      })
    );
    renderAsk(mx, [helperAgent]);
    const field = screen.getByRole<HTMLButtonElement>('button', { name: 'Ask Helper anything…' });
    expect(field.disabled).toBe(true);
    expect(field.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('alert').textContent).toMatch(/no longer works/i);
  });

  it('enforces single in-flight send, shows failed-send retry/delete with live canRetry, and navigates on confirmation', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER]);
    const mx = makeClient([eng, makeRoom('!lobby', 'Lobby', [HELPER])]);
    const { refresh } = renderAsk(mx, [helperAgent]);
    const pickLobby = () => {
      fireEvent.click(screen.getByRole('button', { name: /^In / }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: /^Lobby/ }));
    };

    // While sending, blocks second send and picker switches.
    act(() => ask()?.onSendingChange?.(true));
    expect(ask()?.canSend()).toBe(false);
    pickLobby();
    expect(lastRoomInputProps.current?.roomId).toBe('!eng');
    const failed = sendEcho(eng);
    act(() => ask()?.onSendingChange?.(false));

    // Failed echo blocks second send, keeps notice naming original destination even after pickers move.
    settleEcho(mx, eng, EventStatus.NOT_SENT);
    pickLobby();
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');
    expect(ask()?.canSend()).toBe(false);
    expect(screen.getByText('Not sent to helper in Engineering')).toBeTruthy();

    // If agent leaves before Retry is clicked, resend is refused and Retry disappears.
    eng.members[HELPER] = 'leave';
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mx.resendEvent).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    // Agent returns: Retry resends exact event and confirmation opens its thread.
    eng.members[HELPER] = 'join';
    refresh();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mx.resendEvent).toHaveBeenCalledWith(failed, eng);
    confirmEcho(mx, eng, '$confirmed-root');
    expect(navigateRoomThreadDirect).toHaveBeenCalledWith('!eng', '$confirmed-root');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(ask()?.canSend()).toBe(true);
  });

  it('tracks pending sends across Home unmount/remount and keeps failed notice when no agents remain', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER]);
    const mx = makeClient([eng, makeRoom('!lobby', 'Lobby', [HELPER])]);
    const store = createStore();

    // Unmount during sending; local echo created after unmount settles as failed.
    const first = renderAsk(mx, [helperAgent], store);
    const going = lastRoomInputProps.current;
    act(() => going?.ask?.onSendingChange?.(true));
    first.unmount();

    // Remount while still sending holds room and rechecks canSend(room) live.
    const mid = renderAsk(mx, [helperAgent], store);
    expect(ask()?.canSend()).toBe(false);
    expect(ask()?.canSend(eng)).toBe(true);
    eng.members[HELPER] = 'leave';
    expect(ask()?.canSend(eng)).toBe(false);
    eng.members[HELPER] = 'join';
    mid.unmount();

    const failed = sendEcho(eng, going);
    act(() => going?.ask?.onSendingChange?.(false));
    settleEcho(mx, eng, EventStatus.NOT_SENT);
    expect(navigateRoomThreadDirect).not.toHaveBeenCalled();

    // Remount finds failed send; if last agent leaves, listener stays active and Delete still works.
    const again = renderAsk(mx, [helperAgent], store);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    eng.members[HELPER] = 'leave';
    const unfollowed = vi.spyOn(mx, 'removeListener');
    again.refresh([]);
    expect(unfollowed).not.toHaveBeenCalled();
    expect(screen.queryByTestId('room-input')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mx.cancelPendingEvent).toHaveBeenCalledWith(failed);
    settleEcho(mx, eng, EventStatus.CANCELLED);
    expect(store.get(homeAskPendingAtomFamily(ME))).toBeUndefined();
    again.unmount();

    // Confirmed while away clears pending silently without navigating.
    eng.members[HELPER] = 'join';
    store.set(homeAskPendingAtomFamily(ME), {
      state: 'echo',
      roomId: '!eng',
      agentId: HELPER,
      isDirect: false,
      eventId: ECHO_ID,
    });
    renderAsk(mx, [helperAgent], store);
    expect(ask()?.canSend()).toBe(true);
    expect(navigateRoomThreadDirect).not.toHaveBeenCalled();
  });

  it('starts a direct chat, handles busy/waiting/joined/failed states, and blocks sending if a 3rd member joins', async () => {
    const focus = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    try {
      const dm = makeRoom('!dm', 'Planning', [], 1);
      let resolveStart!: (roomId: string) => void;
      vi.mocked(startDirectChat)
        .mockRejectedValueOnce(new Error('offline'))
        .mockReturnValueOnce(new Promise<string>((r) => (resolveStart = r)));

      const rooms: Room[] = [makeRoom('!eng', 'Engineering', [HELPER])];
      const mx = makeClient(rooms);
      const { refresh } = renderAsk(mx, [quillAgent, helperAgent]);

      // First attempt fails and displays error alert.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Ask Quill anything…' }));
      });
      expect(screen.getByRole('alert').textContent).toMatch(/Could not start/i);

      // Second attempt stays on Quill even when Helper ranks first while starting.
      fireEvent.click(screen.getByRole('button', { name: 'Ask Quill anything…' }));
      refresh([helperAgent, quillAgent]);
      expect(screen.getByRole('button', { name: /^Starting/ }).getAttribute('aria-busy')).toBe(
        'true'
      );

      // Resolved before room arrives in mx -> still busy; once room arrives unjoined -> waiting.
      await act(async () => resolveStart('!dm'));
      expect(screen.getByRole('button', { name: /^Starting/ }).getAttribute('aria-busy')).toBe(
        'true'
      );
      rooms.push(dm);
      refresh([helperAgent, quillAgent]);
      const waiting = screen.getByRole<HTMLButtonElement>('button', { name: /^Waiting for Quill/ });
      expect(waiting.disabled).toBe(true);
      expect(screen.queryByRole('alert')).toBeNull();

      // Agent joins -> composer opens and focuses; failed notice names Direct chat until 3rd joins.
      dm.members[QUILL] = 'join';
      dm.joined = 2;
      refresh([helperAgent, quillAgent]);
      expect(lastRoomInputProps.current?.roomId).toBe('!dm');
      expect(ask()?.canSend()).toBe(true);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'In Direct chat' })).toBeTruthy();

      sendEcho(dm);
      settleEcho(mx, dm, EventStatus.NOT_SENT);
      expect(screen.getByText('Not sent to quill in Direct chat')).toBeTruthy();

      // A 3rd member joins: blocks sending, shows alert, and re-labels as the room's name.
      dm.joined = 3;
      expect(ask()?.canSend()).toBe(false);
      refresh([helperAgent, { ...quillAgent, roomIds: ['!dm'] }]);
      expect(screen.getByRole('alert').textContent).toMatch(/no longer works/i);
      expect(screen.getByText('Not sent to quill in Planning')).toBeTruthy();
      settleEcho(mx, dm, EventStatus.CANCELLED);

      // Explicitly picking Planning as a room re-enables sending.
      fireEvent.click(screen.getByRole('button', { name: 'In Planning' }));
      const planning = screen.getByRole('menuitemradio', { name: /^Planning/ });
      expect(planning.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(planning);
      expect(ask()?.canSend()).toBe(true);
    } finally {
      focus.mockRestore();
    }
  });

  it('pins selection when re-selecting the checked agent, disambiguates duplicate names, and restores picker focus', () => {
    const rooms = [
      makeRoom('!eng', 'Planning', [HELPER]),
      makeRoom('!lobby', 'Planning', [HELPER]),
      makeRoom('!other', 'Lobby', [HELPER]),
      makeRoom('!dm', 'Helper', [HELPER], 2),
    ];
    rooms[0]!.alias = '#planning:example.org';
    const helper: HomeAgent = {
      ...helperAgent,
      roomIds: ['!eng', '!lobby', '!other'],
      direct: { roomId: '!dm', waiting: false },
    };
    const twin: HomeAgent = { ...quillAgent, name: 'Helper', roomIds: [] };
    const mx = makeClient(rooms);
    const { refresh } = renderAsk(mx, [helper, twin]);

    // Duplicate rooms are told apart by canonical alias, else roomId.
    fireEvent.click(screen.getByRole('button', { name: 'In Planning' }));
    const roomEntries = screen.getAllByRole('menuitemradio').map((e) => e.textContent);
    expect(roomEntries[0]).toContain('Planning#planning:example.org');
    expect(roomEntries[1]).toContain('Planning!lobby');
    expect(roomEntries[2]).not.toContain('!other');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Direct chat' }));
    expect(lastRoomInputProps.current?.roomId).toBe('!dm');

    // Duplicate agents are told apart by userId; selected row has check icon; re-selecting preserves & pins DM.
    fireEvent.click(screen.getByRole('button', { name: 'Helper answers' }));
    const agentRows = screen.getAllByRole('menuitemradio');
    expect(agentRows[0]?.textContent).toContain(HELPER);
    expect(agentRows[1]?.textContent).toContain(QUILL);
    expect(agentRows[0]?.getAttribute('aria-checked')).toBe('true');
    expect(agentRows[0]?.querySelector('svg')).not.toBeNull();
    expect(agentRows[1]?.querySelector('svg')).toBeNull();
    fireEvent.click(agentRows[0]!);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Helper answers' }));

    // Another agent ranks first: pinned Helper + Direct chat stays put.
    refresh([{ ...twin, lastUsedTs: 900 }, helper]);
    expect(lastRoomInputProps.current?.roomId).toBe('!dm');
    expect(ask()?.isDirect).toBe(true);

    // Switching to stand-in agent restores focus to the agent picker button.
    fireEvent.click(screen.getByRole('button', { name: 'Helper answers' }));
    fireEvent.click(screen.getAllByRole('menuitemradio')[0]!);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Helper answers' }));
    expect(screen.queryByTestId('room-input')).toBeNull();
  });

  it('wires drop zone ref, room thread mode, onRoomMessageSent handoff, and freezes/restores destination on staged files', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER]);
    const lobby = makeRoom('!lobby', 'Lobby', [HELPER]);
    lobby.threadMode = 'room';
    const mx = makeClient([eng, lobby]);
    const store = createStore();

    const first = renderAsk(mx, [helperAgent, quillAgent], store);
    expect(lastRoomInputProps.current?.fileDropContainerRef?.current).toBeInstanceOf(HTMLElement);
    expect(lastRoomInputProps.current?.threadingEnabled).toBe(true);
    expect(lastRoomInputProps.current?.onRoomMessageSent?.(ECHO_ID)).toBe(false);
    expect(lastRoomInputProps.current?.onRoomMessageSent?.('$root-1')).toBe(true);
    expect(navigateRoomThreadDirect).toHaveBeenCalledWith('!eng', '$root-1');

    // Staged file in Home's single list freezes destination against ranking updates (no typed text).
    const homeUploads = composerUploadItemsAtom(getHomeAskDraftKey(ME), HOME_ASK_VIEW);
    const file = new File(['pic'], 'note.png', { type: 'image/png' });
    const item = {
      file,
      originalFile: file,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    act(() => store.set(homeUploads, { type: 'PUT', item: [item] }));
    first.refresh([{ ...quillAgent, lastUsedTs: 999 }, helperAgent]);
    expect(lastRoomInputProps.current?.roomId).toBe('!eng');

    // Switching to an unstarted DM stand-in unmounts RoomInput yet preserves Home's staged files.
    fireEvent.click(screen.getByRole('button', { name: 'Helper answers' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Quill/ }));
    expect(screen.queryByTestId('room-input')).toBeNull();
    expect(store.get(homeUploads)).toEqual([item]);

    // Switching back to Helper -> Lobby (room-mode) disables threading and returns false on send.
    fireEvent.click(screen.getByRole('button', { name: 'Quill answers' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Helper/ }));
    fireEvent.click(screen.getByRole('button', { name: 'In Engineering' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Lobby/ }));
    expect(lastRoomInputProps.current?.threadingEnabled).toBe(false);
    expect(lastRoomInputProps.current?.onRoomMessageSent?.('$room-msg')).toBe(false);
    expect(navigateRoom).toHaveBeenCalledWith('!lobby', '$room-msg');

    // Remount with staged file in Home's list (no typed text) restores Lobby and forwards caller drop ref.
    first.unmount();
    const outerRef = { current: document.createElement('div') };
    const restored = renderAsk(mx, [helperAgent, quillAgent], store, outerRef);
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');
    expect(lastRoomInputProps.current?.fileDropContainerRef).toBe(outerRef);
    expect(store.get(homeUploads)).toEqual([item]);
    restored.unmount();
  });

  it('updates the selected non-DM room picker label and avatar on RoomEvent.Name and room state events', () => {
    let avatarMxc: string | null = null;
    const eng = Object.assign(new EventEmitter(), makeRoom('!eng', 'Engineering', [HELPER]), {
      getMxcAvatarUrl: () => avatarMxc,
    });
    const dm = Object.assign(new EventEmitter(), makeRoom('!dm', 'Helper', [HELPER], 2));
    const mx = Object.assign(makeClient([eng, dm]), {
      getHomeserverUrl: () => 'https://media.example.org',
      mxcUrlToHttp: (mxc: string) => `https://media.example.org/${mxc.slice('mxc://'.length)}`,
    });
    const agentWithDm: HomeAgent = { ...helperAgent, direct: { roomId: '!dm', waiting: false } };

    const view = renderAsk(mx, [agentWithDm]);
    const roomButton = () => screen.getByRole('button', { name: /^In / });
    expect(roomButton().getAttribute('aria-label')).toBe('In Engineering');
    expect(roomButton().querySelector('img')).toBeNull();

    // Renaming via RoomEvent.Name refreshes the picker without agents changing.
    eng.name = 'Platform';
    act(() => {
      eng.emit(RoomEvent.Name, eng);
    });
    expect(roomButton().getAttribute('aria-label')).toBe('In Platform');

    // Renaming via m.room.name state event refreshes the picker.
    eng.name = 'Core Platform';
    act(() => {
      eng.emit(RoomStateEvent.Events, {
        getType: () => StateEvent.RoomName,
        getRoomId: () => '!eng',
      } as unknown as MatrixEvent);
    });
    expect(roomButton().getAttribute('aria-label')).toBe('In Core Platform');

    // Updating the avatar via m.room.avatar state event updates the rendered avatar image.
    avatarMxc = 'mxc://example.org/core-avatar';
    act(() => {
      eng.emit(RoomStateEvent.Events, {
        getType: () => StateEvent.RoomAvatar,
        getRoomId: () => '!eng',
      } as unknown as MatrixEvent);
    });
    expect(roomButton().querySelector('img')?.getAttribute('src')).toBe(
      'https://media.example.org/example.org/core-avatar'
    );

    // Switching to Direct chat detaches listeners from the non-DM room.
    fireEvent.click(roomButton());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Direct chat' }));
    expect(eng.listenerCount(RoomEvent.Name)).toBe(0);
    expect(eng.listenerCount(RoomStateEvent.Events)).toBe(0);

    view.unmount();
  });
});
