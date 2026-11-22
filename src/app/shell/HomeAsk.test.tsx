// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import {
  EventStatus,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { ReactEditor } from 'slate-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomInput } from '../composer/RoomInput';
import {
  clearRoomInputDrafts,
  getHomeAskDraftKey,
  homeAskDestinationAtomFamily,
  roomIdToMsgDraftAtomFamily,
} from '../composer/roomInputDrafts';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { HomeAsk } from './HomeAsk';
import { startDirectChat, type HomeAgent } from './homeAgents';

const ME = '@robin:example.org';
const HELPER = '@mindroom_helper:example.org';
const QUILL = '@mindroom_quill:example.org';

const { lastRoomInputProps, navigateRoom, navigateRoomThreadDirect } = vi.hoisted(() => ({
  lastRoomInputProps: {
    current: undefined as
      | {
          roomId: string;
          onRoomMessageSent?: (eventId: string) => boolean | void;
          ask?: ComponentProps<typeof RoomInput>['ask'];
        }
      | undefined,
  },
  navigateRoom: vi.fn(),
  navigateRoomThreadDirect: vi.fn(),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
vi.mock('./homeAgents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./homeAgents')>()),
  startDirectChat: vi.fn(),
}));
vi.mock('../matrix/hooks/useCapabilities', () => ({ useCapabilities: () => ({}) }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom, navigateRoomThreadDirect }),
}));
vi.mock('../composer/RoomInput', () => ({
  RoomInput: (props: {
    roomId: string;
    onRoomMessageSent?: (eventId: string) => boolean | void;
    ask?: ComponentProps<typeof RoomInput>['ask'];
  }) => {
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
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

/**
 * A room the account may post in; `members` and `joined`, how many are in it, can change, and
 * `echoes` are its messages the server has yet to confirm.
 */
type FakeRoom = Room & {
  members: Record<string, string>;
  joined: number;
  echoes: Map<string, MatrixEvent>;
};
const makeRoom = (roomId: string, name: string, joinedAgents: string[] = [], joined = 3) => {
  const room = {
    roomId,
    name,
    myUserId: ME,
    members: Object.fromEntries(joinedAgents.map((agentId) => [agentId, 'join'])),
    joined,
    echoes: new Map<string, MatrixEvent>(),
    findEventById: (eventId: string) => room.echoes.get(eventId),
    getMyMembership: () => 'join',
    getMxcAvatarUrl: () => null,
    getMember: (userId: string) =>
      room.members[userId] ? { membership: room.members[userId] } : null,
    getJoinedMemberCount: () => room.joined,
    getInvitedMemberCount: () => 0,
    currentState: {
      getStateEvents: (_type: string, stateKey?: string) => (stateKey === undefined ? [] : null),
    },
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: () => undefined }),
    }),
  };
  return room as unknown as FakeRoom;
};

const makeClient = (rooms: Room[]) => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    getSafeUserId: () => ME,
    getUserId: () => ME,
    getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
    resendEvent: vi.fn(async () => ({ event_id: '$resent' })),
    cancelPendingEvent: vi.fn(),
  });
};

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
  store = createStore()
) => {
  vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);
  const tree = (shown: HomeAgent[]) => (
    <Provider store={store}>
      <HomeAsk agents={shown} />
    </Provider>
  );
  const view = render(tree(agents));
  // The agents read again, as a change of a room's state has `useHomeAgents` do.
  return { ...view, refresh: (next = [...agents]) => view.rerender(tree(next)) };
};

const ECHO_ID = '~!eng:txn-1';

/** The composer sends a message in `room` and reports it: there it is, yet to be confirmed. */
const sendEcho = (room: FakeRoom) => {
  const sent = { status: EventStatus.SENDING, error: new Error('offline'), getId: () => ECHO_ID };
  room.echoes.set(ECHO_ID, sent as unknown as MatrixEvent);
  act(() => {
    lastRoomInputProps.current?.onRoomMessageSent?.(ECHO_ID);
  });
  return sent as unknown as MatrixEvent;
};

