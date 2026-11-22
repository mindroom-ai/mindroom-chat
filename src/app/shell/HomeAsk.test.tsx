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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomInput } from '../composer/RoomInput';
import {
  clearRoomInputDrafts,
  getHomeAskDraftKey,
  readHomeAskDestination,
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

/** A room the account may post in; `members` and `joined`, how many are in it, can change. */
type FakeRoom = Room & { members: Record<string, string>; joined: number };
const makeRoom = (roomId: string, name: string, joinedAgents: string[] = [], joined = 3) => {
  const room = {
    roomId,
    name,
    myUserId: ME,
    members: Object.fromEntries(joinedAgents.map((agentId) => [agentId, 'join'])),
    joined,
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

/** The message the composer just reported sent, in the state the server left it in. */
const echo = (status: EventStatus | null, id = '~!eng:txn-1') =>
  ({ status, error: new Error('offline'), getId: () => id } as unknown as MatrixEvent);

const ask = () => lastRoomInputProps.current?.ask;

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
    expect(readHomeAskDestination(ME)).toEqual({
      agentId: HELPER,
      roomId: '!lobby',
      isDirect: false,
    });

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
    expect(readHomeAskDestination(ME)).toBeUndefined();
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
    act(() => {
      lastRoomInputProps.current?.onRoomMessageSent?.('~!eng:txn-1');
    });
    const failedEvent = {
      status: EventStatus.NOT_SENT,
      error: new Error('offline'),
      getId: () => '~!eng:txn-1',
    } as unknown as MatrixEvent;
    act(() => {
      mx.emit(RoomEvent.LocalEchoUpdated, failedEvent, eng, undefined);
    });

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    expect(retryButton).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(navigateRoomThreadDirect).not.toHaveBeenCalled();

    // Clicking Retry resends the exact same event, and confirmation opens its thread.
    fireEvent.click(retryButton);
    expect(mx.resendEvent).toHaveBeenCalledWith(failedEvent, eng);

    const confirmedEvent = {
      status: EventStatus.SENT,
      getId: () => '$confirmed-root',
    } as unknown as MatrixEvent;
    act(() => {
      mx.emit(RoomEvent.LocalEchoUpdated, confirmedEvent, eng, '~!eng:txn-1');
    });
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
    act(() => {
      lastRoomInputProps.current?.onRoomMessageSent?.('~!eng:txn-1');
      ask()?.onSendingChange?.(false);
    });

    // Its message is unconfirmed, then fails: a second question would hide its notice.
    expect(ask()?.canSend()).toBe(false);
    act(() => {
      mx.emit(RoomEvent.LocalEchoUpdated, echo(EventStatus.NOT_SENT), eng, undefined);
    });
    expect(ask()?.canSend()).toBe(false);
    pickLobby();
    expect(lastRoomInputProps.current?.roomId).toBe('!lobby');
    expect(ask()?.canSend()).toBe(false);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    // Deleted, it frees the field.
    act(() => {
      mx.emit(RoomEvent.LocalEchoUpdated, echo(EventStatus.CANCELLED), eng, undefined);
    });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(ask()?.canSend()).toBe(true);
  });

  it('offers no retry of a failed question once its agent has left the room, only Delete', () => {
    const eng = makeRoom('!eng', 'Engineering', [HELPER]);
    const mx = makeClient([eng]);
    const { refresh } = renderAsk(mx, [helperAgent]);
    act(() => {
      lastRoomInputProps.current?.onRoomMessageSent?.('~!eng:txn-1');
    });
    const failed = echo(EventStatus.NOT_SENT);
    act(() => {
      mx.emit(RoomEvent.LocalEchoUpdated, failed, eng, undefined);
    });
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
    expect(readHomeAskDestination(ME)).toEqual({ agentId: HELPER, roomId: '!dm', isDirect: true });

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

    // Picked by its name, as the room it is now, it takes the question.
    fireEvent.click(screen.getByRole('button', { name: 'In Planning' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Planning/ }));
    expect(ask()?.canSend()).toBe(true);
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
