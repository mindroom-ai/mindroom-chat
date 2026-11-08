// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mDirectAtom } from '../matrix/state/mDirectList';
import type { IncomingRing } from './callRings';
import { RingCard, useRingLine } from './IncomingCalls';

const ME = '@me:example.org';
const ROOM_ID = '!desk:example.org';
const REAL = '@morgan:example.org';
const COPY = '@casey:example.org';
const HOST = '@jordan:example.org';
const AGENT = '@mindroom_helper:example.org';
const AGENT_COPY = '@riley:example.org';

const mx = createClient({ baseUrl: 'https://example.org', userId: ME });

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
// Desktop notifications on, notification sounds off.
vi.mock('../preferences/useSetting', () => ({
  useSetting: (_atom: unknown, key: string) => [key === 'showNotifications'],
}));
vi.mock('./CallTile', () => ({ CallMemberAvatar: () => null }));
vi.mock('./IncomingCalls.css', () => ({ Card: 'card' }));

let eventCount = 0;

const memberEvent = (userId: string, displayname: string) => {
  eventCount += 1;
  return new MatrixEvent({
    type: 'm.room.member',
    state_key: userId,
    sender: userId,
    room_id: ROOM_ID,
    event_id: `$member${eventCount}`,
    origin_server_ts: eventCount,
    content: { membership: 'join', displayname },
  });
};

/**
 * A room named "Deploy desk" whose sync brought only these members, as with lazy-loaded members
 * in a room the user has not opened. Its member list arrives when the test calls `listArrives`.
 */
const unopenedRoom = (...members: Array<[userId: string, displayname: string]>) => {
  const room = new Room(ROOM_ID, mx, ME, { lazyLoadMembers: true });
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.name',
      state_key: '',
      sender: HOST,
      room_id: ROOM_ID,
      event_id: '$name',
      content: { name: 'Deploy desk' },
    }),
    ...members.map(([userId, displayname]) => memberEvent(userId, displayname)),
  ]);
  room.recalculate();
  vi.spyOn(mx, 'getRoom').mockImplementation((roomId) => (roomId === ROOM_ID ? room : null));
  let arrive: () => void = () => undefined;
  let fail: () => void = () => undefined;
  const list = new Promise<boolean>((resolve, reject) => {
    arrive = () => resolve(true);
    fail = () => reject(new Error('offline'));
  });
  vi.spyOn(room, 'loadMembersIfNeeded').mockReturnValue(list);
  /** The client loads the room's member list, which brings members who have not posted lately. */
  const listArrives = async (...later: Array<[userId: string, displayname: string]>) => {
    room.currentState.markOutOfBandMembersStarted();
    room.currentState.setOutOfBandMembers(
      later.map(([userId, displayname]) => memberEvent(userId, displayname))
    );
    await act(async () => arrive());
  };
  /** The member list cannot load: the client has only the members its sync brought. */
  const listFails = async () => {
    await act(async () => fail());
  };
  return { room, listArrives, listFails };
};

const ring = (sender: string): IncomingRing => ({
  roomId: ROOM_ID,
  eventId: `$ring${sender}`,
  sender,
  video: false,
  expiresAt: Date.now() + 30_000,
});

function RingLine({ room, sender }: { room: Room; sender: string }) {
  const { caller, line } = useRingLine(room, ring(sender));
  return <>{line(caller)}</>;
}

let renderer: ReactTestRenderer | undefined;

/** The ring lines of `senders`, one per line, as the ring card and its notification show them. */
const ringLines = (room: Room, senders: string[], direct = false) => {
  const store = createStore();
  if (direct) store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set([ROOM_ID]) });
  act(() => {
    renderer = create(
      <Provider store={store}>
        {senders.map((sender) => (
          <p key={sender}>
            <RingLine room={room} sender={sender} />
          </p>
        ))}
      </Provider>
    );
  });
  return () => {
    const shown = renderer?.toJSON();
    const lines = Array.isArray(shown) ? shown : shown ? [shown] : [];
    return lines.map((line) => (line.children ?? []).join(''));
  };
};

const withId = (name: string, userId: string) => `${name} (⁦${userId}⁩)`;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

describe('useRingLine', () => {
  it("puts the caller's user ID after a copied name until the member list shows who is who", async () => {
    // The copy's name reads like the real member's, whom the client has not loaded yet.
    const { room, listArrives } = unopenedRoom([COPY, 'Morgan Lee'], [HOST, 'Jordan Host']);
    const lines = ringLines(room, [COPY, HOST]);
    expect(lines()).toEqual([
      `${withId('Morgan Lee', COPY)} is calling in Deploy desk`,
      `${withId('Jordan Host', HOST)} is calling in Deploy desk`,
    ]);

    await listArrives([REAL, 'Morgan Lee']);
    expect(lines()).toEqual([
      `${withId('Morgan Lee', COPY)} is calling in Deploy desk`,
      'Jordan Host is calling in Deploy desk',
    ]);
  });

  it("puts the caller's user ID after a name copied from an agent, in a direct chat too", async () => {
    const { room, listArrives } = unopenedRoom([AGENT_COPY, 'Desk Helper']);
    const lines = ringLines(room, [AGENT_COPY], true);
    expect(lines()).toEqual([`${withId('Desk Helper', AGENT_COPY)} is calling`]);

    await listArrives([AGENT, 'Desk Helper']);
    expect(lines()).toEqual([`${withId('Desk Helper', AGENT_COPY)} is calling`]);
  });
});

type ShownNotification = { title: string; body: string };

/**
 * Shows a direct chat ring from `sender` while the window is in the background, and returns the
 * system notifications it raised so far.
 */
const ringInBackground = (room: Room, sender: string) => {
  const shown: ShownNotification[] = [];
  class RecordedNotification {
    static permission = 'granted';

    onclick: (() => void) | null = null;

    constructor(title: string, options?: { body?: string }) {
      shown.push({ title, body: options?.body ?? '' });
    }

    close() {}
  }
  vi.stubGlobal('Notification', RecordedNotification);
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  const store = createStore();
  store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set([ROOM_ID]) });
  act(() => {
    renderer = create(
      <Provider store={store}>
        <RingCard
          room={room}
          ring={ring(sender)}
          onAnswer={() => undefined}
          onDecline={() => undefined}
          onIgnore={() => undefined}
          onOpen={() => undefined}
        />
      </Provider>
    );
  });
  return shown;
};

describe('the system notification of a ring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits for the member list and then names the caller as the ring card does', async () => {
    const { room, listArrives } = unopenedRoom([HOST, 'Jordan Host']);
    const shown = ringInBackground(room, HOST);
    // A notification cannot change its text once shown, so none shows with the user ID that
    // the ring card drops as soon as the list arrives.
    expect(shown).toEqual([]);

    await listArrives([REAL, 'Morgan Lee']);
    expect(shown).toEqual([{ title: 'Incoming Call', body: 'Jordan Host is calling' }]);
  });

  it("shows the caller's user ID when the member list cannot load", async () => {
    const { room, listFails } = unopenedRoom([HOST, 'Jordan Host']);
    const shown = ringInBackground(room, HOST);
    expect(shown).toEqual([]);

    await listFails();
    expect(shown).toEqual([
      { title: 'Incoming Call', body: `${withId('Jordan Host', HOST)} is calling` },
    ]);
  });
});
