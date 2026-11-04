// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { defined } from '../../../test-utils/defined';
import { useJoinedRoomThreadLists } from './useJoinedRoomThreadLists';

type Load = { roomId: string; onProgress?: () => void; signal?: AbortSignal; finish: () => void };
const { loads } = vi.hoisted(() => ({ loads: [] as Load[] }));

vi.mock('../../../mindroom/threads/roomThreadList', () => ({
  loadRoomThreads: (room: { roomId: string }, onProgress?: () => void, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      loads.push({ roomId: room.roomId, onProgress, signal, finish: resolve });
    }),
}));

const rooms: Record<string, { membership: string; space?: boolean }> = {
  '!a': { membership: 'join' },
  '!b': { membership: 'join' },
  '!c': { membership: 'join' },
  '!d': { membership: 'join' },
  '!space': { membership: 'join', space: true },
  '!invite': { membership: 'invite' },
};
const client = {
  getRoom: (roomId: string) => {
    const room = rooms[roomId];
    return room
      ? { roomId, getMyMembership: () => room.membership, isSpaceRoom: () => !!room.space }
      : null;
  },
};
vi.mock('../../../hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));

function Probe() {
  useJoinedRoomThreadLists();
  return null;
}

let host: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  loads.length = 0;
  store = createStore();
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

const mount = (roomIds: string[]) => {
  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: roomIds });
  act(() =>
    root.render(
      <Provider store={store}>
        <Probe />
      </Provider>
    )
  );
};

/** The room's first page arrives (the consumer leaves) and its load ends. */
const firstPage = async (load: Load) => {
  await act(async () => {
    load.onProgress?.();
    load.finish();
  });
};

it('lists the joined rooms that are not spaces, three at a time, first page only', async () => {
  mount(Object.keys(rooms));
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b', '!c']);

  const [first] = loads;
  await firstPage(defined(first, 'the first load'));
  expect(first?.signal?.aborted).toBe(true);
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b', '!c', '!d']);
});

it('lists a room once while the page stays open, and again on the next visit', async () => {
  mount(['!a']);
  await firstPage(defined(loads[0], 'the first load'));
  mount(['!a', '!b']);
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b']);

  act(() => root.unmount());
  root = createRoot(host);
  mount(['!a', '!b']);
  expect(loads.map((load) => load.roomId)).toEqual(['!a', '!b', '!a', '!b']);
});

it('leaves the loads it started when the page closes', () => {
  mount(['!a', '!b']);
  act(() => root.unmount());
  root = createRoot(host);
  expect(loads.every((load) => load.signal?.aborted)).toBe(true);
});
