// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { MatrixClient, MatrixEvent, MemoryStore, Room } from 'matrix-js-sdk';
import { RoomSettingsPage } from '../../navigation/roomSettingsState';
import { useOpenRoomSettings } from '../../navigation/useRoomSettingsState';
import { RoomSettingsRenderer } from './RoomSettingsRenderer';

const ME = '@me:test';
const ROOM = '!room:test';
const SPACE = '!space:test';

const rooms = vi.hoisted(() => new Map<string, Room>());

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getRoom: (roomId?: string) => rooms.get(roomId ?? '') ?? null }),
}));
vi.mock('../../ui/Modal500', () => ({
  Modal500: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
}));

/** Each page and tile shows only which one it is and whether it was told it serves a space. */
const { marker } = vi.hoisted(() => ({
  marker:
    (name: string) =>
    ({ space }: { space?: boolean }) =>
      React.createElement('div', { 'data-part': name, 'data-space': String(Boolean(space)) }),
}));
vi.mock('./general/OfflineRoomSettings', () => ({ OfflineRoomSettings: marker('offline') }));
vi.mock('./general/RoomProfileEditor', () => ({ RoomProfileEditor: marker('profile') }));
vi.mock('./general/RoomAvatarTile', () => ({ RoomAvatarTile: marker('avatar') }));
vi.mock('./general/RoomAccessOptions', () => ({ RoomAccessOptions: marker('access') }));
vi.mock('./general/RoomAddresses', () => ({ RoomAddresses: marker('addresses') }));
vi.mock('./general/RoomUpgrade', () => ({ RoomUpgrade: marker('upgrade') }));
vi.mock('./RoomMembersPage', () => ({ RoomMembersPage: marker('members') }));
vi.mock('./permissions/RoomPermissionsPage', () => ({
  RoomPermissionsPage: marker('permissions'),
}));
vi.mock('./RoomPacksPage', () => ({ RoomPacksPage: marker('packs') }));
vi.mock('./developer-tools/RoomDeveloperToolsPage', () => ({
  RoomDeveloperToolsPage: marker('developer-tools'),
}));

const makeRoom = (mx: MatrixClient, roomId: string, type?: string) => {
  const room = new Room(roomId, mx, ME);
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.create',
      state_key: '',
      sender: ME,
      room_id: roomId,
      event_id: `$create${roomId}`,
      content: type ? { type } : {},
    }),
  ]);
  rooms.set(roomId, room);
};

let openSettings: ReturnType<typeof useOpenRoomSettings>;

/** Hands the test the way the app's menus open the dialog. */
function Opener() {
  openSettings = useOpenRoomSettings();
  return null;
}

describe('room and space settings dialog', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const mx = new MatrixClient({
      baseUrl: 'https://test',
      userId: ME,
      store: new MemoryStore(),
    });
    makeRoom(mx, ROOM);
    makeRoom(mx, SPACE, 'm.space');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root.render(
        <Provider store={createStore()}>
          <Opener />
          <RoomSettingsRenderer />
        </Provider>
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    rooms.clear();
    vi.unstubAllGlobals();
  });

  const parts = () =>
    Object.fromEntries(
      [...host.querySelectorAll('[data-part]')].map((node) => [
        node.getAttribute('data-part'),
        node.getAttribute('data-space'),
      ])
    );
  const dialogs = () => host.querySelectorAll('[role="dialog"]');
  const menuEntry = (label: string) =>
    [...host.querySelectorAll('button')].find((button) => button.textContent === label)!;

  it("opens a room's General page with its offline tile", () => {
    act(() => openSettings(ROOM));

    expect(parts()).toMatchObject({ access: 'false', avatar: 'false', offline: 'false' });
  });

  it("opens a room's settings on the page asked for", () => {
    act(() => openSettings(ROOM, RoomSettingsPage.PermissionsPage));

    expect(parts()).toEqual({ permissions: 'false' });
  });

  it('tells the pages of a space they serve a space and leaves out the offline tile', () => {
    act(() => openSettings(SPACE));

    expect(parts()).toMatchObject({ access: 'true', avatar: 'true', upgrade: 'true' });
    expect(parts()).not.toHaveProperty('offline');

    act(() => menuEntry('Permissions').click());
    expect(parts()).toEqual({ permissions: 'true' });
  });

  it("opens the page asked for in the space's settings that are open already", () => {
    act(() => openSettings(SPACE));
    act(() => openSettings(SPACE, RoomSettingsPage.PermissionsPage));

    expect(dialogs()).toHaveLength(1);
    expect(parts()).toEqual({ permissions: 'true' });
  });

  it('shows the page asked for again after moving to another page of the same dialog', () => {
    act(() => openSettings(ROOM, RoomSettingsPage.PermissionsPage));
    act(() => menuEntry('Members').click());
    act(() => openSettings(ROOM, RoomSettingsPage.PermissionsPage));

    expect(dialogs()).toHaveLength(1);
    expect(parts()).toEqual({ permissions: 'false' });
  });
});
