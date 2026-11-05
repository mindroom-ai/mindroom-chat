import { EventEmitter } from 'node:events';
import { createStore, Provider } from 'jotai';
import { RoomMemberEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { createSessionId } from '../matrix/session/sessions';
import { getRoomViewModeStorageKey } from './roomViewMode';
import { useRoomViewMode } from './useRoomViewMode';

const ME = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
// Room view atoms outlive a test, so each test opens its own room.
let ROOM = '';
let rooms = 0;
const session = createSessionId('https://example.org', ME);

type Member = { roomId: string; userId: string; membership: string };
let members: Member[] = [];
const storage = new Map<string, string>();
const client = Object.assign(new EventEmitter(), {
  getHomeserverUrl: () => 'https://example.org',
  getSafeUserId: () => ME,
  getAccountData: () => undefined,
  getRoom: () => ({
    getMembers: () => members,
    getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
  }),
});

let result: ReturnType<typeof useRoomViewMode> | undefined;
function Probe({ agents }: { agents?: boolean }) {
  result = useRoomViewMode(ROOM, agents);
  return null;
}

let renderer: ReactTestRenderer | undefined;
const render = (agents?: boolean) => {
  const store = createStore();
  store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
  act(() => {
    renderer = create(
      <Provider store={store}>
        <MatrixClientProvider value={client as unknown as MatrixClient}>
          <Probe agents={agents} />
        </MatrixClientProvider>
      </Provider>
    );
  });
};
const join = (userId: string) => {
  const member = { roomId: ROOM, userId, membership: 'join' };
  members = [...members, member];
  act(() => {
    client.emit(RoomMemberEvent.Membership, {} as MatrixEvent, member, undefined);
  });
};

beforeEach(() => {
  rooms += 1;
  ROOM = `!room-${rooms}:example.org`;
  members = [{ roomId: ROOM, userId: ME, membership: 'join' }];
  vi.stubGlobal('localStorage', {
    get length() {
      return storage.size;
    },
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  } as unknown as Storage);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  result = undefined;
  storage.clear();
  client.removeAllListeners();
  vi.unstubAllGlobals();
});

describe('a room without a chosen view', () => {
  it('opens as Compact cards with agents and as Threads without them', () => {
    render(true);
    expect(result?.viewMode).toBe('compact');
    act(() => renderer?.unmount());

    render(false);
    expect(result?.viewMode).toBe('threaded');
  });

  it('finds the agents itself when the caller does not know, and follows one joining', () => {
    render();
    expect(result?.viewMode).toBe('threaded');

    join(AGENT);

    expect(result?.viewMode).toBe('compact');
  });

  it.each([
    { agents: false, chosen: 'classic' },
    { agents: true, chosen: 'threaded' },
  ])('keeps the $chosen view the reader chose when agents is $agents', ({ agents, chosen }) => {
    storage.set(getRoomViewModeStorageKey(session, ROOM), JSON.stringify(chosen));
    render(agents);
    expect(result?.viewMode).toBe(chosen);
  });

  it('remembers a choice of the default view once the reader makes it', () => {
    render(false);
    act(() => result?.setViewMode('compact'));
    expect(result?.viewMode).toBe('compact');

    act(() => result?.setViewMode('threaded'));

    expect(result?.viewMode).toBe('threaded');
    expect(storage.get(getRoomViewModeStorageKey(session, ROOM))).toBe('"threaded"');
  });
});
