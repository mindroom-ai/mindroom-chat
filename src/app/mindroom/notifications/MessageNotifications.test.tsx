// @vitest-environment jsdom
import { EventEmitter } from 'events';
import React from 'react';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent, RoomEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { ClientStartupProvider } from '../../pages/client/ClientStartupContext';
import { MessageNotificationsFeature } from './MessageNotifications';
import { playChime } from './playChime';

const navigation = vi.hoisted(() => ({ room: vi.fn(), thread: vi.fn() }));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('./playChime', () => ({ playChime: vi.fn(() => Promise.resolve()) }));
vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigation.room,
    navigateRoomThread: navigation.thread,
  }),
}));

const ME = '@me:example.org';
const ROOM = '!room:example.org';

type Actions = { notify: boolean; tweaks?: { sound?: string; highlight?: boolean } };

class FakeNotification {
  static permission = 'granted';

  static shown: FakeNotification[] = [];

  onclick: (() => void) | null = null;

  close = vi.fn();

  constructor(public title: string, public options: NotificationOptions) {
    FakeNotification.shown.push(this);
  }
}

const room = {
  roomId: ROOM,
  name: 'Launch War Room',
  getMyMembership: () => 'join',
  getMember: (userId: string) =>
    userId === '@maya:example.org' ? { name: 'Maya Chen', rawDisplayName: 'Maya Chen' } : null,
  findEventById: () => undefined,
  hasUserReadEvent: () => false,
};

let actions: Actions = { notify: true, tweaks: { sound: 'default' } };
const client = Object.assign(new EventEmitter(), {
  getUserId: () => ME,
  getRoom: (roomId: string) => (roomId === ROOM ? room : null),
  getRooms: () => [room],
  getPushActionsForEvent: () => actions,
}) as unknown as MatrixClient;

const message = (content: IContent) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: ROOM,
    sender: '@maya:example.org',
    event_id: `$e${Math.random()}`,
    origin_server_ts: Date.now(),
    content,
  });

const arrive = (event: MatrixEvent, liveEvent = true) =>
  act(() => {
    client.emit(RoomEvent.Timeline, event, room, false, false, { liveEvent } as never);
  });

let renderer: ReactTestRenderer | undefined;
const render = (path: string, synced = true) =>
  act(() => {
    renderer = create(
      <Provider store={createStore()}>
        <MatrixClientProvider value={client}>
          <ClientStartupProvider hasCompletedInitialSync={synced}>
            <MemoryRouter
              initialEntries={[path]}
              future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
            >
              <MessageNotificationsFeature />
            </MemoryRouter>
          </ClientStartupProvider>
        </MatrixClientProvider>
      </Provider>
    );
  });

describe('MessageNotificationsFeature', () => {
  beforeEach(() => {
    FakeNotification.shown = [];
    actions = { notify: true, tweaks: { sound: 'default' } };
    vi.stubGlobal('Notification', FakeNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(playChime).mockClear();
    navigation.room.mockClear();
    navigation.thread.mockClear();
  });

  it('notifies for a message in another room and opens its thread on click', () => {
    render('/home/');
    arrive(
      message({
        msgtype: 'm.text',
        body: 'Can you check the numbers?',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      })
    );

    expect(FakeNotification.shown).toHaveLength(1);
    const [note] = FakeNotification.shown;
    expect(note.title).toBe('Launch War Room');
    expect(note.options).toMatchObject({
      body: 'Maya Chen: Can you check the numbers?',
      tag: ROOM,
      silent: true,
    });
    expect(playChime).toHaveBeenCalledTimes(1);

    act(() => note.onclick?.());
    expect(note.close).toHaveBeenCalled();
    expect(navigation.thread).toHaveBeenCalledWith(ROOM, '$root');
  });

  it('opens the room for a message outside threads', () => {
    render('/home/');
    arrive(message({ msgtype: 'm.text', body: 'Standup moves to 11:00.' }));
    act(() => FakeNotification.shown[0].onclick?.());
    expect(navigation.room).toHaveBeenCalledWith(ROOM);
  });

  it('stays quiet for the room on screen, before the first sync and for history', () => {
    render(`/home/${encodeURIComponent(ROOM)}/`);
    arrive(message({ msgtype: 'm.text', body: 'seen already' }));
    expect(FakeNotification.shown).toHaveLength(0);
    act(() => renderer?.unmount());

    render('/home/', false);
    arrive(message({ msgtype: 'm.text', body: 'during startup' }));
    act(() => renderer?.unmount());

    render('/home/');
    arrive(message({ msgtype: 'm.text', body: 'paginated' }), false);
    expect(FakeNotification.shown).toHaveLength(0);
    expect(playChime).not.toHaveBeenCalled();
  });

  it('notifies for the room on screen when the window has no focus', () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    render(`/home/${encodeURIComponent(ROOM)}/`);
    arrive(message({ msgtype: 'm.text', body: 'while away' }));
    expect(FakeNotification.shown).toHaveLength(1);
  });

  it('chimes only when the push actions ask for a sound, and respects the settings', () => {
    actions = { notify: true };
    render('/home/');
    arrive(message({ msgtype: 'm.text', body: 'silent rule' }));
    expect(FakeNotification.shown).toHaveLength(1);
    expect(playChime).not.toHaveBeenCalled();
    act(() => renderer?.unmount());

    localStorage.setItem(
      'settings',
      JSON.stringify({ showNotifications: false, isNotificationSounds: false })
    );
    actions = { notify: true, tweaks: { sound: 'default' } };
    render('/home/');
    arrive(message({ msgtype: 'm.text', body: 'settings off' }));
    expect(FakeNotification.shown).toHaveLength(1);
    expect(playChime).not.toHaveBeenCalled();
  });
});