/** The server's answer to the message: it failed, or was deleted (then it is gone). */
const settleEcho = (mx: ReturnType<typeof makeClient>, room: FakeRoom, status: EventStatus) => {
  const sent = room.echoes.get(ECHO_ID)!;
  sent.status = status;
  if (status === EventStatus.CANCELLED) room.echoes.delete(ECHO_ID);
  act(() => {
    mx.emit(RoomEvent.LocalEchoUpdated, sent, room, undefined);
  });
};

/** The server confirms the message under the ID it gave. */
const confirmEcho = (mx: ReturnType<typeof makeClient>, room: FakeRoom, eventId: string) => {
  room.echoes.delete(ECHO_ID);
  const confirmed = { status: EventStatus.SENT, getId: () => eventId } as unknown as MatrixEvent;
  act(() => {
    mx.emit(RoomEvent.LocalEchoUpdated, confirmed, room, ECHO_ID);
  });
};

const ask = () => lastRoomInputProps.current?.ask;

/** Where the stored Home draft goes, as a reload would find it. */
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
  it('keeps the chosen destination with a saved draft across remounts and requires a pick if missing', () => {
    const rooms = [
      makeRoom('!eng', 'Engineering', [HELPER]),
      makeRoom('!lobby', 'Lobby', [HELPER]),
    ];
    const mx = makeClient(rooms);
    vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);

    const store = createStore();
    const draftAtom = roomIdToMsgDraftAtomFamily(getHomeAskDraftKey(ME));
    const first = render(
      <Provider store={store}>
        <HomeAsk agents={[helperAgent, quillAgent]} />
      </Provider>
    );

    // Pick Lobby instead of default Engineering, then write a draft.
    fireEvent.click(screen.getByRole('button', { name: 'In Engineering' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Lobby/ }));
    act(() => {
      store.set(draftAtom, [{ type: 'paragraph', children: [{ text: 'Private note' }] }]);
    });
    expect(storedDestination()).toEqual({ agentId: HELPER, roomId: '!lobby', isDirect: false });

    // Unmount and remount: Lobby stays selected for the kept draft, not default Engineering.
    first.unmount();
    const second = render(
      <Provider store={store}>
        <HomeAsk agents={[helperAgent, quillAgent]} />
      </Provider>
    );
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');
    expect(lastRoomInputProps.current?.ask?.canSend()).toBe(true);

    // Clearing the draft clears the stored destination.
    act(() => {
      store.set(draftAtom, []);
    });
    expect(localStorage.length).toBe(0);
    second.unmount();

    // A kept draft whose destination is missing, as a reload finds it, refuses to adopt the
    // default room, and offers rooms only once an agent is picked.
    clearRoomInputDrafts(ME);
    localStorage.setItem(
      `roomInputDraft:${getHomeAskDraftKey(ME)}`,
      JSON.stringify({ draft: [{ type: 'paragraph', children: [{ text: 'Orphaned draft' }] }] })
    );
    render(
      <Provider store={createStore()}>
        <HomeAsk agents={[helperAgent, quillAgent]} />
      </Provider>
    );
    expect(screen.getByRole('alert').textContent).toMatch(/no longer works/i);
    expect(screen.queryByTestId('room-input')).toBeNull();
    expect(screen.queryByRole('button', { name: /^In / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose who answers', expanded: false }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Helper/ }));
    expect(screen.getByRole('button', { name: 'In Engineering' })).toBeTruthy();
    expect(lastRoomInputProps.current?.roomId).toBe('!eng');
  });

  it('shows retry actions on a rejected send and navigates once a retry confirms', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER]);
    const mx = makeClient([eng]);
    vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);

    const store = createStore();
    render(
      <Provider store={store}>
        <HomeAsk agents={[helperAgent]} />
      </Provider>
    );

    // Simulate RoomInput creating a local echo, then the server rejecting it.
    const failedEvent = sendEcho(eng);
    settleEcho(mx, eng, EventStatus.NOT_SENT);

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    expect(retryButton).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(navigateRoomThreadDirect).not.toHaveBeenCalled();

    // Clicking Retry resends the exact same event, and confirmation opens its thread.
    fireEvent.click(retryButton);
    expect(mx.resendEvent).toHaveBeenCalledWith(failedEvent, eng);

    confirmEcho(mx, eng, '$confirmed-root');
    expect(navigateRoomThreadDirect).toHaveBeenCalledWith('!eng', '$confirmed-root');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('sends one question at a time: none while one is sent, unconfirmed or failed', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER]);
    const mx = makeClient([eng, makeRoom('!lobby', 'Lobby', [HELPER])]);
    renderAsk(mx, [helperAgent]);
    const pickLobby = () => {
      fireEvent.click(screen.getByRole('button', { name: /^In / }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: /^Lobby/ }));
    };
    expect(ask()?.canSend()).toBe(true);

    // While the composer sends, nothing else goes out and where it goes stays put.
    act(() => ask()?.onSendingChange?.(true));
    expect(ask()?.canSend()).toBe(false);
    pickLobby();
    expect(lastRoomInputProps.current?.roomId).toBe('!eng');
    const sending = ask();
    sendEcho(eng);
    act(() => sending?.onSendingChange?.(false));

    // Its message is unconfirmed, then fails: a second question would hide its notice.
    expect(ask()?.canSend()).toBe(false);
    settleEcho(mx, eng, EventStatus.NOT_SENT);
    expect(ask()?.canSend()).toBe(false);
    pickLobby();
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');
    expect(ask()?.canSend()).toBe(false);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    // Deleted, it frees the field.
    settleEcho(mx, eng, EventStatus.CANCELLED);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(ask()?.canSend()).toBe(true);
  });

  it('offers no retry of a failed question once its agent has left the room, only Delete', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER]);
    const mx = makeClient([eng]);
    const { refresh } = renderAsk(mx, [helperAgent]);
    const failed = sendEcho(eng);
    settleEcho(mx, eng, EventStatus.NOT_SENT);

    // The agent leaves, and Retry is pressed before the page has read that: nothing is sent
    // again, and Retry goes.
    eng.members[HELPER] = 'leave';
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mx.resendEvent).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    // It is offered again only while the agent is back.
    eng.members[HELPER] = 'join';
    refresh();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    eng.members[HELPER] = 'leave';
    refresh([{ ...helperAgent, roomIds: ['!lobby'], defaultRoomId: '!lobby' }]);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByText('Not sent')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mx.cancelPendingEvent).toHaveBeenCalledWith(failed);
  });

  it('takes no question for a chat it started once a third member is in it', async () => {
    const dm = makeRoom('!dm', 'Quill', [], 1);
    const mx = makeClient([dm]);
    vi.mocked(startDirectChat).mockResolvedValue('!dm');
    const { refresh } = renderAsk(mx, [quillAgent]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask Quill anything…' }));
    });
    // The chat is there before `m.direct` lists it, and before Quill's invitation: it waits for
    // Quill, with nothing wrong to say.
    const waiting = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: /^Waiting for Quill/ });
    expect(waiting().disabled).toBe(true);
    dm.members[QUILL] = 'invite';
    refresh();
    expect(waiting().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('room-input')).toBeNull();

    dm.members[QUILL] = 'join';
    dm.joined = 2;
    refresh();
    expect(lastRoomInputProps.current?.roomId).toBe('!dm');
    expect(ask()?.canSend()).toBe(true);
    // It reads as the direct chat it is, not by the room's name, before `m.direct` lists it too.
    expect(screen.getByRole('button', { name: 'In Direct chat' })).toBeTruthy();

    // Someone joins: at the next press already, and as a choice that no longer works after.
    dm.joined = 3;
    expect(ask()?.canSend()).toBe(false);
    refresh();
    expect(screen.getByRole('alert').textContent).toMatch(/no longer works/i);
    expect(ask()?.canSend()).toBe(false);
  });

  it('sends a question written for the direct chat to no room others have joined since', () => {
    const dm = makeRoom('!dm', 'Planning', [HELPER], 2);
    const mx = makeClient([dm]);
    const direct: HomeAgent = {
      ...helperAgent,
      roomIds: ['!dm'],
      direct: { roomId: '!dm', waiting: false },
      defaultRoomId: '!dm',
    };
    const store = createStore();
    const first = renderAsk(mx, [direct], store);
    expect(screen.getByRole('button', { name: 'In Direct chat' })).toBeTruthy();
    act(() => {
      store.set(roomIdToMsgDraftAtomFamily(getHomeAskDraftKey(ME)), [
        { type: 'paragraph', children: [{ text: 'Private note' }] },
      ]);
    });
    expect(ask()?.canSend()).toBe(true);
    expect(storedDestination()).toEqual({ agentId: HELPER, roomId: '!dm', isDirect: true });

    // A third member makes it a room like any other, which Helper still answers in. The draft
    // does not follow it there, on this page or one opened later.
    dm.joined = 3;
    const shared = [{ ...direct, direct: undefined }];
    first.refresh(shared);
    expect(ask()?.canSend()).toBe(false);
    first.unmount();
    renderAsk(mx, shared, store);
    expect(screen.getByRole('alert').textContent).toMatch(/no longer works/i);
    expect(ask()?.canSend()).toBe(false);

    // Picked by its name, as the room it is now and not chosen yet, it takes the question.
    fireEvent.click(screen.getByRole('button', { name: 'In Planning' }));
    const planning = screen.getByRole('menuitemradio', { name: /^Planning/ });
    expect(planning.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(planning);
    expect(ask()?.canSend()).toBe(true);
  });

  it('holds the field while a question is sent, also as the page closes and opens again', () => {
    const lobby = makeRoom('!lobby', 'Lobby', [HELPER]);
    const mx = makeClient([makeRoom('!eng', 'Engineering', [HELPER]), lobby]);
    const store = createStore();
    const pick = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: /^In / }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }));
    };
    const first = renderAsk(mx, [helperAgent], store);
    pick('Lobby');
    const sending = ask();
    act(() => sending?.onSendingChange?.(true));
    first.unmount();

    // Opened again with nothing typed, the field is still where the question goes, and takes
    // neither another question nor another pick.
    renderAsk(mx, [helperAgent], store);
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');
    expect(ask()?.canSend()).toBe(false);
    pick('Engineering');
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');

    // The question on its way is asked again just before its message goes out: not held by
    // itself, it goes only while the agent still answers there.
    expect(ask()?.canSend(true)).toBe(true);
    lobby.members[HELPER] = 'leave';
    expect(ask()?.canSend(true)).toBe(false);
    lobby.members[HELPER] = 'join';

    // The send's end is heard from the composer that went.
    act(() => sending?.onSendingChange?.(false));
    expect(ask()?.canSend()).toBe(true);
    pick('Engineering');
    expect(lastRoomInputProps.current?.roomId).toBe('!eng');
  });

  it('finds the question sent before the page closed: failed, unconfirmed, or over', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER]);
    const mx = makeClient([eng]);
    const store = createStore();
    const sent = (() => {
      const first = renderAsk(mx, [helperAgent], store);
      const echo = sendEcho(eng);
      first.unmount();
      return echo;
    })();

    // It failed while the page was closed: its notice is there, and nothing else goes out.
    sent.status = EventStatus.NOT_SENT;
    const failed = renderAsk(mx, [helperAgent], store);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(ask()?.canSend()).toBe(false);
    failed.unmount();

    // Sent again and still unconfirmed, it holds the field without a notice.
    sent.status = EventStatus.SENDING;
    const unconfirmed = renderAsk(mx, [helperAgent], store);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(ask()?.canSend()).toBe(false);
    unconfirmed.unmount();

    // Confirmed while the page was closed, it is over: the field is free, and nothing opens.
    eng.echoes.delete(ECHO_ID);
    renderAsk(mx, [helperAgent], store);
    expect(ask()?.canSend()).toBe(true);
    expect(navigateRoom).not.toHaveBeenCalled();
    expect(navigateRoomThreadDirect).not.toHaveBeenCalled();
  });

  it('leaves a newer draft of another tab as it is when the page opens', () => {
    const mx = makeClient([
      makeRoom('!eng', 'Engineering', [HELPER]),
      makeRoom('!lobby', 'Lobby', [HELPER]),
    ]);
    const draftAtom = roomIdToMsgDraftAtomFamily(getHomeAskDraftKey(ME));
    const entry = () => localStorage.getItem(`roomInputDraft:${getHomeAskDraftKey(ME)}`);
    const text = (words: string) => [{ type: 'paragraph' as const, children: [{ text: words }] }];
    // This tab wrote a draft; another tab has stored a newer one since.
    const tab = createStore();
    const first = renderAsk(mx, [helperAgent], tab);
    act(() => tab.set(draftAtom, text('Private note')));
    first.unmount();
    const other = createStore();
    other.set(homeAskDestinationAtomFamily(ME), { agentId: HELPER, roomId: '!lobby' });
    other.set(draftAtom, text('For everyone'));
    const newer = entry();

    // This tab's page opens on its own draft, and a new tab's on the stored one: neither writes.
    const again = renderAsk(mx, [helperAgent], tab);
    expect(lastRoomInputProps.current?.roomId).toBe('!eng');
    again.unmount();
    renderAsk(mx, [helperAgent], createStore());
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');
    expect(entry()).toBe(newer);
  });

  it('shows a kept draft for a room the client no longer has as a choice to make again', () => {
    localStorage.setItem(
      `roomInputDraft:${getHomeAskDraftKey(ME)}`,
      JSON.stringify({
        draft: [{ type: 'paragraph', children: [{ text: 'Kept note' }] }],
        destination: { agentId: HELPER, roomId: '!gone', isDirect: false },
      })
    );
    renderAsk(makeClient([makeRoom('!eng', 'Engineering', [HELPER])]), [helperAgent]);
    // No chat is being started: the field says so.
    const field = screen.getByRole<HTMLButtonElement>('button', { name: 'Ask Helper anything…' });
    expect(field.disabled).toBe(true);
    expect(field.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('alert').textContent).toMatch(/no longer works/i);
  });

  it('focuses the chat it started also when `m.direct` lists it before the start is over', async () => {
    const focus = vi.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined);
    try {
      const dm = makeRoom('!dm', 'Quill', [QUILL], 2);
      let started!: (roomId: string) => void;
      vi.mocked(startDirectChat).mockReturnValue(
        new Promise<string>((resolve) => {
          started = resolve;
        })
      );
      const { refresh } = renderAsk(makeClient([dm]), [quillAgent]);
      fireEvent.click(screen.getByRole('button', { name: 'Ask Quill anything…' }));
      // `m.direct` lists the chat, Quill in it: the field is its composer already.
      refresh([{ ...quillAgent, direct: { roomId: '!dm', waiting: false }, defaultRoomId: '!dm' }]);
      expect(lastRoomInputProps.current?.roomId).toBe('!dm');
      expect(focus).not.toHaveBeenCalled();
      await act(async () => started('!dm'));
      expect(focus).toHaveBeenCalledTimes(1);
    } finally {
      focus.mockRestore();
    }
  });

  it('tells agents of one name apart by their IDs', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER, QUILL]);
    const twin: HomeAgent = { ...helperAgent, userId: QUILL, lastUsedTs: 100 };
    renderAsk(makeClient([eng]), [
      helperAgent,
      twin,
      { ...quillAgent, userId: '@mindroom_x:e.org' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Helper answers' }));
    const entries = screen.getAllByRole('menuitemradio').map((entry) => entry.textContent);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toContain(`Helper${HELPER}`);
    expect(entries[1]).toContain(`Helper${QUILL}`);
    expect(entries[2]).not.toContain('@');
  });

  it('restores focus to the agent picker when switching from the composer to the direct-chat stand-in', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER]);
    const mx = makeClient([eng]);
    vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);

    render(
      <Provider store={createStore()}>
        <HomeAsk agents={[helperAgent, quillAgent]} />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Helper answers' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Quill/ }));

    const nextAgentPicker = screen.getByRole('button', { name: 'Quill answers' });
    expect(document.activeElement).toBe(nextAgentPicker);
  });
});
