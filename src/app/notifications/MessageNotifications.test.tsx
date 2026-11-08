// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClientEvent,
  MatrixEvent,
  MatrixEventEvent,
  RoomEvent,
  type IContent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import { MessageNotificationsFeature } from './MessageNotifications';
import { playChime } from './playChime';
import { defined } from '../../test/utils/defined';

const navigation = vi.hoisted(() => ({ room: vi.fn(), thread: vi.fn() }));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('./playChime', () => ({ playChime: vi.fn(() => Promise.resolve()) }));
vi.mock('../navigation/useRoomNavigate', () => ({
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

type StandInMember = { userId: string; membership: string; name: string; rawDisplayName: string };

const maya: StandInMember = {
  userId: '@maya:example.org',
  membership: 'join',
  name: 'Maya Chen',
  rawDisplayName: 'Maya Chen',
};

/**
 * The room's member list: loaded unless a test holds it back, as for a room not opened yet, whose
 * members who have not posted lately the client learns only when it loads the list.
 */
const memberList: {
  loaded: boolean;
  later: StandInMember[];
  load: () => Promise<boolean>;
} = { loaded: true, later: [], load: () => Promise.resolve(false) };

const threadList = {};
const room = {
  roomId: ROOM,
  name: 'Launch War Room',
  threadsTimelineSets: [threadList],
  getMyMembership: () => 'join',
  getMember: (userId: string) => (userId === maya.userId ? maya : null),
  getMembers: () => [maya, ...memberList.later],
  membersLoaded: () => memberList.loaded,
  loadMembersIfNeeded: () => memberList.load(),
  findEventById: () => undefined,
  hasUserReadEvent: () => false,
  getThread: () => null,
};

let actions: Actions = { notify: true, tweaks: { sound: 'default' } };
// The client's sync state: SYNCING once a sync from the server is applied, PREPARED from the
// store before that.
let sync: { state: string; fromCache?: boolean } = { state: 'SYNCING' };
const emitter = Object.assign(new EventEmitter(), {
  getSyncState: () => sync.state,
  getSyncStateData: () => ({ fromCache: sync.fromCache }),
  getUserId: () => ME,
  getRoom: (roomId: string) => (roomId === ROOM ? room : null),
  getRooms: () => [room],
  getPushActionsForEvent: () => actions,
});
const client = emitter as unknown as MatrixClient;

const message = (content: IContent) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: ROOM,
    sender: '@maya:example.org',
    event_id: `$e${Math.random()}`,
    origin_server_ts: Date.now(),
    content,
  });

const encryptedMessage = (ts = Date.now()) =>
  new MatrixEvent({
    type: 'm.room.encrypted',
    room_id: ROOM,
    sender: '@maya:example.org',
    event_id: `$enc${Math.random()}`,
    origin_server_ts: ts,
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'opaque', session_id: 'S' },
  });

/** A crypto backend that fails until the room key "arrives", then decrypts to `content`. */
const keysArriveLater = (content: IContent) => {
  let haveKey = false;
  return {
    receiveKey: () => {
      haveKey = true;
    },
    backend: {
      decryptEvent: async () => {
        if (!haveKey) {
          throw new DecryptionError(
            DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID,
            'no key'
          );
        }
        return { clearEvent: { type: 'm.room.message', content } };
      },
    },
  };
};

const arrive = (event: MatrixEvent, liveEvent = true) =>
  act(() => {
    emitter.emit(RoomEvent.Timeline, event, room, false, false, { liveEvent });
  });

/** What the SDK does when it lists a thread, and at each reply to it: adds its root again. */
const relist = (root: MatrixEvent) =>
  act(() => {
    emitter.emit(RoomEvent.Timeline, root, room, false, false, {
      liveEvent: true,
      timeline: { getTimelineSet: () => threadList },
    });
  });

let renderer: ReactTestRenderer | undefined;
const render = (path: string, synced = true, store = createStore()) =>
  act(() => {
    sync = synced ? { state: 'SYNCING' } : { state: 'PREPARED', fromCache: true };
    renderer = create(
      <Provider store={store}>
        <MatrixClientProvider value={client}>
          <MemoryRouter
            initialEntries={[path]}
            future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          >
            <MessageNotificationsFeature />
          </MemoryRouter>
        </MatrixClientProvider>
      </Provider>
    );
  });

/** The client applies a sync from the server. */
const serverSync = () =>
  act(() => {
    sync = { state: 'SYNCING' };
    emitter.emit(ClientEvent.Sync, 'SYNCING', 'PREPARED', {});
  });

