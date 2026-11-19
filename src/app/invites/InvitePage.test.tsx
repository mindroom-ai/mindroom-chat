// @vitest-environment jsdom

import { EventEmitter } from 'events';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ClientEvent, RoomEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitePage } from './InvitePage';
import { startClaim, type ClaimOutcome } from './inviteClaim';
import { getHomeRoomPath } from '../routes/pathUtils';
import { holdInviteLink } from './inviteHandoff';

vi.mock('folds', async () => {
  const reactModule = await import('react');
  type Props = { children?: React.ReactNode; [key: string]: unknown };
  const element =
    (tag: string) =>
    ({ children, before, after, as, ...props }: Props) =>
      reactModule.createElement(
        (as as string | undefined) ?? tag,
        props,
        before as React.ReactNode,
        children,
        after as React.ReactNode
      );
  return {
    Box: element('div'),
    Button: element('button'),
    Spinner: () => null,
    Text: element('span'),
  };
});

vi.mock('../account/auth/styles.css', () => ({
  AuthCard: 'auth-card',
  AuthCardContent: 'auth-card-content',
}));

const ROUTER = '@router:example.org';
const ME = '@alice:example.org';
const ROOM = '!room:example.org';
const FRAGMENT = '#r=%40router%3Aexample.org&c=secret-code';

type FakeRoom = {
  roomId: string;
  getMyMembership: () => string;
  getMember: (id: string) => unknown;
};

const fakeRoom = (membership: string, inviter?: string): FakeRoom => ({
  roomId: ROOM,
  getMyMembership: () => membership,
  getMember: (id: string) =>
    id === ME && inviter ? { events: { member: { getSender: () => inviter } } } : null,
});

class FakeClient extends EventEmitter {
  rooms: FakeRoom[] = [];

  sendToDevice = vi.fn(async () => ({}));

  joinRoom = vi.fn(async () => ({}));

  getSafeUserId = () => ME;

  getRooms = () => this.rooms;

  getRoom = (roomId: string) => this.rooms.find((room) => room.roomId === roomId) ?? null;
}

let mx: FakeClient;

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));

vi.mock('./inviteClaim', async () => ({
  ...(await vi.importActual<typeof import('./inviteClaim')>('./inviteClaim')),
  startClaim: vi.fn(),
}));

const startClaimMock = vi.mocked(startClaim);
let report: (outcome: ClaimOutcome) => void;
let stopClaim: ReturnType<typeof vi.fn>;

function LocationProbe() {
  const location = useLocation();
  return <output>{`opened ${location.pathname}`}</output>;
}

let renderer: ReactTestRenderer | undefined;

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

let navigate: ReturnType<typeof useNavigate>;

/** The router's own address while the page shows. */
function AddressProbe() {
  const location = useLocation();
  navigate = useNavigate();
  return <output>{`address ${location.pathname}${location.hash}`}</output>;
}

/** Opens `/invite/<hash>` the way the app does: src/index.tsx holds the link at boot. */
const openLink = (hash: string) => {
  window.history.replaceState(null, '', `/invite/${hash}`);
  holdInviteLink();
};

const renderPage = async (hash = FRAGMENT) => {
  openLink(hash);
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={['/invite/']}>
        <Routes>
          <Route
            path="/invite/"
            element={
              <>
                <InvitePage />
                <AddressProbe />
              </>
            }
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );
  });
  await flush();
};

const textOf = (node: ReactTestInstance | undefined = renderer?.root): string =>
  (node?.children ?? [])
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join(' ');

const buttons = (): string[] =>
  (renderer?.root.findAllByType('button') ?? []).map((button) => textOf(button).trim());

const click = async (label: string) => {
  const button = renderer?.root
    .findAllByType('button')
    .find((candidate) => textOf(candidate).includes(label));
  if (!button) throw new Error(`Missing button: ${label}\n${textOf()}`);
  await act(async () => {
    (button.props as { onClick: () => void }).onClick();
  });
  await flush();
};

const outcome = async (next: ClaimOutcome) => {
  await act(async () => {
    report(next);
  });
  await flush();
};

const ROOM_PATH = `opened ${getHomeRoomPath(ROOM)}`;

beforeEach(() => {
  mx = new FakeClient();
  stopClaim = vi.fn();
  startClaimMock.mockImplementation((_mx, _link, onOutcome) => {
    report = onOutcome;
    return stopClaim as unknown as () => void;
  });
});

