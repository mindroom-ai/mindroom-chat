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
  keepHomeAskDestination,
  readHomeAskDestination,
  roomIdToMsgDraftAtomFamily,
} from '../composer/roomInputDrafts';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { HomeAsk } from './HomeAsk';
import type { HomeAgent } from './homeAgents';

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

const makeRoom = (roomId: string, name: string, joinedAgents: string[] = []): Room =>
  ({
    roomId,
    name,
    myUserId: ME,
    getMyMembership: () => 'join',
    getMxcAvatarUrl: () => null,
    getMember: (userId: string) => (joinedAgents.includes(userId) ? { membership: 'join' } : null),
    currentState: {
      getStateEvents: (_type: string, stateKey?: string) => (stateKey === undefined ? [] : null),
    },
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: () => undefined }),
    }),
  } as unknown as Room);

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

beforeEach(() => {
  localStorage.clear();
  clearRoomInputDrafts(ME);
  lastRoomInputProps.current = undefined;
  navigateRoom.mockReset();
  navigateRoomThreadDirect.mockReset();
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
    expect(readHomeAskDestination(ME)).toEqual({ agentId: HELPER, roomId: '!lobby' });

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

    // A kept draft whose destination record is missing refuses to adopt the default room.
    store.set(draftAtom, [{ type: 'paragraph', children: [{ text: 'Orphaned draft' }] }]);
    keepHomeAskDestination(ME, undefined);
    render(
      <Provider store={store}>
        <HomeAsk agents={[helperAgent, quillAgent]} />
      </Provider>
    );
    expect(screen.getByRole('alert').textContent).toMatch(/no longer works/i);
    expect(screen.queryByTestId('room-input')).toBeNull();
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
