// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, type MatrixClient } from 'matrix-js-sdk';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { allInvitesAtom } from '../matrix/state/inviteList';
import { InviteNotifications } from './InviteNotifications';
import { raiseOnce } from './notifiedOnce';
import { playChime } from './playChime';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('./playChime', () => ({ playChime: vi.fn(() => Promise.resolve()) }));

const ME = '@me:example.org';

class FakeNotification {
  static permission = 'granted';

  static shown: FakeNotification[] = [];

  constructor(public title: string, public options: NotificationOptions) {
    FakeNotification.shown.push(this);
  }
}

const invitedRooms: string[] = [];
let sync: { state: string; fromCache?: boolean } = { state: 'PREPARED', fromCache: true };
const emitter = Object.assign(new EventEmitter(), {
  getUserId: () => ME,
  getSyncState: () => sync.state,
  getSyncStateData: () => ({ fromCache: sync.fromCache }),
  getRooms: () => invitedRooms.map((roomId) => ({ roomId, getMyMembership: () => 'invite' })),
});
const client = emitter as unknown as MatrixClient;

let store = createStore();
let renderer: ReactTestRenderer | undefined;

const render = () =>
  act(() => {
    renderer = create(
      <Provider store={store}>
        <MatrixClientProvider value={client}>
          <InviteNotifications />
        </MatrixClientProvider>
      </Provider>
    );
  });

/** A sync delivers an invite to `roomId`. */
const invite = (roomId: string) =>
  act(() => {
    invitedRooms.push(roomId);
    store.set(allInvitesAtom, { type: 'PUT', roomId });
  });

/** The client applies a sync from the server. */
const serverSync = () =>
  act(() => {
    sync = { state: 'SYNCING' };
    emitter.emit(ClientEvent.Sync, 'SYNCING', 'PREPARED', {});
  });

const bodies = () => FakeNotification.shown.map((note) => note.options.body);

describe('InviteNotifications', () => {
  beforeEach(() => {
    FakeNotification.shown = [];
    vi.stubGlobal('Notification', FakeNotification);
    localStorage.clear();
    invitedRooms.length = 0;
    sync = { state: 'PREPARED', fromCache: true };
    store = createStore();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
    vi.mocked(playChime).mockClear();
  });

  it('announces no invite of the first sync from the server, and a later one once', () => {
    render();
    // The sync that catches up after a start from the store: the invite came before this start.
    invite('!before:example.org');
    serverSync();
    expect(FakeNotification.shown).toHaveLength(0);

    invite('!new:example.org');
    expect(bodies()).toEqual(['You have 1 new invitation request.']);
    expect(playChime).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for an invite another tab announced already', () => {
    sync = { state: 'SYNCING' };
    render();
    raiseOnce(ME, ['invite:!shared:example.org'], () => undefined);
    invite('!shared:example.org');
    invite('!mine:example.org');
    expect(bodies()).toEqual(['You have 1 new invitation request.']);
  });
});