afterEach(() => {
  sessionStorage.clear();
  renderer?.unmount();
  renderer = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('InvitePage', () => {
  it('sends nothing on mount', async () => {
    await renderPage();
    expect(startClaimMock).not.toHaveBeenCalled();
    expect(mx.sendToDevice).not.toHaveBeenCalled();
    expect(buttons()).toEqual(['Join']);
    expect(textOf()).toContain('Join a room through');
    // Each ID reads in its own direction, whatever the sentence's.
    const isolated = renderer?.root.findAllByType('bdi').map((node) => textOf(node).trim());
    expect(isolated).toEqual([ROUTER, ME]);
  });

  it('removes the fragment from the address bar', async () => {
    await renderPage();
    expect(window.location.hash).toBe('');
    expect(textOf()).not.toContain('secret-code');
    await click('Join');
    expect(startClaimMock).toHaveBeenCalledWith(
      mx,
      { routerId: ROUTER, code: 'secret-code' },
      expect.any(Function)
    );
    expect(textOf()).toContain('Claiming the invitation');
  });

  it('shows invalid for a bad fragment, and removes it too', async () => {
    await renderPage('#r=router&c=secret-code');
    expect(textOf()).toContain(
      'This invite link is incomplete. Open the link from the mail again.'
    );
    expect(buttons()).toEqual([]);
    expect(textOf()).not.toContain('secret-code');
  });

  it('announces each state in a status region', async () => {
    await renderPage();
    await click('Join');
    const status = renderer?.root.find((node) => node.props.role === 'status');
    expect(textOf(status)).toContain('Claiming the invitation');
  });

  it('starts over for another link opened on the same page', async () => {
    await renderPage();
    await click('Join');
    openLink('#r=%40router%3Aexample.org&c=code-b');
    await act(async () => {
      navigate('/invite/');
    });
    await flush();
    expect(stopClaim).toHaveBeenCalled();
    expect(textOf()).not.toContain('code-b');
    await click('Join');
    expect(startClaimMock).toHaveBeenLastCalledWith(
      mx,
      { routerId: ROUTER, code: 'code-b' },
      expect.any(Function)
    );
  });

  it('shows framed inside a frame', async () => {
    const originalTop = window.top;
    Object.defineProperty(window, 'top', { value: {}, configurable: true });
    try {
      await renderPage();
      expect(textOf()).toContain('Open this page in its own tab to use the invitation.');
      expect(buttons()).toEqual([]);
    } finally {
      Object.defineProperty(window, 'top', { value: originalTop, configurable: true });
    }
  });

  it("joins the router's invitation and opens the room", async () => {
    mx.rooms = [fakeRoom('invite', ROUTER)];
    await renderPage();
    await click('Join');
    await outcome({ status: 'invited', roomId: ROOM });
    expect(mx.joinRoom).toHaveBeenCalledWith(ROOM, { viaServers: ['example.org'] });
    expect(textOf()).toContain(ROOM_PATH);
  });

  it('opens the room when already joined', async () => {
    mx.rooms = [fakeRoom('join')];
    await renderPage();
    await click('Join');
    await outcome({ status: 'invited', roomId: ROOM });
    expect(mx.joinRoom).not.toHaveBeenCalled();
    expect(textOf()).toContain(ROOM_PATH);
  });

  it('does not join an invitation from someone else', async () => {
    mx.rooms = [fakeRoom('invite', '@bas:example.org')];
    await renderPage();
    await click('Join');
    await outcome({ status: 'invited', roomId: ROOM });
    expect(mx.joinRoom).not.toHaveBeenCalled();
    expect(textOf()).toContain(ROOM_PATH);
  });

  it('joins an invitation that arrives after invited', async () => {
    await renderPage();
    await click('Join');
    await outcome({ status: 'invited', roomId: ROOM });
    expect(textOf()).toContain('Joining the room');
    const room = fakeRoom('invite', ROUTER);
    mx.rooms = [room];
    await act(async () => {
      mx.emit(RoomEvent.MyMembership, room, 'invite');
    });
    await flush();
    expect(mx.joinRoom).toHaveBeenCalledWith(ROOM, { viaServers: ['example.org'] });
    expect(textOf()).toContain(ROOM_PATH);
  });

  it('shows rejected when no invitation arrives after invited', async () => {
    vi.useFakeTimers();
    await renderPage();
    await click('Join');
    await outcome({ status: 'invited', roomId: ROOM });
    await act(async () => {
      vi.advanceTimersByTime(19_999);
    });
    expect(textOf()).toContain('Joining the room');
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(textOf()).toContain('This invitation is no longer valid. Ask for a new one.');
    expect(mx.listenerCount(RoomEvent.MyMembership)).toBe(0);
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('shows rejected, retry and offline', async () => {
    await renderPage();
    await click('Join');
    await outcome({ status: 'rejected' });
    expect(textOf()).toContain('This invitation is no longer valid. Ask for a new one.');
    expect(buttons()).toEqual([]);

    renderer?.unmount();
    await renderPage();
    await click('Join');
    await outcome({ status: 'retry' });
    expect(textOf()).toContain('That did not work. Try again in a moment.');
    await click('Try again');
    expect(startClaimMock).toHaveBeenCalledTimes(3);

    await outcome({ status: 'offline' });
    expect(textOf()).toContain('This MindRoom is not answering.');
    expect(buttons()).toEqual([]);
    mx.rooms = [fakeRoom('invite', ROUTER)];
    await outcome({ status: 'invited', roomId: ROOM });
    expect(mx.joinRoom).toHaveBeenCalledWith(ROOM, { viaServers: ['example.org'] });
  });

  it('shows the join error and retries the join', async () => {
    mx.rooms = [fakeRoom('invite', ROUTER)];
    mx.joinRoom.mockRejectedValueOnce(new Error('join refused'));
    await renderPage();
    await click('Join');
    await outcome({ status: 'invited', roomId: ROOM });
    expect(textOf()).toContain('join refused');
    expect(buttons()).toEqual(['Try again']);
    await click('Try again');
    expect(mx.joinRoom).toHaveBeenCalledTimes(2);
    expect(startClaimMock).toHaveBeenCalledTimes(1);
    expect(textOf()).toContain(ROOM_PATH);
  });

  // matrix-js-sdk's order for a room it has not seen: the membership change, then the room is
  // stored, then ClientEvent.Room.
  const firstInvite = async (room: FakeRoom, membershipEvent = true) => {
    await act(async () => {
      if (membershipEvent) mx.emit(RoomEvent.MyMembership, room, 'invite');
      mx.rooms.push(room);
      mx.emit(ClientEvent.Room, room);
    });
    await flush();
  };

  it("joins a first invitation that arrives in the SDK's order after invited", async () => {
    vi.useFakeTimers();
    await renderPage();
    await click('Join');
    await outcome({ status: 'invited', roomId: ROOM });
    await firstInvite(fakeRoom('invite', ROUTER));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mx.joinRoom).toHaveBeenCalledTimes(1);
    expect(mx.joinRoom).toHaveBeenCalledWith(ROOM, { viaServers: ['example.org'] });
    expect(textOf()).not.toContain('no longer valid');
  });

  it('joins when the invitation itself reported invited before the room was stored', async () => {
    vi.useFakeTimers();
    await renderPage();
    await click('Join');
    // The claim's fallback reports inside the membership event, before the SDK stores the room.
    await outcome({ status: 'invited', roomId: ROOM });
    await firstInvite(fakeRoom('invite', ROUTER), false);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mx.joinRoom).toHaveBeenCalledTimes(1);
    expect(textOf()).not.toContain('no longer valid');
  });

  it('checks the invitation again before it retries a failed join', async () => {
    mx.rooms = [fakeRoom('invite', ROUTER)];
    mx.joinRoom.mockRejectedValueOnce(new Error('join refused'));
    await renderPage();
    await click('Join');
    await outcome({ status: 'invited', roomId: ROOM });
    mx.rooms = [fakeRoom('invite', '@bas:example.org')];
    await click('Try again');
    expect(mx.joinRoom).toHaveBeenCalledTimes(1);
    expect(textOf()).toContain(ROOM_PATH);
  });

  it('does not retry a join whose invitation is gone', async () => {
    mx.rooms = [fakeRoom('invite', ROUTER)];
    mx.joinRoom.mockRejectedValueOnce(new Error('join refused'));
    await renderPage();
    await click('Join');
    await outcome({ status: 'invited', roomId: ROOM });
    mx.rooms = [];
    await click('Try again');
    expect(mx.joinRoom).toHaveBeenCalledTimes(1);
    expect(textOf()).toContain('Joining the room');
  });

  it('restores the link it held through sign-in, once', async () => {
    openLink('#r=%40router%3Aexample.org&c=held-code');
    await renderPage('');
    await click('Join');
    expect(startClaimMock).toHaveBeenCalledWith(
      mx,
      { routerId: ROUTER, code: 'held-code' },
      expect.any(Function)
    );
    act(() => renderer?.unmount());
    await renderPage('');
    expect(textOf()).toContain('This invite link is incomplete.');
  });

  it('shows invalid when the link it held has expired', async () => {
    vi.useFakeTimers();
    openLink('#r=%40router%3Aexample.org&c=held-code');
    vi.setSystemTime(Date.now() + 15 * 60_000 + 1);
    await renderPage('');
    expect(textOf()).toContain('This invite link is incomplete.');
    expect(sessionStorage.length).toBe(0);
  });

  it('shows invalid, without crashing, when session storage is denied', async () => {
    const denied = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
    await renderPage('');
    expect(textOf()).toContain('This invite link is incomplete.');
    vi.restoreAllMocks();
  });

  it('stops the claim on unmount', async () => {
    await renderPage();
    await click('Join');
    expect(stopClaim).not.toHaveBeenCalled();
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(stopClaim).toHaveBeenCalled();
  });
});
