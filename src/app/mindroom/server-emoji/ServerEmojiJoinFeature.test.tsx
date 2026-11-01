import React from 'react';
import { Provider, createStore } from 'jotai';
import type { Store } from 'jotai/vanilla';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { ClientStartupProvider } from '../../pages/client/ClientStartupContext';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { ServerEmojiJoinFeature } from './ServerEmojiJoinFeature';

const ROOM_ID = '!emoji:example.com';
const ALIAS = '#emoji:example.com';

const withKey = {
  'm.homeserver': { base_url: 'https://example.com' },
  'io.mindroom.emoji': { room: ALIAS },
};
const withoutKey = { 'm.homeserver': { base_url: 'https://example.com' } };

type FakeRoom = ReturnType<typeof joinedRoom>;

const joinedRoom = () => ({
  roomId: ROOM_ID,
  getCanonicalAlias: () => ALIAS,
  getMyMembership: () => 'join',
  getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => null }) }),
});

const fakeClient = (rooms: FakeRoom[] = []) => ({
  getRooms: () => rooms,
  getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
  joinRoom: vi.fn(async (_address: string) => ({})),
});

/** The feature in the providers the app gives it; `hasCompletedInitialSync` is the startup flag. */
const featureFor =
  (client: ReturnType<typeof fakeClient>, store: Store, discovery: Record<string, unknown>) =>
  (hasCompletedInitialSync = true) =>
    (
      <MatrixClientProvider value={client as never}>
        <AutoDiscoveryInfoProvider value={discovery as never}>
          <ClientStartupProvider hasCompletedInitialSync={hasCompletedInitialSync}>
            <Provider store={store}>
              <ServerEmojiJoinFeature />
            </Provider>
          </ClientStartupProvider>
        </AutoDiscoveryInfoProvider>
      </MatrixClientProvider>
    );

describe('ServerEmojiJoinFeature', () => {
  let renderer: ReturnType<typeof create> | undefined;

  const render = async (element: React.ReactElement) => {
    await act(async () => {
      renderer = create(element);
    });
  };

  const update = async (element: React.ReactElement) => {
    await act(async () => {
      renderer?.update(element);
    });
  };

  // A reconnect makes the client catch up: the startup flag drops and returns, and the feature's
  // effect runs again with the same room still missing.
  const catchUp = async (feature: ReturnType<typeof featureFor>) => {
    await update(feature(false));
    await update(feature(true));
  };

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.restoreAllMocks();
  });

  it('joins the configured room once when the user is not in it', async () => {
    const client = fakeClient();
    const feature = featureFor(client, createStore(), withKey);

    await render(feature());
    await catchUp(feature);

    expect(client.joinRoom.mock.calls).toEqual([[ALIAS]]);
  });

  it('does not join a room the user is already in', async () => {
    const client = fakeClient([joinedRoom()]);

    await render(featureFor(client, createStore(), withKey)());

    expect(client.joinRoom).not.toHaveBeenCalled();
  });

  it('does nothing without the well-known key', async () => {
    const client = fakeClient();

    await render(featureFor(client, createStore(), withoutKey)());

    expect(client.joinRoom).not.toHaveBeenCalled();
  });

  // AutoDiscovery first renders without the key, so in the app the key arrives after mount.
  it('does not join a joined room when the key arrives after mount', async () => {
    const client = fakeClient([joinedRoom()]);
    const store = createStore();

    await render(featureFor(client, store, withoutKey)());
    await update(featureFor(client, store, withKey)());

    expect(client.joinRoom).not.toHaveBeenCalled();
  });

  it('joins once when the key arrives after mount and the user is not in the room', async () => {
    const client = fakeClient();
    const store = createStore();

    await render(featureFor(client, store, withoutKey)());
    await update(featureFor(client, store, withKey)());

    expect(client.joinRoom.mock.calls).toEqual([[ALIAS]]);
  });

  it('logs a refused join and does not retry it in the same session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = fakeClient();
    client.joinRoom.mockRejectedValue(new Error('M_FORBIDDEN'));
    const feature = featureFor(client, createStore(), withKey);

    await render(feature());
    await catchUp(feature);

    expect(client.joinRoom).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[server-emoji] could not join the server emoji room',
      ALIAS,
      expect.any(Error)
    );
  });

  it('waits for the first sync, then joins a room the user is not in', async () => {
    const client = fakeClient();
    const feature = featureFor(client, createStore(), withKey);

    await render(feature(false));
    expect(client.joinRoom).not.toHaveBeenCalled();

    await update(feature(true));
    expect(client.joinRoom.mock.calls).toEqual([[ALIAS]]);
  });

  it('does not join a room that the first sync brings in', async () => {
    // A cached shell can show before the sync that reveals a room joined from another device.
    const rooms: FakeRoom[] = [];
    const client = fakeClient(rooms);
    const store = createStore();
    const feature = featureFor(client, store, withKey);

    await render(feature(false));
    rooms.push(joinedRoom());
    await act(async () => {
      store.set(allRoomsAtom, { type: 'PUT', roomId: ROOM_ID });
    });
    await update(feature(true));

    expect(client.joinRoom).not.toHaveBeenCalled();
  });
});
