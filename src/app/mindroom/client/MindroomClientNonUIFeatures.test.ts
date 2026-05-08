import React from 'react';
import { Provider, createStore } from 'jotai';
import type { Store } from 'jotai/vanilla';
import type { MatrixClient } from 'matrix-js-sdk';
import { MemoryRouter } from 'react-router-dom';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { Membership } from '../../../types/matrix/room';
import { MindroomInviteNotifications } from './MindroomClientNonUIFeatures';

type MockRoom = {
  roomId: string;
  getMyMembership: () => Membership;
};

type AudioMock = HTMLAudioElement & {
  play: ReturnType<typeof vi.fn>;
};

const createInviteRoom = (roomId: string): MockRoom => ({
  roomId,
  getMyMembership: () => Membership.Invite,
});

const createMatrixClient = (inviteRoomIds: string[]): MatrixClient =>
  ({
    getRooms: vi.fn(() => inviteRoomIds.map(createInviteRoom)),
    getSyncState: vi.fn(() => 'SYNCING'),
  } as unknown as MatrixClient);

const setInvites = (store: Store, roomIds: string[]) => {
  store.set(allInvitesAtom, { type: 'INITIALIZE', rooms: roomIds });
};

const addInvite = (store: Store, roomId: string) => {
  store.set(allInvitesAtom, { type: 'PUT', roomId });
};

const removeInvite = (store: Store, roomId: string) => {
  store.set(allInvitesAtom, { type: 'DELETE', roomId });
};

const renderInviteNotifications = (
  store: Store,
  mx: MatrixClient,
  audioElement: AudioMock
): ReactTestRenderer =>
  create(
    React.createElement(
      Provider,
      { store },
      React.createElement(
        MatrixClientProvider,
        { value: mx },
        React.createElement(
          MemoryRouter,
          {
            future: {
              v7_relativeSplatPath: true,
              v7_startTransition: true,
            },
          },
          React.createElement(MindroomInviteNotifications)
        )
      )
    ),
    {
      createNodeMock: (element) => (element.type === 'audio' ? audioElement : null),
    }
  );

describe('MindroomInviteNotifications', () => {
  let renderer: ReactTestRenderer | undefined;
  let play: ReturnType<typeof vi.fn>;
  let audioElement: AudioMock;
  let notificationMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    play = vi.fn(() => Promise.resolve());
    audioElement = { play } as unknown as AudioMock;
    notificationMock = vi.fn(() => ({ close: vi.fn() }));
    Object.defineProperty(notificationMock, 'permission', {
      configurable: true,
      value: 'granted',
    });
    vi.stubGlobal('window', {
      Notification: notificationMock,
      closed: false,
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not chime when stale atom invites are replaced by the current client hydration', async () => {
    const store = createStore();
    setInvites(store, ['!stale:old']);
    const mx = createMatrixClient(['!cached-a:new', '!cached-b:new']);

    await act(async () => {
      renderer = renderInviteNotifications(store, mx, audioElement);
    });
    expect(renderer?.root.findByType('audio').props.preload).toBe('none');

    await act(async () => {
      setInvites(store, ['!cached-a:new', '!cached-b:new']);
    });

    expect(play).not.toHaveBeenCalled();
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it('chimes when an empty cold-open receives a new live invite', async () => {
    const store = createStore();
    const mx = createMatrixClient([]);

    await act(async () => {
      renderer = renderInviteNotifications(store, mx, audioElement);
    });

    await act(async () => {
      addInvite(store, '!new-live:server');
    });

    expect(play).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledWith(
      'Invitation',
      expect.objectContaining({
        body: 'You have 1 new invitation request.',
        silent: true,
      })
    );
  });

  it('does not chime for startup hydration of a pre-existing invite', async () => {
    const roomId = '!cached-invite:server';
    const store = createStore();
    const mx = createMatrixClient([roomId]);

    await act(async () => {
      renderer = renderInviteNotifications(store, mx, audioElement);
    });

    await act(async () => {
      setInvites(store, [roomId]);
    });

    expect(play).not.toHaveBeenCalled();
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it('chimes when the same room re-invites after disappearing from current invites', async () => {
    const roomId = '!repeat-invite:server';
    const store = createStore();
    const mx = createMatrixClient([roomId]);

    await act(async () => {
      renderer = renderInviteNotifications(store, mx, audioElement);
    });
    await act(async () => {
      addInvite(store, roomId);
    });
    await act(async () => {
      removeInvite(store, roomId);
    });
    await act(async () => {
      addInvite(store, roomId);
    });

    expect(play).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledOnce();
  });

  it('baselines the new Matrix client on account switch before invite hydration arrives', async () => {
    const store = createStore();
    setInvites(store, ['!alice-stale:old']);
    const aliceMx = createMatrixClient(['!alice-stale:old']);
    const bobMx = createMatrixClient(['!bob-cached:new']);

    await act(async () => {
      renderer = renderInviteNotifications(store, aliceMx, audioElement);
    });
    await act(async () => {
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            MatrixClientProvider,
            { value: bobMx },
            React.createElement(
              MemoryRouter,
              {
                future: {
                  v7_relativeSplatPath: true,
                  v7_startTransition: true,
                },
              },
              React.createElement(MindroomInviteNotifications)
            )
          )
        )
      );
    });
    await act(async () => {
      setInvites(store, ['!bob-cached:new']);
    });

    expect(play).not.toHaveBeenCalled();
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it('does not let stale account-switch atom IDs poison the new client baseline', async () => {
    const sharedRoomId = '!shared:server';
    const store = createStore();
    setInvites(store, [sharedRoomId]);
    const aliceMx = createMatrixClient([sharedRoomId]);
    const bobMx = createMatrixClient([]);

    await act(async () => {
      renderer = renderInviteNotifications(store, aliceMx, audioElement);
    });
    await act(async () => {
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            MatrixClientProvider,
            { value: bobMx },
            React.createElement(
              MemoryRouter,
              {
                future: {
                  v7_relativeSplatPath: true,
                  v7_startTransition: true,
                },
              },
              React.createElement(MindroomInviteNotifications)
            )
          )
        )
      );
    });

    expect(play).not.toHaveBeenCalled();
    expect(notificationMock).not.toHaveBeenCalled();

    await act(async () => {
      addInvite(store, sharedRoomId);
    });

    expect(play).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledOnce();
  });

  it('does not count unrelated stale account-switch atom IDs with a different live invite', async () => {
    const store = createStore();
    setInvites(store, ['!stale-a:old', '!stale-b:old']);
    const aliceMx = createMatrixClient(['!stale-a:old', '!stale-b:old']);
    const bobMx = createMatrixClient([]);

    await act(async () => {
      renderer = renderInviteNotifications(store, aliceMx, audioElement);
    });
    await act(async () => {
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            MatrixClientProvider,
            { value: bobMx },
            React.createElement(
              MemoryRouter,
              {
                future: {
                  v7_relativeSplatPath: true,
                  v7_startTransition: true,
                },
              },
              React.createElement(MindroomInviteNotifications)
            )
          )
        )
      );
    });
    await act(async () => {
      addInvite(store, '!new-live:server');
    });

    expect(play).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledOnce();
    expect(notificationMock).toHaveBeenCalledWith(
      'Invitation',
      expect.objectContaining({
        body: 'You have 1 new invitation request.',
      })
    );
  });
});