describe('MessageNotificationsFeature', () => {
  beforeEach(() => {
    FakeNotification.shown = [];
    actions = { notify: true, tweaks: { sound: 'default' } };
    vi.stubGlobal('Notification', FakeNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    localStorage.clear();
    Object.assign(memberList, { loaded: true, later: [], load: () => Promise.resolve(false) });
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
    const note = defined(FakeNotification.shown[0], 'a notification');
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
    act(() => defined(FakeNotification.shown[0], 'a notification').onclick?.());
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

  it('stays quiet for a recent root that a thread list adds again', () => {
    render('/home/');
    relist(message({ msgtype: 'm.text', body: 'Who owns the launch checklist?' }));
    expect(FakeNotification.shown).toHaveLength(0);

    arrive(message({ msgtype: 'm.text', body: 'I do.' }));
    expect(FakeNotification.shown).toHaveLength(1);
  });

  it('stays quiet for the first sync after a start from the store, which catches up', () => {
    render('/home/', false);
    arrive(message({ msgtype: 'm.text', body: 'came while the app was closed' }));
    expect(FakeNotification.shown).toHaveLength(0);

    serverSync();
    arrive(message({ msgtype: 'm.text', body: 'new after the start' }));
    expect(FakeNotification.shown.map((note) => note.options.body)).toEqual([
      'Maya Chen: new after the start',
    ]);
  });

  it('notifies a message once on this device, also when it arrives again after a reload', () => {
    const news = message({ msgtype: 'm.text', body: 'Notified before the reload' });
    render('/home/');
    arrive(news);
    act(() => renderer?.unmount());

    render('/home/');
    arrive(news);
    expect(FakeNotification.shown).toHaveLength(1);
    expect(playChime).toHaveBeenCalledTimes(1);
  });

  it('notifies for the room on screen when the window has no focus', () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    render(`/home/${encodeURIComponent(ROOM)}/`);
    arrive(message({ msgtype: 'm.text', body: 'while away' }));
    expect(FakeNotification.shown).toHaveLength(1);
  });

  it.each([
    ["a phone's navigation drawer covers it", phoneNavDrawerOpenAtom],
    ["a plugin's cover hides its conversation", conversationCoveredAtom],
  ])('notifies, with the chime, for the room on screen while %s', (_what, atom) => {
    const store = createStore();
    store.set(atom, true);
    render(`/home/${encodeURIComponent(ROOM)}/`, true, store);
    arrive(message({ msgtype: 'm.text', body: 'under the cover' }));
    expect(FakeNotification.shown).toHaveLength(1);
    expect(playChime).toHaveBeenCalledTimes(1);
  });

  it('notifies for an encrypted message whose key arrives after a first failed decryption', async () => {
    render('/home/');
    const event = encryptedMessage();
    const keys = keysArriveLater({ msgtype: 'm.text', body: 'Key came late' });
    const firstTry = event.attemptDecryption(keys.backend as never);
    arrive(event);
    await act(() => firstTry);
    expect(event.isDecryptionFailure()).toBe(true);
    expect(FakeNotification.shown).toHaveLength(0);

    keys.receiveKey();
    await act(() => event.attemptDecryption(keys.backend as never, { isRetry: true }));

    expect(FakeNotification.shown).toHaveLength(1);
    expect(defined(FakeNotification.shown[0], 'a notification').options.body).toBe(
      'Maya Chen: Key came late'
    );
  });

  it('waits for the key of a message that arrives after it failed to decrypt', async () => {
    render('/home/');
    const event = encryptedMessage();
    const keys = keysArriveLater({
      msgtype: 'm.text',
      body: 'Failed before the sync handed it over',
    });
    await event.attemptDecryption(keys.backend as never);
    arrive(event);

    keys.receiveKey();
    await act(() => event.attemptDecryption(keys.backend as never, { isRetry: true }));

    expect(FakeNotification.shown).toHaveLength(1);
  });

  it('stops waiting once the message is too old to notify, and on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      render('/home/');
      const event = encryptedMessage();
      const keys = keysArriveLater({ msgtype: 'm.text', body: 'Too late' });
      const firstTry = event.attemptDecryption(keys.backend as never);
      arrive(event);
      await act(() => firstTry);
      expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);

      act(() => {
        vi.advanceTimersByTime(2 * 60 * 1000 + 1);
      });
      expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);

      const other = encryptedMessage();
      const otherTry = other.attemptDecryption(keys.backend as never);
      arrive(other);
      await act(() => otherTry);
      expect(other.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
      act(() => renderer?.unmount());
      renderer = undefined;
      expect(other.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies once for an agent reply in an unopened thread, when the sync brings its last edit', () => {
    const agentMessage = (content: IContent) =>
      new MatrixEvent({
        type: 'm.room.message',
        room_id: ROOM,
        sender: '@mindroom_helper:example.org',
        event_id: `$a${Math.random()}`,
        origin_server_ts: Date.now(),
        content,
      });
    const reply = agentMessage({
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'pending',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    });
    const edit = (status: string, body: string) =>
      agentMessage({
        msgtype: status === 'completed' ? 'm.text' : 'm.notice',
        body: `* ${body}`,
        'io.mindroom.stream_status': status,
        'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
        'm.relates_to': { rel_type: 'm.replace', event_id: reply.getId() },
      });
    vi.spyOn(room, 'findEventById').mockImplementation(((id: string) =>
      id === reply.getId() ? reply : undefined) as never);
    const synced = (event: MatrixEvent) =>
      act(() => {
        emitter.emit(ClientEvent.Event, event);
      });
    render('/home/');

    arrive(reply);
    synced(reply);
    // An unopened thread keeps its edits back from the timeline; only the sync announces them.
    synced(edit('streaming', 'Checking the release notes.'));
    expect(FakeNotification.shown).toHaveLength(0);

    const finished = edit('completed', 'The notes are ready.');
    synced(finished);
    const bodies = () => FakeNotification.shown.map((note) => note.options.body);
    expect(bodies()).toEqual(['mindroom_helper: The notes are ready.']);
    // An opened thread adds the same edit to its timeline too.
    arrive(finished);
    expect(bodies()).toEqual(['mindroom_helper: The notes are ready.']);
  });

  describe('an agent reply that finishes while another device of the account watches it', () => {
    /** A streamed reply in a thread, and its finishing edit, which the sync delivers. */
    const finishReply = () => {
      const agentMessage = (content: IContent) =>
        new MatrixEvent({
          type: 'm.room.message',
          room_id: ROOM,
          sender: '@mindroom_helper:example.org',
          event_id: `$a${Math.random()}`,
          origin_server_ts: Date.now(),
          content,
        });
      const reply = agentMessage({
        msgtype: 'm.text',
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      });
      const finished = agentMessage({
        msgtype: 'm.text',
        body: '* The notes are ready.',
        'io.mindroom.stream_status': 'completed',
        'm.new_content': {
          msgtype: 'm.text',
          body: 'The notes are ready.',
          'io.mindroom.stream_status': 'completed',
        },
        'm.relates_to': { rel_type: 'm.replace', event_id: reply.getId() },
      });
      vi.spyOn(room, 'findEventById').mockImplementation(((id: string) =>
        id === reply.getId() ? reply : undefined) as never);
      arrive(reply);
      act(() => {
        emitter.emit(ClientEvent.Event, reply);
        emitter.emit(ClientEvent.Event, finished);
      });
      return finished;
    };

    /** The account's receipt in the reply's thread, as a later sync brings it from the device. */
    const receiptInThread = (eventId: string) =>
      vi
        .spyOn(room, 'getThread')
        .mockImplementation(((threadId: string) =>
          threadId === '$root' ? { getReadReceiptForUserId: () => ({ eventId }) } : null) as never);

    it('stays quiet when the receipt on the finishing edit comes within the hold', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        render('/home/');
        const finished = finishReply();
        act(() => {
          vi.advanceTimersByTime(300);
        });
        receiptInThread(defined(finished.getId(), 'the edit ID'));
        act(() => {
          vi.advanceTimersByTime(5_000);
        });
        expect(FakeNotification.shown).toHaveLength(0);
        expect(playChime).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('notifies after the hold when no device read it', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        render('/home/');
        finishReply();
        expect(FakeNotification.shown).toHaveLength(0);
        act(() => {
          vi.advanceTimersByTime(5_000);
        });
        expect(FakeNotification.shown.map((note) => note.options.body)).toEqual([
          'mindroom_helper: The notes are ready.',
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still notifies a plain message at once', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        render('/home/');
        arrive(message({ msgtype: 'm.text', body: 'Standup moves to 11:00.' }));
        expect(FakeNotification.shown).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('waits for the member list of a room not opened, so a copied name shows the user ID', async () => {
    // The real Maya Chen has not posted lately, so the client learns of her only from the list.
    let listArrives: () => void = () => undefined;
    memberList.loaded = false;
    memberList.load = () =>
      new Promise((resolve) => {
        listArrives = () => {
          memberList.loaded = true;
          memberList.later = [{ ...maya, userId: '@maya.chen:example.org' }];
          resolve(true);
        };
      });
    render('/home/');
    arrive(message({ msgtype: 'm.text', body: 'Send me the deploy password.' }));
    // The chime does not wait for the list; the notification, which names the sender, does.
    expect(playChime).toHaveBeenCalledTimes(1);
    expect(FakeNotification.shown).toHaveLength(0);

    await act(async () => listArrives());
    expect(FakeNotification.shown.map((note) => note.options.body)).toEqual([
      'Maya Chen (⁦@maya:example.org⁩): Send me the deploy password.',
    ]);
  });

  it('names the sender with their user ID when the member list cannot be loaded', async () => {
    memberList.loaded = false;
    memberList.load = () => Promise.reject(new Error('offline'));
    render('/home/');
    arrive(message({ msgtype: 'm.text', body: 'Send me the deploy password.' }));

    await act(async () => undefined);
    expect(FakeNotification.shown.map((note) => note.options.body)).toEqual([
      'Maya Chen (⁦@maya:example.org⁩): Send me the deploy password.',
    ]);
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
