// @vitest-environment jsdom

import React from 'react';
import {
  EventType,
  JoinRule,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomState,
} from 'matrix-js-sdk';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { Membership } from '../../../types/matrix/room';
import { RoomAccessControl } from './RoomAccessControl';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ...actual,
    Overlay: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
      open ? children : null,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
  };
});

const mx = {
  getRoom: vi.fn(() => null),
  getUserId: vi.fn(() => '@me:example.org'),
  joinRoom: vi.fn(async () => ({})),
  knockRoom: vi.fn(async () => ({ room_id: '!private:example.org' })),
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as MatrixClient;

const getButton = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === label
  );
  if (!button) throw new Error(`Missing ${label} button`);
  return button;
};

describe('RoomAccessControl request dialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mx.getRoom).mockReturnValue(null);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => <button onClick={access.activate}>Request to join</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not submit when the user cancels', () => {
    act(() => getButton(container, 'Request to join').click());

    act(() => getButton(container, 'Cancel').click());

    expect(mx.knockRoom).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
  });

  it('exposes a named modal, an associated message label, and announced errors', async () => {
    vi.mocked(mx.knockRoom).mockRejectedValueOnce(new Error('Requests are paused'));
    act(() => getButton(container, 'Request to join').click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.tabIndex).toBe(-1);
    const titleId = dialog?.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId!)?.textContent).toBe('Request to join Private room');

    const message = container.querySelector<HTMLTextAreaElement>('textarea[name="reasonInput"]');
    expect(message).not.toBeNull();
    expect(message?.labels?.[0]?.textContent).toBe('Message (optional)');

    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Requests are paused');
  });

  it('moves focus from the trigger into the request dialog', async () => {
    const trigger = getButton(container, 'Request to join');
    trigger.focus();

    act(() => trigger.click());
    await act(async () => {
      await vi.waitFor(() => {
        const dialog = container.querySelector('[role="dialog"]');
        expect(dialog?.contains(document.activeElement)).toBe(true);
      });
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(document.activeElement).not.toBe(trigger);
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  it('starts a fresh access session when the target room changes', async () => {
    const renderJoin = (roomId: string) => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias={roomId}
            roomId={roomId}
            roomName={roomId}
            joinRule={JoinRule.Public}
          >
            {(access) => (
              <button onClick={access.activate}>{access.succeeded ? 'Joined' : 'Join'}</button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    };

    act(() => renderJoin('!first:example.org'));
    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(getButton(container, 'Joined')).toBeDefined();

    act(() => renderJoin('!second:example.org'));
    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mx.joinRoom).toHaveBeenCalledTimes(2);

    expect(mx.joinRoom).toHaveBeenNthCalledWith(1, '!first:example.org', {
      viaServers: undefined,
    });
    expect(mx.joinRoom).toHaveBeenNthCalledWith(2, '!second:example.org', {
      viaServers: undefined,
    });
  });

  it('restores the sent state from summary knock membership without a cached room', () => {
    vi.mocked(mx.getRoom).mockReturnValue(null);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
            membership={Membership.Knock}
          >
            {(access) => (
              <button disabled={access.requested} onClick={access.activate}>
                {access.requested ? 'Request sent' : 'Request to join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Request sent').disabled).toBe(true);
  });

  it('accepts a valid invitation even when the room supports knocking', async () => {
    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
            membership={Membership.Invite}
          >
            {(access) => (
              <button onClick={access.activate}>{access.kind === 'join' ? 'Join' : 'Knock'}</button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(mx.joinRoom).toHaveBeenCalledWith('!private:example.org', {
      viaServers: undefined,
    });
    expect(mx.knockRoom).not.toHaveBeenCalled();
  });

  it('uses a cached invitation when summary membership is unavailable', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      getMyMembership: () => Membership.Invite,
      getJoinRule: () => JoinRule.Invite,
    } as Room);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl roomIdOrAlias="!private:example.org" roomName="Private room">
            {(access) => <button>{access.kind === 'join' ? 'Join' : 'Knock'}</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Join')).toBeDefined();
  });

  it('reveals Join when live membership changes to invite', () => {
    const room = {
      roomId: '!private:example.org',
      getMyMembership: () => Membership.Leave,
      getJoinRule: () => JoinRule.Invite,
    } as Room;
    vi.mocked(mx.getRoom).mockReturnValue(room);
    vi.mocked(mx.on).mockClear();

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias={room.roomId}
            roomName="Private room"
            joinRule={JoinRule.Invite}
            fallback={<button>Access unavailable</button>}
          >
            {(access) => <button>{access.kind === 'join' ? 'Join' : 'Knock'}</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Access unavailable')).toBeDefined();
    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');

    act(() => {
      membershipListener(room, Membership.Invite, Membership.Leave);
    });

    expect(getButton(container, 'Join')).toBeDefined();
  });

  it('prefers explicit discovery over stale access state from a left room', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      roomId: '!private:example.org',
      getMyMembership: () => Membership.Leave,
      getJoinRule: () => JoinRule.Public,
    } as Room);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => <button>{access.kind === 'knock' ? 'Request to join' : 'Join'}</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Request to join')).toBeDefined();
  });

  it('invalidates a sent request when a new self-membership event remains leave', async () => {
    const room = {
      roomId: '!private:example.org',
      getMyMembership: () => Membership.Leave,
      getJoinRule: () => JoinRule.Knock,
    } as Room;
    vi.mocked(mx.getRoom).mockReturnValue(room);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias={room.roomId}
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => (
              <button disabled={access.requested} onClick={access.activate}>
                {access.requested ? 'Request sent' : 'Request to join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    act(() => getButton(container, 'Request to join').click());
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });
    expect(getButton(container, 'Request sent')).toBeDefined();

    const stateListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomStateEvent.Events)?.[1];
    if (typeof stateListener !== 'function') throw new Error('Missing state event listener');

    act(() => {
      stateListener(
        {
          getRoomId: () => room.roomId,
          getType: () => EventType.RoomMember,
          getStateKey: () => '@me:example.org',
          getContent: () => ({ membership: Membership.Leave }),
        } as MatrixEvent,
        { roomId: room.roomId } as RoomState,
        null
      );
    });

    expect(getButton(container, 'Request to join')).toBeDefined();
  });

  it('closes the dialog when sync confirms a request before the endpoint rejects', async () => {
    let rejectRequest: (error: Error) => void = () => undefined;
    vi.mocked(mx.knockRoom).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        })
    );

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => (
              <button disabled={access.requested} onClick={access.activate}>
                {access.requested ? 'Request sent' : 'Request to join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    act(() => getButton(container, 'Request to join').click());
    act(() => container.querySelector('form')?.requestSubmit());

    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');

    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Knock);
    });
    await act(async () => {
      rejectRequest(new Error('Request timed out'));
      await Promise.resolve();
    });

    expect(container.querySelector('form')).toBeNull();
    expect(getButton(container, 'Request sent')).toBeDefined();
  });

  it('does not dismiss an in-flight request from an outside click', async () => {
    vi.mocked(mx.knockRoom).mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep the request in flight while the outside click is exercised.
        })
    );

    act(() => getButton(container, 'Request to join').click());
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelector('form')).not.toBeNull();
    expect(getButton(container, 'Sending request').disabled).toBe(true);
  });

  it('fails closed for missing or unverified access rules', async () => {
    const renderJoin = (joinRule?: JoinRule, membership?: Membership) => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={joinRule}
            membership={membership}
          >
            {(access) => <button onClick={access.activate}>Join</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    };

    act(() => renderJoin());
    expect(container.querySelector('button')).toBeNull();

    act(() => renderJoin(JoinRule.Invite));
    expect(container.querySelector('button')).toBeNull();

    act(() => renderJoin(JoinRule.Invite, Membership.Invite));
    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(mx.joinRoom).toHaveBeenCalledWith('!private:example.org', {
      viaServers: undefined,
    });
  });
});
